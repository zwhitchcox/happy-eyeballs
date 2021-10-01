import * as net from 'net';
import {Agent as HttpAgent} from 'http';
import {Agent as HttpsAgent} from 'https';
import { originals as _originals } from './patch';
import { happyEyeballs, LookupFunction } from './happy-eyeballs';
import { debuglog } from 'util';
import { ClientRequestArgs } from './interfaces';

const debug = debuglog('happy-eyeballs-debug')
const verbose = debuglog('happy-eyeballs-debug-verbose');

export const core = {
  https: HttpsAgent.prototype.createConnection,
  http: HttpAgent.prototype.createConnection,
}

export type ConnectionCb = (error: Error | null | undefined, socket?: net.Socket) => net.Socket | undefined;

export type Agent = (HttpAgent | HttpsAgent);
export type HappyRequestArgs = ClientRequestArgs & {lookup?: LookupFunction};

export function createConnection(options: HappyRequestArgs, oncreate: (err: Error, socket: net.Socket) => void): net.Socket;
export function createConnection(port: number, host?: string, oncreate?: (err: Error, socket: net.Socket) => void): net.Socket;
export function createConnection(path: string, oncreate?: (err: Error, socket: net.Socket) => void): net.Socket;
export function createConnection(this: Agent, ...args: any[]) {
  // if patch was called explicitly, we should have original functions
  const originalProtos = _originals.get(this?.constructor) ?? [];
  const connect = originalProtos[0]?.createConnection ?? ((this instanceof HttpsAgent || args[0]?.protocol === 'https:' || this?.defaultPort === 443) ? core.https : core.http);
  debug('ishttp', this instanceof HttpAgent, connect === core.http);
  debug('ishttps', this instanceof HttpsAgent, connect === core.https);

  const [options, cb] = normalizeArgs(args);

  if (options.path || net.isIP(options.hostname!)){
    // if host is IP, there's only one ip associated, so don't need happy eyeballs
    return connect!(options, cb);
  }

  happyEyeballs.call(this, {createConnection: connect, ...options}, cb!);
}

// normalize arguments for createConnection to [options, cb]
function normalizeArgs(args:any): [HappyRequestArgs, ConnectionCb] {
  let arr;

  if (args.length === 0) {
    arr = [{}, null];
    arr[normalizedArgsSymbol as any] = true;
    return arr as any;
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

  arr[normalizedArgsSymbol as any] = true;
  return arr as any;
}

const normalizedArgsSymbol = Symbol("normalized args");
function toNumber(x: any): false | number { return (x = Number(x)) >= 0 ? x : false; }
function isPipeName(s: any): boolean {
  return typeof s === 'string' && toNumber(s) === false;
}