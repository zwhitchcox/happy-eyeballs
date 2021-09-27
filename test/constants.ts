export const TESTING = process.env.NODE_ENV === 'happy-eyeballs-test';
export const MANUAL = (process.env.NODE_DEBUG ?? '').includes(
	'happy-eyeballs-manual',
);
