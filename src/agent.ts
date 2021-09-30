import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { createConnection } from './create-connection';

export class HappyEyeballsHttpAgent extends HttpAgent {
  createConnection = createConnection;
}

export class HappyEyeballsHttpsAgent extends HttpsAgent {
  createConnection = createConnection;
}
