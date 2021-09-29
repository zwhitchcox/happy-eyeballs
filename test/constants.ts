import pkg from '../package.json'
export const TESTING = process.env.NODE_ENV === pkg.name + '-test';
export const MANUAL = (process.env.NODE_DEBUG ?? '').includes(
	pkg.name + '-manual',
);
