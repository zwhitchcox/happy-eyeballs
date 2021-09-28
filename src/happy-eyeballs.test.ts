import AbortController from 'abort-controller';
import { LookupAddress, LookupOptions } from 'dns';
import dns from 'dns/promises'
import { Server } from "http";
import { createTestServer } from "../test/server";
import { expect, test } from "../test/test";
import fetch from "node-fetch";
import { patch, unpatch } from './patch'


// TODO: rewrite these without node-fetch
test.parallel('node', async () => {
  test('patch', patch);
  test('can fetch local', async () => {
    let server: Server, port: number;
    ({server, port} = await createTestServer());
    const resp = await fetch(`http://localhost:${port}`);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('It works!')
    server.close();
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
  test('unpatch', unpatch);
});

test.only('incorrect addresses', async () => {
    test('with incorrect addresses', async () => {
      const unpatch = patch({delay: 0});
      const hostname = `https://google.com`;
      const unmockLookup = mock(hostname, [
        ...getFakeAddresses(1),
        ...(await lookup(hostname)),
      ])
      await fetch(hostname);
      unpatch()
    });

    test('fail with all incorrect addresses', async () => {
      const host = 'https://www.google.com`
      const unmock = mock(host, getFakeAddresses(20),
      try {
        await fetch(`https://www.google.com`, {
          lookup: async () => getFakeAddresses(20),
          delay: 2,
          timeout: 1,
        })
        throw new Error('Request should not succeed with incorrect addresses.');
      } catch (err: any) {
        expect(err.message.includes('timed out')).toBe(true);
      }
    })

    test('spam all IPs with many incorrect addresses', async () => {
      const start = Date.now();
      await fetch(`https://www.google.com`, {
        lookup: async (hostname: string, options: LookupOptions) => {
          const realResults = await lookup(hostname, options) as LookupAddress[];
          return [
            ...getFakeAddresses(20),
            ...realResults,
          ];
        },
        delay: 1,
      });
      if (start - Date.now() > 1000) {
        throw new Error('Could not connect in time.')
      }
    });

    test('can abort requests', async () => {
      const ac = new AbortController();
      try {
        const prom = fetch(`https://www.google.com`, {
          delay: 0,
          signal: ac.signal,
          lookup: async () => getFakeAddresses(1)
        });
        ac.abort();
        await prom;
        throw new Error('Request was not aborted.')
      } catch (err: any) {
        expect(err.name).toBe('AbortError');
      }
    });
  })

  async function lookup(host: string) {
    const { lookup:lookupAsync } = await import('dns/promises');
    return lookupAsync(host, {
      verbatim: true,
      family: 0,
      all: true,
    })
  }

  function mockLookup(mocks: {[hostname: string]: LookupAddress[]}): (...args: any) => LookupAddress[];
  function mockLookup(hostname: string, addresses: LookupAddress[]): (...args: any) => LookupAddress[];
  function mockLookup(...args) {
    let mocks: {[hostname: string]: LookupAddress[]} = {};
    if (typeof args[0] === 'string') {
      mocks = {
        [args[0]]: args[1]
      };
    }
    mocks = args[0];
    const original = dns.lookup;

    return (hostname: string, cb: any) => {
      if (hostname in mocks) {
        cb(null, mocks[hostname])
      } else {
        original(hostname, cb);
      }
    }
  }

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
})

process.on('unhandledRejection', (err:any) => {
  console.error('unhandled rejection', err);
})