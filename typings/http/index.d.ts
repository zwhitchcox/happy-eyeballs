import { LookupFunction } from "../../src/happy-eyeballs";

declare module 'http' {
  export interface Agent {
    createConnection: ClientRequestArgs['createConnection'] & {lookup?: LookupFunction};
    defaultPort?: number;
  }
}