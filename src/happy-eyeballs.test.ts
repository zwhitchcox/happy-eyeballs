import TestServer from "../test/server";
import { expect, test } from "../test/test";
import { patch, reset, unpatch } from './patch'
import * as http from 'http';
import * as https from 'https';
import { Readable } from 'stream';
import { callbackify, debuglog } from "util";
import fetch from 'node-fetch'
import dns from "dns";
import * as dnsAsync from 'dns/promises';
import { LookupAddress } from "dns";

const debug = debuglog('happy-eyeballs-debug');

const get = async (host: any) => {
  return new Promise<http.IncomingMessage & {text: Promise<string>}>(res => {
    (host.startsWith('https:') ? https : http).get(host, (response: any) => {
      response.text = text(response);
      res(response);
    })
  })
}

const text = async (readable: Readable) => {
  let accum = '';
  for await (const chunk of readable) {
    accum += chunk.toString();
  }
  return accum;
}

test('node', async () => {
  test('patch', patch);
  let server: TestServer;
  test('start test server', async () => {
    server = new TestServer;
    await server.start();
    debug('server started:', server.server.address())
  })
  test('http.get still works', async () => {
    const res = await get(`http://localhost:${server.port}/hello`);
    expect(await res.text).toBe('world');
  })

  test('can fetch api', async () => {
    const resp = await fetch(`https://api.balena-cloud.com/ping`);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('OK')
  });

  test('follow redirects', async () => {
    const resp = await fetch(`https://google.com`);
    expect(resp.status).toBe(200);
  });
  test('close server', () => server?.stop());
  test('unpatch', unpatch);
});

type MockLookup = (realResults: LookupAddress[]) => LookupAddress[];
type SetupTestOpts = {hostname?: string, lookup: MockLookup, delay?: number};

test('incorrect addresses', async () => {
  const defaultHostname = 'https://google.com';
  const mocks: Dict<MockLookup> = {};
  const mock = (hostname: string, mock: MockLookup) => {
    const prev = mocks[hostname];
    mocks[hostname] = mock;
    return () => mocks[hostname] = prev;
  }
  const setup = ({hostname, lookup, delay}: SetupTestOpts) => {
    patch({delay})
    const unmock = mock(hostname ?? defaultHostname, lookup)
    return () => {
      unmock();
      unpatch();
    }
  }
  test('patch', () => {
    reset();
    patch();
  });
  test('init dns.lookup mocker', async () => {
    // @ts-ignore
    dns.lookup = callbackify(async (hostname: string) => {
      const results = await dnsAsync.lookup(hostname, {
        all: true,
        family: 0,
        verbatim: true,
      })
      if (mocks[hostname]) {
        return mocks[hostname](results);
      }
      return results;
    })
  })
  test('succeed with incorrect addresses before correct', async () => {
    setup({
      delay: 1,
      lookup: real => [...getFakeAddresses(1), ...real],
    })
    await fetch(defaultHostname);
  });

  test('fail with all incorrect addresses', async () => {
    setup({
      delay: 2,
      lookup: () => getFakeAddresses(20),
    })
    try {
      await fetch(defaultHostname, { timeout: 1 })
      throw new Error('Request should not succeed with incorrect addresses.');
    } catch (err: any) {
      expect(err.message.includes('timeout')).toBe(true);
    }
  })

  test('spam all IPs with many incorrect addresses', async () => {
    const start = Date.now();
    setup({
      lookup: real => [...getFakeAddresses(20), ...real],
      delay: 1,
    });
    await fetch(defaultHostname)
    if (start - Date.now() > 1000) {
      throw new Error('Could not connect in time.')
    }
  });

  test('can abort requests', async () => {
    const ac = new AbortController();
    setup({
      delay: 1,
      lookup: () => getFakeAddresses(1)
    })
    try {
      const prom = fetch(`https://www.google.com`, {
        signal: ac.signal,
      });
      ac.abort();
      await prom;
      throw new Error('Request was not aborted.')
    } catch (err: any) {
      expect(err.name).toBe('AbortError');
    }
  });
  const originalLookup = dns.lookup;
  test('restore dns.lookup', () => {
    dns.lookup = originalLookup;
  })
})

function getFakeAddresses(num: number) {
  const result = [];
  while (--num) {
    result.push({
      family: 6,
      address: 'dead::' + num.toString(16),
    }, {
      family: 4,
      address: '192.168.1.' + num,
    })
  }
  return result;
}

process.on('unhandledRejection', (err:any) => {
  console.error('unhandled rejection', err);
})

type Dict<T> = {[key: string]: T}