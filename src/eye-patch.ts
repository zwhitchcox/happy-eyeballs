import {Agent as HttpAgent} from 'http';
import {Agent as HttpsAgent} from 'https';
import { createConnection } from './happy-eyeballs';

const originals = {
  // @ts-ignore
  https: HttpAgent.prototype.createConnection,
  // @ts-ignore
  http: HttpsAgent.prototype.createConnection,
}

// @ts-ignore
const originalHttps = HttpAgent.createConnection = HttpsAgent.createConnection;
// @ts-ignore
HttpAgent.createConnection = HttpsAgent.createConnection = createConnection;
// @ts-ignore
return () => HttpAgent.createConnection = HttpsAgent.createConnection = original;