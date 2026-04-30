import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

// Type assertion to ensure worker is available
const testWorker = worker as unknown as { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };

describe('WebDAV worker', () => {
	it('responds with 401 for unauthorized request', async () => {
		const request = new Request('http://example.com', {
			method: 'GET'
		});
		const ctx = createExecutionContext();
		const testEnv: Env = {
			...env,
			DB: undefined,
			LOG_DO: undefined,
			WEBDAV_USERNAME: 'testuser',
			WEBDAV_PASSWORD: 'testpass'
		};
		const response = await testWorker.fetch(request as any, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		await response.text();
		expect(response.status).toBe(401);
		expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm=""');
	});

	it('protects debug routes with Basic Auth', async () => {
		const request = new Request('http://example.com/_debug/d1-logs', {
			method: 'GET'
		});
		const ctx = createExecutionContext();
		const testEnv: Env = {
			...env,
			DB: undefined,
			LOG_DO: undefined,
			WEBDAV_USERNAME: 'testuser',
			WEBDAV_PASSWORD: 'testpass'
		};
		const response = await testWorker.fetch(request as any, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		await response.text();
		expect(response.status).toBe(401);
		expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm=""');
	});

	it('responds with OPTIONS for authorized request', async () => {
		const credentials = btoa('testuser:testpass');
		const request = new Request('http://example.com', {
			method: 'OPTIONS',
			headers: {
				'Authorization': `Basic ${credentials}`
			}
		});
		const ctx = createExecutionContext();
		const testEnv: Env = {
			...env,
			DB: undefined,
			LOG_DO: undefined,
			WEBDAV_USERNAME: 'testuser',
			WEBDAV_PASSWORD: 'testpass'
		};
		const response = await testWorker.fetch(request as any, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		await response.text();
		expect(response.status).toBe(200);
		expect(response.headers.get('Allow')).toContain('PROPFIND');
		expect(response.headers.get('DAV')).toBe('1, 2');
	});

	it('allows access when no auth is configured (backward compatibility)', async () => {
		const request = new Request('http://example.com', {
			method: 'OPTIONS'
		});
		const ctx = createExecutionContext();
		const testEnv: Env = {
			...env,
			DB: undefined,
			LOG_DO: undefined,
			WEBDAV_USERNAME: undefined,
			WEBDAV_PASSWORD: undefined
		};
		const response = await testWorker.fetch(request as any, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		await response.text();
		expect(response.status).toBe(200);
	});

	it('rejects macOS invalid default credentials', async () => {
		// macOS sometimes sends "No user accoun:" as credentials
		const invalidCredentials = btoa('No user accoun:');
		const request = new Request('http://example.com', {
			method: 'PROPFIND',
			headers: {
				'Authorization': `Basic ${invalidCredentials}`
			}
		});
		const ctx = createExecutionContext();
		const testEnv: Env = {
			...env,
			DB: undefined,
			LOG_DO: undefined,
			WEBDAV_USERNAME: 'testuser',
			WEBDAV_PASSWORD: 'testpass'
		};
		const response = await testWorker.fetch(request as any, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		await response.text();
		expect(response.status).toBe(401);
		expect(response.headers.get('WWW-Authenticate')).toBe('Basic realm=""');
	});

	it('handles malformed authorization header gracefully', async () => {
		const request = new Request('http://example.com', {
			method: 'GET',
			headers: {
				'Authorization': 'Basic invalid-base64!@#'
			}
		});
		const ctx = createExecutionContext();
		const testEnv: Env = {
			...env,
			DB: undefined,
			LOG_DO: undefined,
			WEBDAV_USERNAME: 'testuser',
			WEBDAV_PASSWORD: 'testpass'
		};
		const response = await testWorker.fetch(request as any, testEnv, ctx);
		await waitOnExecutionContext(ctx);
		await response.text();
		expect(response.status).toBe(401);
	});
});
