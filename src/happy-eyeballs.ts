import * as net from 'net';
import * as tls from 'tls';
import * as dns from 'dns';
import { debuglog, promisify } from 'util';
import { URL } from 'url';
import { LookupAddress, LookupOptions } from 'dns';
import { RequestInit as NFRequestInit } from 'node-fetch'
import AbortError from './abort-error';
import { AbortController, AbortSignal } from 'abort-controller';
import {once} from 'events';
import {Agent as HttpsAgent} from 'https'
const agent = new HttpsAgent();
agent.createConnection()

const dnsLookup = promisify(dns.lookup);

const DEFAULT_NEXT_ADDR_DELAY = 300;

const debug = debuglog('happy-eyeballs-debug');
// const verbose = debuglog('@balena/fetch-verbose');

// hash of hosts and last associated connection family
const familyCache = new Map<string, number>();

// export type HappyEyeballsRequestInit = NFRequestInit & RequestInit & {
//   secure: boolean;
//   delay?: number; // ms delay between requests
//   lookup?: (hostname: string, options: LookupOptions) => Promise<LookupAddress | LookupAddress[]>;
//   family?: number;
//   hints?: number;
//   signal?: AbortSignal;
//   timeout?: number;
// };


export function createConnection(options: net.NetConnectOpts, connectionListener?: () => void): void;
export function createConnection(port: number, host?: string, connectionListener?: () => void): void;
export function createConnection(path: string, connectionListener?: () => void): void;
export function createConnection(args: any) {
  const original = this.prototype.createConnection;
  const [_options, cb] = normalizeArgs(args);
  if ((_options as net.IpcNetConnectOpts).path){
    return original(_options, cb);
  }
  const options = _options as CreateConnectionOptions;
  const { host } = options;
  if (typeof host === 'undefined' || !(host.startsWith('https:') || host.startsWith('http:'))) {
    return original(options, cb);
  }
  happyEyeballs({
    verbatim: true,
    family: 0,
    all: true,
    ...options,
    original,
  }, cb);
}

export type CreateConnectionOptions = {
  original: (options: net.TcpNetConnectOpts, connectionListener?: () => void) => net.Socket;
  signal?: AbortSignal;
  timeout?: number;
  delay?: number;
} & net.TcpSocketConnectOpts & dns.LookupOptions;

async function happyEyeballs(options: CreateConnectionOptions, cb: (error: Error | undefined, socket?: net.Socket) => void) {
  const {host} = options;
  debug('Connecting to', host);

  const lookupFn = promisify(options.lookup) ?? dnsLookup;

  const lookups: LookupAddress[] = [].concat(await lookupFn(host, options));

  if (!lookups.length) {
    cb(new Error(`Could not resolve host, ${host}`));
  }

  const sockets = new Map<string, net.Socket>();
  options.signal?.addEventListener('abort', () => {
    debug('Received abort signal, destroying all sockets.');
    // we don't need to error each socket, as we only care about the overall connection.
    for (const socket of sockets.values()) {
      socket.destroy();
    }
    cb(new AbortError);
  })

  let trying = lookups.length;
  let err: Error;
  function onError(this: net.Socket, _err:any) {
    if (options.signal?.aborted){
      return;
    }
    debug('Got error', _err)

    // Only use the value of the first error, as that was the one most likely to succeed
    if (!err){
      err = _err
    }

    this.destroy();

    debug('trying', trying)
    if (!--trying) {
      if (Array.from(sockets.values()).every(s => s.destroyed)) {
        debug('all sockets destroyed');
      }
      debug('All addresses failed')
      return cb(err)
    }
    debug('More addresses to try, continuing...');
  }

  let ctFound = false;
  function onConnect(this: net.Socket) {
    debug('Connected to', this.remoteAddress);
    ctFound = true;
    for (const s of sockets.values()) {
      if (s !== this) {
        debug('Destroying', s.remoteAddress);
        s.destroy();
      }
    }
    // save last successful connection family for future reference
    familyCache.set(host, net.isIP(this.remoteAddress!));
    cb(undefined, this);
  }

  for (const batch of zip(lookups, familyCache.get(host))) {
    debug('batch', batch);
    if (ctFound || options.signal?.aborted) {
      return;
    }

    for (const addr of batch) {
      debug(`Trying ${addr}...`);
      const socket = options.original({
          ...options,
          host,
        })
        .on('connect', onConnect)
        .on('error', onError);
      sockets.set(addr, socket);

      if(options.timeout) {
        debug('Setting timeout, ' + options.timeout);
        socket.setTimeout(options.timeout);
        socket.on('timeout', function(this: net.Socket) {
          --trying;
          this.destroy();
          if (!trying) {
            if (Array.from(sockets.values()).every(s => !s.destroyed)) {
              cb(err || new Error('All connection attempts to ' + host + ' timed out.'))
            }
          }
          debug(`Request to ${addr} timed out...`)
        })
      }
    }

    // abort the delay if all sockets close before the delay runs out,
    const {abort:_abort, signal} = new AbortController();
    const abort = () => {
      debug('Aborting delay promise');
      _abort();
    };
    options.signal?.addEventListener('abort', abort);
    Promise.all(batch
      .map(addr => sockets.get(addr))
      .map(sck => Promise.race([
        once(sck!, 'close', {signal}),
        once(sck!, 'error', {signal}),
      ]))
    )
      .then(() => abort())
      .catch(() => {});

    try {
      // give each connection 300 ms to connect before trying next one
      await wait(options.delay || DEFAULT_NEXT_ADDR_DELAY, signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        throw err;
      }
    }
    options.signal?.removeEventListener('abort', abort);
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

const normalizedArgsSymbol = Symbol("normalized args");
function toNumber(x) { return (x = Number(x)) >= 0 ? x : false; }
function isPipeName(s) {
  return typeof s === 'string' && toNumber(s) === false;
}

// Returns an array [options, cb], where options is an object,
// cb is either a function or null.
// Used to normalize arguments of Socket.prototype.connect() and
// Server.prototype.listen(). Possible combinations of parameters:
//   (options[...][, cb])
//   (path[...][, cb])
//   ([port][, host][...][, cb])
// For Socket.prototype.connect(), the [...] part is ignored
// For Server.prototype.listen(), the [...] part is [, backlog]
// but will not be handled here (handled in listen())
function normalizeArgs(options: net.NetConnectOpts, connectionListener?: () => void): [net.NetConnectOpts, () => void];
function normalizeArgs(port: number, host?: string, connectionListener?: () => void): [net.NetConnectOpts, () => void];
function normalizeArgs(path: string, connectionListener?: () => void): [net.NetConnectOpts, () => void];
function normalizeArgs(args:any): [net.NetConnectOpts, () => void] {
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol] = true;
    return arr;
  }

  const arg0 = args[0];
  let options: Partial<net.NetConnectOpts> = {};
  if (typeof arg0 === 'object' && arg0 !== null) {
    // (options[...][, cb])
    options = arg0;
  } else if (isPipeName(arg0)) {
    // (path[...][, cb])
    // @ts-ignore
    options.path = arg0;
  } else {
    // ([port][, host][...][, cb])
    // @ts-ignore
    options.port = arg0;
    if (args.length > 1 && typeof args[1] === 'string') {
      // @ts-ignore
      options.host = args[1];
    }
  }

  const cb = args[args.length - 1];
  if (typeof cb !== 'function')
    arr = [options, null];
  else
    arr = [options, cb];

  arr[normalizedArgsSymbol] = true;
  return arr;
}