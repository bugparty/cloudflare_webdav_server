/**
 * WebDAV Range request tests.
 * Tests for HTTP Range header support (video/audio streaming, partial content).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV Range Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('Full file requests', () => {
		it('should return Accept-Ranges header on full file request', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			expect(response.headers.get('Accept-Ranges')).toBe('bytes');
			expect(response.headers.get('Content-Length')).toBe('11');
		});

		it('should return Accept-Ranges header on HEAD request', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('HEAD', '/file.bin');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			expect(response.headers.get('Accept-Ranges')).toBe('bytes');
		});
	});

	describe('Range: bytes=0-N (first N bytes)', () => {
		it('should return first 5 bytes with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=0-4' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 0-4/11');
			expect(response.headers.get('Content-Length')).toBe('5');
			expect(response.headers.get('Accept-Ranges')).toBe('bytes');

			const content = await response.text();
			expect(content).toBe('Hello');
		});

		it('should return first byte with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=0-0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 0-0/11');
			expect(response.headers.get('Content-Length')).toBe('1');

			const content = await response.text();
			expect(content).toBe('H');
		});
	});

	describe('Range: bytes=N-M (middle bytes)', () => {
		it('should return middle bytes with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=6-10' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 6-10/11');
			expect(response.headers.get('Content-Length')).toBe('5');

			const content = await response.text();
			expect(content).toBe('World');
		});
	});

	describe('Range: bytes=N- (from N to end)', () => {
		it('should return from byte 6 to end with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=6-' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 6-10/11');
			expect(response.headers.get('Content-Length')).toBe('5');

			const content = await response.text();
			expect(content).toBe('World');
		});

		it('should return last byte with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=10-' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 10-10/11');
			expect(response.headers.get('Content-Length')).toBe('1');

			const content = await response.text();
			expect(content).toBe('d');
		});
	});

	describe('Range: bytes=-N (last N bytes)', () => {
		it('should return last 5 bytes with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=-5' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 6-10/11');
			expect(response.headers.get('Content-Length')).toBe('5');

			const content = await response.text();
			expect(content).toBe('World');
		});

		it('should return last byte with 206 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=-1' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 10-10/11');
			expect(response.headers.get('Content-Length')).toBe('1');

			const content = await response.text();
			expect(content).toBe('d');
		});
	});

	describe('Range boundary conditions', () => {
		it('should clamp end to file size if range exceeds file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=0-1000' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 0-10/11');
			expect(response.headers.get('Content-Length')).toBe('11');

			const content = await response.text();
			expect(content).toBe('Hello World');
		});

		it('should return 416 for start beyond file size', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=100-200' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(416, response);
			expect(response.headers.get('Content-Range')).toBe('bytes */11');
		});

		it('should return 416 for invalid range format', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'invalid' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(416, response);
		});

		it('should return 416 for end before start', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=5-2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(416, response);
		});
	});

	describe('Range with video files', () => {
		it('should handle range request on larger binary file', async () => {
			const testEnv = createTestEnv();
			// Create a 1KB file
			const content = new Uint8Array(1024);
			for (let i = 0; i < 1024; i++) {
				content[i] = i % 256;
			}
			await t.createTestFile('video.mp4', content.buffer as ArrayBuffer, 'video/mp4', testEnv);

			const request = t.createAuthRequest('GET', '/video.mp4', {
				headers: { 'Range': 'bytes=0-511' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Type')).toBe('video/mp4');
			expect(response.headers.get('Content-Range')).toBe('bytes 0-511/1024');
			expect(response.headers.get('Content-Length')).toBe('512');

			const body = new Uint8Array(await response.arrayBuffer());
			expect(body.length).toBe(512);
			expect(body[0]).toBe(0);
			expect(body[255]).toBe(255);
		});

		it('should handle multiple sequential range requests', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', '0123456789', 'application/octet-stream', testEnv);

			// First range
			const request1 = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=0-4' }
			});
			const response1 = await executeRequest(request1, testEnv);
			expect(await response1.text()).toBe('01234');

			// Second range
			const request2 = t.createAuthRequest('GET', '/file.bin', {
				headers: { 'Range': 'bytes=5-9' }
			});
			const response2 = await executeRequest(request2, testEnv);
			expect(await response2.text()).toBe('56789');
		});
	});

	describe('HEAD with Range header', () => {
		it('should return range headers on HEAD with Range', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.bin', 'Hello World', 'application/octet-stream', testEnv);

			const request = t.createAuthRequest('HEAD', '/file.bin', {
				headers: { 'Range': 'bytes=0-4' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(206, response);
			expect(response.headers.get('Content-Range')).toBe('bytes 0-4/11');
			expect(response.headers.get('Content-Length')).toBe('5');

			// HEAD should not return body
			const content = await response.text();
			expect(content).toBe('');
		});
	});
});
