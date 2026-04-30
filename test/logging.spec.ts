import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
	createAuthRequest,
	createTestEnv,
	executeRequest
} from './webdav-test-utils';

describe('request logging', () => {
	it('persists request logs in D1 and redacts sensitive headers', async () => {
		const testEnv = createTestEnv({ DB: env.DB });

		await executeRequest(createAuthRequest('GET', '/_debug/clear-all-logs'), testEnv);

		const response = await executeRequest(createAuthRequest('OPTIONS', '/logged-path?x=1', {
			headers: {
				'Cookie': 'session=secret',
				'User-Agent': 'vitest-webdav'
			}
		}), testEnv);
		expect(response.status).toBe(200);

		const logResponse = await executeRequest(createAuthRequest('GET', '/_debug/d1-logs?limit=5'), testEnv);
		const logText = await logResponse.text();

		expect(logResponse.status).toBe(200);
		expect(logText).toContain('OPTIONS /logged-path?x=1');
		expect(logText).toContain('authorization: [redacted]');
		expect(logText).toContain('cookie: [redacted]');
		expect(logText).not.toContain(btoa('testuser:testpass'));
		expect(logText).not.toContain('session=secret');
	});

	it('exposes recent Durable Object logs through debug routes', async () => {
		const testEnv = createTestEnv({ DB: env.DB, LOG_DO: env.LOG_DO });

		await executeRequest(createAuthRequest('GET', '/_debug/clear-all-logs'), testEnv);

		const response = await executeRequest(createAuthRequest('OPTIONS', '/durable-log-path'), testEnv);
		expect(response.status).toBe(200);

		const logResponse = await executeRequest(createAuthRequest('GET', '/_debug/do-logs?limit=5'), testEnv);
		const logText = await logResponse.text();

		expect(logResponse.status).toBe(200);
		expect(logText).toContain('OPTIONS /durable-log-path -> 200');
	});
});
