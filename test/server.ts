import { Server } from 'http';
import { TESTING } from './constants';

// tslint:disable-next-line:no-empty
const noop = () => {};

export const createTestServer = (
	TESTING
		? async () => {
				const { createServer } = await import('http');
				return new Promise((pres, rej) => {
					const server = createServer((req, res) => {
						res.writeHead(200, {
							'Access-Control-Allow-Origin': '*',
						});
						res.write('It works!');
						res.end();
						process.nextTick(() => req.destroy());
					})
						.listen(() => {
							// tslint:disable-next-line:ban-ts-ignore
							// @ts-ignore @types/node is wrong here
							const { port } = server.address();
							pres({ server, port });
						})
						.on('error', rej);
				});
		  }
		: noop
) as () => Promise<{ server: Server; port: number }>;
