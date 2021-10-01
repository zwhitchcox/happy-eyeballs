import * as net from 'net';
import { debuglog, promisify } from 'util';
import { LookupAddress } from 'dns';
import AbortError from './abort-error';
import { AbortController, AbortSignal } from 'abort-controller';
import { originals as _originals } from './patch';
import { Agent, ConnectionCb, HappyRequestArgs } from './create-connection';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import * as tls from 'tls';
import * as dns from 'dns';

const debug = debuglog('happy-eyeballs-debug');
const verbose = debuglog('happy-eyeballs-debug-verbose');

const DEFAULT_DELAY = 300;

export const core = {
  https: HttpsAgent.prototype.createConnection,
  http: HttpAgent.prototype.createConnection,
}

const lookupAsync = promisify(dns.lookup);

type Dict<T> = {[key: string]: T}

// hash of hosts and last associated connection family
const familyCache: Dict<number> = {};

export async function happyEyeballs(this: Agent, options: HappyRequestArgs, cb: ConnectionCb) {
  const hostname = options.hostname || options.host;
  debug('Connecting to', hostname);
  const { protocol }= options;

  // infer original connect in case not patched
  const connect = options.createConnection ?? ((this instanceof HttpsAgent || protocol === 'https:' || this.defaultPort === 443) ? core.https : core.http);

  if (hostname == null) {
    throw new Error('Host name not supplied.');
  }

  let lookups;
  try {
    lookups = await lookupPromise(hostname, options);
  } catch (err: any) {
    cb(err);
    return;
  }

  if (!lookups.length) {
    cb(new Error(`Could not resolve host, ${hostname}`));
  }

  const ac = new AbortController;
  options.signal?.addEventListener('abort', ac.abort)

  const {href, ...passThroughOptions} = options as any;

  const track = getTracker(hostname, lookups.length, ac, cb);
  const getHostConnect = (host: string) => () => {
    if (options.signal?.aborted) {
      return cb(new AbortError());
    }
    debug('Trying...', `${host}:${options.port}`);

    return track(connect.call(this, {
      ...passThroughOptions,
      // protocol: options.protocol,
      // hash: options.hash,
      // search: options.search,
      // port: options.port,
      // pathname: options.pathname,
      // signal: options.signal,
      // timeout: options.timeout,
      agent: this,
      servername: options.servername ?? options.hostname,
      host,
    }));
  }

  let i = 0;
  for (const batch of zip(lookups, familyCache[hostname])) {
    const delay = (options.delay ?? DEFAULT_DELAY) * i++;
    for (const host of batch) {
      wait(delay, ac.signal).then(getHostConnect(host)).catch(() => {});
    }
  }
}

// the wrapper keeps track of the overall state of the connection attempt
// * if a socket connects, all other sockets are destroyed
// * if all sockets fail or timeout, cb is called with an error
// * if the abort signal provided by the user is aborted before the above cases,
//   cb is called with an abort error
function getTracker(hostname: string, total: number, ac: AbortController, cb: ConnectionCb) {
  const state = {
    closed: 0,
    timeouts: 0,
    connected: 0,
    err: undefined,
  }
  const handlers = {
    error(_err: any) {
      state.err ??= _err;
    },
    abort() {
      if (!state.connected && state.closed < total-1) {
        cb(new AbortError);
        for (const socket of sockets) {
          socket.destroy();
        }
        untrack();
      }
    },
    connect(this: tls.TLSSocket) {
      debug('Connected', this.remoteAddress);
      state.connected++;
      ac.abort(); // abort wait timeouts
      for (const socket of sockets) {
        if (socket !== this) {
          socket.destroy();
        }
      }
      untrack();
      // need to untrack errors to restore normal behavior before returning
      cb(null, this);
      // save last successful connection family for future reference
      familyCache[hostname] = net.isIP(this.remoteAddress!);
    },
    timeout(this: net.Socket) {
      state.timeouts++;
      this.destroy();
    },
    close(this: tls.TLSSocket) {
      debug('Closed', this.remoteAddress);
      if (ac.signal.aborted) {
        return;
      }
      if (++state.closed === total) {
        untrack(this);
        if (state.timeouts === total) {
          cb(new Error(`Attempts to connect to ${hostname} all timed out.`));
        } else if (!state.connected) {
          cb(state.err!);
        }
      }
    },
  }

  ac.signal.addEventListener('abort', handlers.abort, {once: true});

  const sockets: net.Socket[] = [];
  const untrack = (socket?: net.Socket) => {
    if (socket) {
      sockets.splice(sockets.indexOf(socket), 1);
    }
    const scks = typeof socket !== 'undefined' ? [socket] : sockets;
    for (const socket of scks) {
      for (const evt in handlers) {
        socket.off(evt, handlers[evt as keyof typeof handlers]);
      }
    }
  }

  return (socket: net.Socket) => {
    sockets.push(socket);
    for (const evt in handlers) {
      socket.on(evt, handlers[evt as keyof typeof handlers]);
    }
  }
}

// this function follows the happy eyeballs 2 algorithm: https://datatracker.ietf.org/doc/html/rfc8305
export function*zip(lookups: LookupAddress[], init?: number): Iterable<string[]> {
  // `init` is the cached value of the family of the last successful connection
  // or `undefined` if no successful connections have been made to this host

  // `next` is the next address family we are looking for
  let next = init;

  // queue of addresses not matching `next`
  const queue: string[] = [];

  for (const {address, family} of lookups) {
    if (family === next || !next) {
      if (init) {
        // we've seen this host before, so just try this connection first
        yield [address];
        // set init to 0, so dual-stack addresses will be returned if the first one fails
        init = 0;
      } else {
        // the cached address family didn't connect in time, or there was no cached address family
        // so now yield pairs of both families
        if (queue.length) {
          // If there is an item on the queue, we have found a pair of mixed families.
          yield [address, queue.shift()!]
        } else {
          // queue was empty, so queue this item and switch the family we're looking for
          queue.push(address);
          next = family === 6 ? 4 : 6;
        }
      }
    } else {
      queue.push(address)
    }
  }
  // The leftover from the queue are all from the same family
  // so, just return a single-value array to try one at a time
  for (const addr of queue) {
    yield [addr];
  }
}

type LookupOptions = {
  verbatim?: boolean;
  family?: number;
  all?: boolean;
  lookup?: LookupFunction;
  [key: string]: any;
}
export type LookupFunction = (hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | undefined | null, address: string, family: number) => void) => void;
function lookupPromise(host: string, options: LookupOptions) {
  return new Promise<LookupAddress[]>(async (res, rej) => {
    const cb = (err: Error | undefined | null, result: string | LookupAddress[], family?: number) => {
      if (err) {
        return rej(err);
      }
      if (typeof result === 'string') {
        return res([{address: result, family: family!}])
      }
      res(result);
    }
    const result = (options.lookup ?? lookupAsync)(host, {
      all: true,
      family: 0,
      verbatim: true,
      ...options,
    }, cb);
    if (typeof result !== 'undefined') {
      try {
        res(ensureArray(await result));
      } catch (err) {
        rej(err);
      }
    }
  })
}

function ensureArray(item: any) {
  if (!Array.isArray(item)) {
    return [item];
  }
  return item;
}

// We may want to abort a wait to keep the wait handle from keeping the process open
const wait = async (ms: number, signal?: AbortSignal) => {
  return signal?.aborted ?
    Promise.reject(new AbortError()) :
    new Promise<void>((res, rej) => {
      const onAbort = () => {
        clearTimeout(timeout);
        rej(new AbortError());
      };
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        res();
      }, ms);
      signal?.addEventListener('abort', onAbort);
  });
}