import * as net from 'net';
import { debuglog, promisify } from 'util';
import { LookupAddress } from 'dns';
import AbortError from './abort-error';
import { AbortController, AbortSignal } from 'abort-controller';
import { originals as _originals } from './patch';
import { ConnectionCb } from './create-connection';
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'

const core = {
  // @ts-ignore
  https: HttpsAgent.prototype.createConnection,
  // @ts-ignore
  http: HttpAgent.prototype.createConnection,
}

const debug = debuglog('happy-eyeballs-debug');

export type HappyEyeballsOptions = {
  // connect is the original connection that this one is patching
  connect: (options: net.TcpNetConnectOpts | {servername: string}, connectionListener?: () => void) => net.Socket;
  signal?: AbortSignal;
  timeout?: number;
  delay?: number;
  hostname: string;
  protocol: string;
  lookup?: (...args: any) => LookupAddress | LookupAddress[];
};

type Dict<T> = {[key: string]: T}

// hash of hosts and last associated connection family
const familyCache: Dict<number> = {};

export async function happyEyeballs(options: HappyEyeballsOptions, cb: ConnectionCb) {
  const { hostname, protocol } = options;
  const connect = options.connect ?? this instanceof HttpAgent ?
    core.http : this instanceof HttpsAgent || protocol === 'https:' || this.defaultPort === 443 ? core.https : core.http;

  debug('Connecting to', hostname);

  const lookups = await lookup(hostname, options);

  if (!lookups.length) {
    cb(new Error(`Could not resolve host, ${hostname}`));
  }

  const ac = new AbortController;
  options.signal?.addEventListener('abort', ac.abort)

  const track = getTracker(lookups.length, ac, cb);
  const getHostConnect = (host: string) => () => track(connect({
    ...options,
    host,
    servername: options.hostname,
  }))

  let i = 0;
  for (const batch of zip(lookups, familyCache[hostname])) {
    const delay = options.delay * i++;
    for (const host of batch) {
      wait(delay, ac.signal).then(getHostConnect(host));
    }
  }
}

// the wrapper keeps track of the overall state of the connection attempt
// * if a socket connects, all other sockets are destroyed
// * if all sockets fail or timeout, cb is called with an error
// * if the abort signal provided by the user is aborted before the above cases,
//   cb is called with an abort error
function getTracker(total: number, ac: AbortController, cb: ConnectionCb) {
  const state = {
    closed: 0,
    timeouts: 0,
    connected: 0,
    err: undefined,
  }
  const handlers =  {
    error(_err) {
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
    connect() {
      state.connected++;
      ac.abort();
      cb(null, this);
      for (const socket of sockets) {
        if (socket !== this) {
          socket.destroy();
        }
      }
      untrack();
      // save last successful connection family for future reference
      familyCache[this.servername] = net.isIP(this.host);
    },
    timeout() {
      state.timeouts++;
      this.destroy();
    },
    close() {
      if (++state.closed === total) {
        untrack(this);
        if (state.timeouts === total) {
          cb(new Error(`Attempts to ${this.servername} timed out.`));
        } else if (!state.connected) {
          cb(state.err);
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
    const scks = typeof socket === 'undefined' ? [socket] : sockets;
    for (const socket of scks) {
      for (const evt in handlers) {
        socket.off(evt, handlers[evt]);
      }
    }
  }

  return (socket: net.Socket) => {
    for (const evt in handlers) {
      socket.on(evt, handlers[evt]);
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
  lookup?: (...args: any) => LookupAddress | LookupAddress[] | Promise<LookupAddress | LookupAddress[]>;
  [key: string]: any;
}
function lookup(host, options: LookupOptions) {
  return new Promise<LookupAddress[]>(async (res, rej) => {
    const cb = (err: Error, result: LookupAddress | LookupAddress[]) => {
      if (err) {
        rej(err);
      }
      res([].concat(result));
    }
    const result = options.lookup(host, {
      all: true,
      family: 0,
      verbatim: true,
      ...options,
    }, cb)
    if (isPromise(result)) {
      res([].concat(result));
    }
  })
}

function isPromise(arg: any): boolean {
  return typeof arg?.then === 'function'
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