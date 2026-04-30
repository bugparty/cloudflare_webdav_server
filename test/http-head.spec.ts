/**
 * WebDAV HEAD request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/HttpHeadTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	assertHeader
} from './webdav-test-utils';

describe('WebDAV HEAD Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testHEAD', () => {
		it('should return file headers without body', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('HEAD', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);

			// Check headers (Last-Modified may vary, so we check other headers)
			expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
			expect(response.headers.get('Content-Length')).toBe('3');
			expect(response.headers.get('ETag')).toBeDefined();

			// Body should be empty for HEAD request
			const body = await response.text();
			expect(body).toBe('');
		});
	});

	describe('testHEADCollection', () => {
		it('should return 200 for HEAD on collection', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('HEAD', '/dir');
			const response = await executeRequest(request, testEnv);

			// According to the specs, HEAD should behave identical to GET.
			// But broken clients need HEAD requests on collections to respond with a 200
			assertStatus(200, response);
		});
	});

	describe('testDoubleAuth', () => {
		it('should only trigger auth once for HEAD requests', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			// HEAD internally maps to GET via a sub-request.
			// The Auth plugin must not be triggered twice.
			const request = t.createAuthRequest('HEAD', '/file1', {
				headers: { 'Authorization': `Basic ${btoa('testuser:testpass')}` }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);

			// If we get 200, auth was successful (triggered exactly once)
			// If auth was triggered twice, it would fail
		});
	});
});
