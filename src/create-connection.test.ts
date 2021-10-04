import TestServer from "../test/server";
import { expect, test } from "../test/test";
import * as http from 'http';
import * as https from 'https';
import { Readable } from 'stream';
import { debuglog, promisify } from "util";
import fetch from 'node-fetch'
import dns from "dns";
import { LookupAddress } from "dns";
import AbortController from "abort-controller";
import request from 'request';
import { URL } from "url";
import { HappyEyeballsHttpAgent as Agent} from "../src/agent";
import { HappyEyeballsHttpsAgent, patch, unpatch } from ".";

// supporting node 12
const lookupAsync = promisify(dns.lookup);

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

type MockLookup = (realResults: LookupAddress[]) => LookupAddress[];
type SetupTestOpts = {hostname?: string, lookup: MockLookup, delay?: number};

const local = new TestServer();
let base: string;
let url: URL;
test.always('start local test server', async () => {
  await local.start();
  base = `http://${local.hostname}:${local.port}`;
  url = new URL(base);
  debug('server started:', local.server.address())
})

test('patch', patch);

test('http.get still works', async () => {
  const res = await get(`${base}/hello`);
  expect(await res.text).toBe('world');
})

test('can fetch api', async () => {
  const resp = await fetch(`${base}/hello`);
  expect(resp.status).toBe(200);
  expect(await resp.text()).toBe('world')
});

test('follow redirects', async () => {
  const resp = await fetch(`${base}/redirect/301`);
  expect(resp.status).toBe(200);
});

test('unpatch', unpatch);

test('succeed with incorrect addresses before correct', async () => {
  await fetch(`${base}/hello`, {
    agent: new Agent({
      delay: 1,
      lookup: mockLookup(real => [...getFakeAddresses(1), ...real]),
    })
  });
});

test('fail with all incorrect addresses', async () => {
  try {
    await fetch(`${base}/hello`, {
      timeout: 1,
      agent: new Agent({
        timeout: 1,
        delay: 2,
        lookup: () => getFakeAddresses(20),
      })
    })
    throw new Error('Request should not succeed with incorrect addresses.');
  } catch (err: any) {
    expect(err.message.includes('timed out')).toBe(true);
  }
})

test('spam all IPs with many incorrect addresses', async () => {
  const start = Date.now();
  await fetch(`${base}/hello`, {
    agent: new Agent({
      lookup: mockLookup(real => [...getFakeAddresses(20), ...real]),
      delay: 1,
    })
  })
  if (start - Date.now() > 1000) {
    throw new Error('Could not connect in time.')
  }
});

test.skip('can abort requests', async () => {
  const ac = new AbortController();
  try {
    const prom = http.get(base, {
      // @ts-ignore
      signal: ac.signal,
      agent: new Agent({
        delay: 1,
        lookup: () => getFakeAddresses(1)
      }),
    });
    ac.abort();
    await prom;
    throw new Error('Request was not aborted.')
  } catch (err: any) {
    debug('error', err)
    expect(err.name).toBe('AbortError');
  }
});

test.skip('https', async () => {
  const ac = new AbortController();
  try {
    const prom = fetch(`https://api.balena-cloud.com/ping`, {
      // @ts-ignore
      signal: ac.signal,
      agent: new HappyEyeballsHttpsAgent({
        delay: 1,
        lookup: () => getFakeAddresses(1)
      })
    });
    ac.abort();
    await prom;
    throw new Error('Request was not aborted.')
  } catch (err: any) {
    expect(err.name).toBe('AbortError');
  }
});

test('request', async () => {
  patch();
  await new Promise<void>((res, rej) => {
    request(`${base}/hello`, function (error, response, body) {
      if (error) {
        return rej(error)
      }
      expect(response.statusCode).toBe(200)
      res();
    })
  });
  unpatch();
})

test.always('stop local test server', async () => {
  await local.stop();
});

process.on('unhandledRejection', (err:any) => {
  console.error('unhandled rejection', err);
})


const getFakeAddresses = (num: number) => {
  const result = [];
  while (num--) {
    result.push(
      {
        family: 6,
        address: '2001:db8:ffff:ffff:ffff:ffff:ffff:'	 + num.toString(16),
      },
      {
        family: 4,
        address: '192.0.2.' + num,
      },
    )
  }
  return result;
};

type LookupManipulator = (lookups: LookupAddress[]) => LookupAddress[];
function mockLookup(fn: LookupManipulator) {
  return async (hostname: string, options: any) => {
    const real = await lookupAsync(hostname, {
      all: true,
      family: 0,
      verbatim: true,
      ...options,
    });
    if (local.hostname !== hostname) {
      return real;
    }
    return await fn(real);
  };
}

process.on('uncaughtException', err => {
  console.error('uncaughtException', err);
  console.error(err.stack)
})