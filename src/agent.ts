import { Agent as HttpAgent, AgentOptions } from 'http';
import { Agent as HttpsAgent } from 'https';
import { TcpNetConnectOpts } from 'net';
import { ConnectionOptions } from 'tls';
import { createConnection } from './create-connection';

type HappyAgentOptions = AgentOptions & Partial<TcpNetConnectOpts> & {delay?: number, lookup?: (...args: any) => any | undefined}
export class HappyEyeballsHttpAgent extends HttpAgent {
  constructor(options: HappyAgentOptions) {
    super(options);
    this.createConnection = createConnection.bind(this);
  }
}

type HappysAgentOptions = ConnectionOptions & AgentOptions & Partial<TcpNetConnectOpts> & {delay?: number, lookup?: (...args: any) => any | undefined}
export class HappyEyeballsHttpsAgent extends HttpsAgent {
  constructor(options: HappysAgentOptions) {
    super(options);
    this.createConnection = createConnection.bind(this);
  }
}
