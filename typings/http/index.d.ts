declare module 'http' {
  export interface Agent {
    createConnection: ClientRequestArgs['createConnection'];
    defaultPort?: number;
  }
}