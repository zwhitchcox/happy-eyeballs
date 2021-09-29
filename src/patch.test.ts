import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { debuglog } from 'util';
import { expect, test } from '../test/test';
import { createConnection } from './create-connection';
import { patch, reset, unpatch } from './patch';

const debug = debuglog('happy-eyeballs-debug');

type CC = {
  http: any;
  https: any;
}


const getcc = () => ({
  https: HttpsAgent.prototype.createConnection,
  http: HttpAgent.prototype.createConnection,
})

const setcc = ({http, https}: CC) => {
  HttpsAgent.prototype.createConnection = https;
  HttpAgent.prototype.createConnection = http;
}

const comparecc = (cc1: CC, cc2: CC) => {
  expect(cc1.http).toBe(cc2.http);
  expect(cc1.https).toBe(cc2.https);
}

const core = getcc();
const patchedcc = {http: createConnection, https: createConnection}

test('patch', () => {
  test('patch/unpatch', () => {
    const beforecc = getcc();
    const fakecc = {
      https: Symbol(443),
      http: Symbol(80),
    }
    setcc(fakecc);
    patch();
    comparecc(getcc(), patchedcc);
    unpatch();
    comparecc(getcc(), fakecc);
    setcc(beforecc);
  })
  test('resets correctly', () => {
    const before = getcc();
    patch();
    comparecc(patchedcc, getcc());
    reset();
    comparecc(core, getcc());
    setcc(before);
  })
})
