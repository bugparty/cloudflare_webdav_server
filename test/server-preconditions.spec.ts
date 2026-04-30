/**
 * WebDAV Server Preconditions Tests
 * Based on sabre-io/dav tests/Sabre/DAV/ServerPreconditionsTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV Server Preconditions', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('If-Match', () => {
		it('should fail with 412 when If-Match: * on non-existing file', async () => {
			const request = t.createAuthRequest('GET', '/bar', {
				headers: { 'If-Match': '*' }
			});
			const response = await executeRequest(request);

			assertStatus(412, response);
		});

		it('should succeed when If-Match: * on existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Match': '*' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});

		it('should fail with 412 when If-Match with wrong ETag', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Match': '"1234"' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});

		it('should succeed when If-Match with correct ETag', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const obj = await testEnv.BUCKET.get('foo');
			const etag = obj?.httpMetadata?.etag || '"abc123"';

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Match': etag }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});

		it('should succeed when If-Match contains multiple ETags including correct one', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const obj = await testEnv.BUCKET.get('foo');
			const etag = obj?.httpMetadata?.etag || '"abc123"';

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Match': `"wrong-etag", ${etag}` }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});
	});

	describe('If-None-Match', () => {
		it('should succeed when If-None-Match: * on non-existing file', async () => {
			const request = t.createAuthRequest('GET', '/bar', {
				headers: { 'If-None-Match': '*' }
			});
			const response = await executeRequest(request);

			assertStatus(404, response);
		});

		it('should fail with 412 when If-None-Match: * on existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PUT', '/foo', {
				body: 'new content',
				headers: {
					'If-None-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});

		it('should succeed when If-None-Match with wrong ETag', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('POST', '/foo', {
				body: 'new content',
				headers: {
					'If-None-Match': '"1234"',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			// Should succeed because the ETag doesn't match
			expect(response.status === 200 || response.status === 201 || response.status === 204).toBe(true);
		});

		it('should succeed when If-None-Match with multiple wrong ETags', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('POST', '/foo', {
				body: 'new content',
				headers: {
					'If-None-Match': '"1234", "5678"',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			// Should succeed because none of the ETags match
			expect(response.status === 200 || response.status === 201 || response.status === 204).toBe(true);
		});

		it('should fail with 412 when If-None-Match with correct ETag', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const obj = await testEnv.BUCKET.get('foo');
			const etag = obj?.httpMetadata?.etag || '"abc123"';

			const request = t.createAuthRequest('POST', '/foo', {
				body: 'new content',
				headers: {
					'If-None-Match': etag,
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});

		it('should return 304 when If-None-Match with correct ETag on GET', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const obj = await testEnv.BUCKET.get('foo');
			const etag = obj?.httpMetadata?.etag || '"abc123"';

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-None-Match': etag }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(304, response);
			expect(response.headers.get('ETag')).toBe(etag);
		});
	});

	describe('If-Modified-Since', () => {
		it('should return 304 when resource not modified since date', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Modified-Since': 'Sun, 06 Nov 2094 08:49:37 GMT' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(304, response);
		});

		it('should return 200 when resource modified since date', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Modified-Since': 'Tue, 06 Nov 1984 08:49:37 GMT' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});

		it('should ignore invalid date in If-Modified-Since', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Modified-Since': 'invalid-date' }
			});
			const response = await executeRequest(request, testEnv);

			// Invalid dates should be ignored, so request should succeed
			assertStatus(200, response);
		});
	});

	describe('If-Unmodified-Since', () => {
		it('should succeed when resource not modified since date', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Unmodified-Since': 'Sun, 06 Nov 2094 08:49:37 GMT' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});

		it('should fail with 412 when resource modified since date', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Unmodified-Since': 'Tue, 06 Nov 1984 08:49:37 GMT' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});

		it('should ignore invalid date in If-Unmodified-Since', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If-Unmodified-Since': 'Sun, 06 Nov 1984 08:49:37 EST' }
			});
			const response = await executeRequest(request, testEnv);

			// Invalid dates should be ignored
			assertStatus(200, response);
		});
	});

	describe('Complex Preconditions', () => {
		it('should handle If-Match with PUT on non-existing file', async () => {
			const request = t.createAuthRequest('PUT', '/bar', {
				body: 'hello',
				headers: {
					'If-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(412, response);
		});

		it('should handle If-Match with PUT on existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('bar', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PUT', '/bar', {
				body: 'hello',
				headers: {
					'If-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);
		});

		it('should handle If-None-Match with PUT on non-existing file', async () => {
			const request = t.createAuthRequest('PUT', '/bar', {
				body: 'hello',
				headers: {
					'If-None-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(201, response);
		});

		it('should handle If-None-Match with PUT on existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('bar', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PUT', '/bar', {
				body: 'hello',
				headers: {
					'If-None-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});
	});
});
