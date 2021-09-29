import { Socket } from "net";
import { Agent, OutgoingHttpHeaders } from "http";
import { LookupFunction } from "net";

export interface ClientRequestArgs {
  hash?: string | undefined | null;
  search?: string | undefined | null;
  pathname?: string | undefined | null;
  signal?: AbortSignal | undefined;
  protocol?: string | null | undefined;
  host?: string | null | undefined;
  hostname?: string | null | undefined;
  family?: number | undefined;
  port?: number | string | null | undefined;
  defaultPort?: number | string | undefined;
  localAddress?: string | undefined;
  socketPath?: string | undefined;
  maxHeaderSize?: number | undefined;
  method?: string | undefined;
  path?: string | null | undefined;
  headers?: OutgoingHttpHeaders | undefined;
  delay?: number | null | undefined;
  auth?: string | null | undefined;
  agent?: Agent | boolean | undefined;
  servername?: string | undefined;
  _defaultAgent?: Agent | undefined;
  timeout?: number | undefined;
  setHost?: boolean | undefined;
  lookup?: LookupFunction;
  // https://github.com/nodejs/node/blob/master/lib/_http_client.js#L278
  createConnection?: ((options: ClientRequestArgs, oncreate: (err: any, socket: Socket) => void) => Socket);
}
