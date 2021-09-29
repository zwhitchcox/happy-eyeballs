declare module 'https' {
  export interface Agent {
    createConnection: ClientRequestArgs['createConnection'];
    defaultPort: number;
  }
}
