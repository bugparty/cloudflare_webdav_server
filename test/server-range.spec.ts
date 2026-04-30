/**
 * WebDAV Server Range Tests
 * Based on sabre-io/dav tests/Sabre/DAV/ServerRangeTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	assertHeader,
	assertBody
} from './webdav-test-utils';

describe('WebDAV Server Range Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('Basic Range', () => {
		it('should return 206 with partial content for bytes range', async () => {
			const testEnv = createTestEnv();
			// Don't set content type - should default to application/octet-stream
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=2-5' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			assertHeader('Content-Type', 'application/octet-stream', response);
			expect(response.headers.get('Content-Length')).toBe('4');
			expect(response.headers.get('Content-Range')).toBe('bytes 2-5/13');

			await assertBody('st c', response);
		});

		it('should return 206 with partial content for start-only range', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=2-' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			assertHeader('Content-Type', 'application/octet-stream', response);
			expect(response.headers.get('Content-Length')).toBe('11');
			expect(response.headers.get('Content-Range')).toBe('bytes 2-12/13');

			await assertBody('st contents', response);
		});

		it('should return 206 with partial content for end-only range', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=-8' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			assertHeader('Content-Type', 'application/octet-stream', response);
			expect(response.headers.get('Content-Length')).toBe('8');
			expect(response.headers.get('Content-Range')).toBe('bytes 5-12/13');

			await assertBody('contents', response);
		});

		it('should return 416 for range beyond file size', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=100-200' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(416, response);
		});

		it('should return 416 for invalid range (start > end)', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=8-4' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(416, response);
		});
	});

	describe('HEAD Range', () => {
		it('should return 200 for HEAD request (ignores Range header per PHP test)', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('HEAD', '/test.txt', {
				headers: { 'Range': 'bytes=2-' }
			});
			const response = await executeRequest(request, testEnv);

			// Per PHP test: HEAD with Range returns full content (200)
			assertStatus(200, response);
			assertHeader('Content-Type', 'application/octet-stream', response);
			expect(response.headers.get('Content-Length')).toBe('13');
		});
	});

	describe('If-Range Header', () => {
		it('should return 206 when If-Range ETag matches', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			// Get ETag from HEAD request
			const headRequest = t.createAuthRequest('HEAD', '/test.txt');
			const headResponse = await executeRequest(headRequest, testEnv);
			const etag = headResponse.headers.get('ETag') || '';

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: {
					'Range': 'bytes=2-5',
					'If-Range': etag
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 2-5/13');
		});

		it('should return 200 when If-Range ETag does not match', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: {
					'Range': 'bytes=2-5',
					'If-Range': '"wrong-etag"'
				}
			});
			const response = await executeRequest(request, testEnv);

			// When If-Range doesn't match, server returns full entity (200)
			assertStatus(200, response);
			expect(response.headers.get('Content-Length')).toBe('13');
		});

		it('should return 206 when If-Range date is after (or same as) file modification date', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			// Per PHP test: If-Range: "tomorrow" → 206 (client has newer version, range is valid)
			const futureDate = new Date(Date.now() + 86400000).toUTCString(); // tomorrow
			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: {
					'Range': 'bytes=2-5',
					'If-Range': futureDate
				}
			});
			const response = await executeRequest(request, testEnv);

			// If-Range date >= Last-Modified → range is valid → 206
			assertStatus(206, response);
		});

		it('should return 200 when If-Range date is before file modification date', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			// Per PHP test: If-Range: "-2 years" → 200 (client has older version, return full)
			// Use a date 2 years ago
			const pastDate = new Date(Date.now() - 2 * 365 * 86400000).toUTCString();
			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: {
					'Range': 'bytes=2-5',
					'If-Range': pastDate
				}
			});
			const response = await executeRequest(request, testEnv);

			// When If-Range condition fails, server returns full entity (200)
			assertStatus(200, response);
			await assertBody('Test contents', response);
		});
	});

	describe('Multiple Ranges', () => {
		it('should handle multiple ranges in request', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=0-1, 3-5' }
			});
			const response = await executeRequest(request, testEnv);

			// Multi-part response (implementation may vary)
			expect([206, 416]).toContain(response.status);
		});
	});

	describe('Edge Cases', () => {
		it('should handle range on non-existent file', async () => {
			const request = t.createAuthRequest('GET', '/notfound.txt', {
				headers: { 'Range': 'bytes=0-5' }
			});
			const response = await executeRequest(request);

			assertStatus(404, response);
		});

		it('should handle range with exact end at file boundary', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Test contents', undefined, testEnv);

			// File is 13 bytes (indices 0-12), so bytes=5-12 should work
			const request = t.createAuthRequest('GET', '/test.txt', {
				headers: { 'Range': 'bytes=5-12' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
		});
	});
});
