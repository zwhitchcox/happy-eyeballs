import * as net from 'net';
import {Agent as HttpAgent} from 'http';
import {Agent as HttpsAgent} from 'https';
import { originals as _originals } from './patch';
import { happyEyeballs, HappyEyeballsOptions } from './happy-eyeballs';

const originalCCs = {
  // @ts-ignore
  https: HttpAgent.prototype.createConnection,
  // @ts-ignore
  http: HttpsAgent.prototype.createConnection,
}

export type ConnectionCb = (error: Error | undefined, socket?: net.Socket) => void;

export function createConnection(options: net.NetConnectOpts, connectionListener?: () => void): void;
export function createConnection(port: number, host?: string, connectionListener?: () => void): void;
export function createConnection(path: string, connectionListener?: () => void): void;
export function createConnection(args: any) {
  // don't call happy eyeballs if host is an ip address
  const originalCC = _originals.get(this) ?? ((this instanceof HttpsAgent || this.defaultPort === 443) ? originalCCs.https : originalCCs.http);
  const [options, cb] = normalizeArgs(args);
  // @ts-ignore
  if ((options).path || net.isIP(options.hostname)){
    return originalCC(options, cb);
  }

  happyEyeballs({connect: originalCC, ...(options as unknown as HappyEyeballsOptions)}, cb);
}

// normalize arguments for net.createConnection to [options, cb]
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

const normalizedArgsSymbol = Symbol("normalized args");
function toNumber(x) { return (x = Number(x)) >= 0 ? x : false; }
function isPipeName(s) {
  return typeof s === 'string' && toNumber(s) === false;
}