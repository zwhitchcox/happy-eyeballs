## Happy Eyeballs

This package patches `http(s).Agent` to implement "happy eyeballs" ([rfc8305](https://datatracker.ietf.org/doc/html/rfc8305)), a standard published by the IETF.

It improves client performance and reliability by trying concurrently trying multiple ip addresses for a given host name. See [Explanation](#explanation) for more detail.

### Installation

```
npm i --save-dev happy-eyeballs
```

```
yarn add --dev happy-eyeballs
```


### Quick Usage

To use this library, simply import

```ts
import 'happy-eyeballs/eye-patch';
```

or

```js
require('happy-eyeballs/eye-patch')
```

to the top of your `.js`/`.ts` entry file.

Note: this will replace `http.Agent.prototype.createConnection` and `https.Agent.prototype.createConnection`, but it tries to preserve existing functionality as much as possible.

### Explicit Usage

If you want to be more explicit, you can explicitly patch the `http(s).Agent`:

```ts
import { patch } from 'happy-eyeballs';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

patch(HttpAgent);
patch(HttpsAgent);
```

Although, this is exactly what the `import 'happy-eyeballs/eyepatch';` does anyway.

You could also implement your own agent and replace the `createConnection` method:

```ts
import { createConnection } from 'happy-eyeballs';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';

export class MyHttpAgent extends HttpAgent {
  createConnection = createConnection;
}

export class MyHttpsAgent extends HttpsAgent {
  createConnection = createConnection;
}
```

This does basically the same thing as the previous examples though.

### Explanation

Essentially, the algorithm amounts to this:

1. Receive a hostname
2. Have we connected to this host before?
  * If yes:
    * Try the family (Ipv4 or IPv6) of last successful connection if we have connected to this host before
    * If connection is not successful within 300ms, proceed to next step
  * If no: proceed to next step.
3. Did the DNS lookup return both IPv4 and IPv6 addresses?
  * If yes: try, both addresses concurrently until all have been tried
  * If no: just try the address of the existent family
4. Proceed with each address in chain, trying both families concurrently until either:
  1. A connection is made
  2. All connection attempts time out
  3. All connection attempt fail
5. If no connection was successful, return error of the first connection attempt or a "time out" error if all connections timed out