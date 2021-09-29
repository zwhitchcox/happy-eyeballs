import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { debuglog } from 'util';
import { createConnection } from './create-connection';
const debug = debuglog('happy-eyeballs-debug')

export const originals = new WeakMap<any, Array<any>>();

const coreAgents = [HttpAgent, HttpsAgent];

export function patch(Agent: any = coreAgents, options?: {delay?: number}): void {
  if (doAll(Agent, patch)) {
    return;
  }

  if (Object.keys(Agent).length === 1 && 'delay' in Agent) {
    // the first argument was really options
    return patch(coreAgents, Agent);
  }

  if (!Agent?.prototype) {
    throw new Error('Expected an Agent class');
  }

  const original = {
    ...Agent.prototype
  };

  Agent.prototype.delay = options?.delay;
  Agent.prototype.createConnection = createConnection;

  push(originals, Agent, original);
  debug('originals push', original);
}

export function unpatch(Agent: any = coreAgents){
  if (doAll(Agent, unpatch)) {
    return;
  }
  if (!originals.has(Agent)) {
    return;
  }
  const original = pop(originals, Agent);
  debug('originals pop', original);
  Agent.prototype.delay = original.delay;
  Agent.prototype.createConnection = original.createConnection;
}

export function reset(Agent: any = coreAgents) {
  if (doAll(Agent, reset)) {
    return;
  }

  const original = originals.get(Agent);
  if (original?.length) {
    // go back to first patch values
    original.length = 1;
    unpatch(Agent);
  }
}

function doAll(items: any, fn: (...args: any) => void | any) {
  if (!Array.isArray(items)) {
    return false;
  }
  for (const item of items) {
    fn(item);
  }
  return true;
}

type WeakMapArrayAction<T extends object = any, U extends V[] = any[], V = any, R extends V = any> = (map: WeakMap<T,U>, key: T, item?: U) => R;


// pop from array...if doesn't exist, create
const pop: WeakMapArrayAction = (map, key) => put(map, key, []).pop();

// push to array...if doesn't exist, create
const push: WeakMapArrayAction = (map, key, item) => {
  put(map, key, []).push(item);
  return item;
}

// add item if doesn't exist to map
function put<T extends object = any, U = any>(map: WeakMap<T,U>, key: T, item: U) {
  if (!map.has(key)) {
    map.set(key, item);
  }
  return map.get(key)!;
}
