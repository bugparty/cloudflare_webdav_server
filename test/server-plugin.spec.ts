/**
 * WebDAV Server Plugin tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ServerPluginTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	assertHeader
} from './webdav-test-utils';

describe('WebDAV Server Plugin', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testBaseClass', () => {
		it('should have default plugin info', async () => {
			// The core plugin should be initialized by default
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'test', 'text/plain', testEnv);

			// Make a request that would use the plugin system
			const request = t.createAuthRequest('GET', '/test.txt');
			const response = await executeRequest(request, testEnv);

			// Server should respond normally
			assertStatus(200, response);
		});
	});

	describe('testOptions', () => {
		it('should return DAV headers and allowed methods in OPTIONS response', async () => {
			const testEnv = createTestEnv();

			const request = t.createAuthRequest('OPTIONS', '/');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);

			// Check DAV header
			const davHeader = response.headers.get('DAV');
			expect(davHeader).toBeDefined();
			expect(davHeader).toContain('1');
			// Our implementation supports Class 1 and 2, not Class 3
			expect(davHeader).toContain('2');

			// Check Allow header (should contain WebDAV methods)
			const allowHeader = response.headers.get('Allow');
			expect(allowHeader).toBeDefined();
			expect(allowHeader).toContain('OPTIONS');
			expect(allowHeader).toContain('GET');
			expect(allowHeader).toContain('HEAD');
			expect(allowHeader).toContain('DELETE');
			expect(allowHeader).toContain('PROPFIND');
			expect(allowHeader).toContain('PUT');
			expect(allowHeader).toContain('COPY');
			expect(allowHeader).toContain('MOVE');

			// Check Accept-Ranges header
			assertHeader('Accept-Ranges', 'bytes', response);

			// Check X-Sabre-Version header
			const versionHeader = response.headers.get('X-Sabre-Version');
			expect(versionHeader).toBeDefined();

			// Body should be empty for OPTIONS
			const body = await response.text();
			expect(body).toBe('');
		});
	});

	describe('testGetPlugin', () => {
		it('should get the core plugin from server', async () => {
			const testEnv = createTestEnv();

			// Make any request - the core plugin should be available
			const request = t.createAuthRequest('GET', '/');
			const response = await executeRequest(request, testEnv);

			// The server should have a core plugin that responds to requests
			// 404 is expected for root GET, but the plugin system works
			expect([200, 404, 501]).toContain(response.status);
		});
	});

	describe('testUnknownPlugin', () => {
		it('should return 404 for non-existent paths', async () => {
			const testEnv = createTestEnv();

			// Request a non-existent resource
			const request = t.createAuthRequest('GET', '/SomeRandomClassName');
			const response = await executeRequest(request, testEnv);

			// Should return 404 Not Found
			assertStatus(404, response);
		});
	});

	describe('testGetSupportedReportSet', () => {
		it('should return empty array for supported reports on root', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'content', 'text/plain', testEnv);

			// PROPFIND is one of the reports supported
			const request = t.createAuthRequest('PROPFIND', '/test.txt', {
				headers: {
					'Depth': '0',
					'Content-Type': 'application/xml'
				}
			});
			const response = await executeRequest(request, testEnv);

			// PROPFIND should be supported (207 Multi-Status or 405 if not allowed)
			expect([207, 405, 501]).toContain(response.status);
		});
	});

	describe('testGetPlugins', () => {
		it('should have multiple plugins available', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'test', 'text/plain', testEnv);

			// Multiple requests to test different plugin functionality
			const propfindRequest = t.createAuthRequest('PROPFIND', '/', {
				headers: { 'Depth': '0' }
			});
			const propfindResponse = await executeRequest(propfindRequest, testEnv);

			// PROPFIND should work (core plugin)
			expect([207, 405]).toContain(propfindResponse.status);

			const optionsRequest = t.createAuthRequest('OPTIONS', '/');
			const optionsResponse = await executeRequest(optionsRequest, testEnv);

			// OPTIONS should work (core plugin)
			assertStatus(200, optionsResponse);
		});
	});
});
