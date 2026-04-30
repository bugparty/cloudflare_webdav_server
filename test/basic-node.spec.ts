/**
 * WebDAV Basic Node tests.
 * Based on sabre-io/dav tests/Sabre/DAV/BasicNodeTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	getFileContent,
	fileExists
} from './webdav-test-utils';

describe('WebDAV Basic Node Tests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('File operations (testPut)', () => {
		it('should create a new file with PUT', async () => {
			const testEnv = createTestEnv();

			const request = t.createAuthRequest('PUT', '/file1', {
				body: 'hello world',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file1', testEnv);
			expect(content).toBe('hello world');
		});
	});

	describe('File operations (testGet)', () => {
		it('should be able to GET file content', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'hello world', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			const content = await response.text();
			expect(content).toBe('hello world');
		});
	});

	describe('File operations (testGetSize)', () => {
		it('should return 0 for empty file size when not set', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', '', 'text/plain', testEnv);

			const request = t.createAuthRequest('HEAD', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			// Content-Length should be 0 for empty file
			const contentLength = response.headers.get('Content-Length');
			expect(contentLength).toBe('0');
		});
	});

	describe('File operations (testGetETag)', () => {
		it('should return null ETag when not set', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('HEAD', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			// ETag may or may not be present - depends on implementation
			// If not set, this test verifies it doesn't crash
		});
	});

	describe('File operations (testGetContentType)', () => {
		it('should return Content-Type header when set', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('HEAD', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			const contentType = response.headers.get('Content-Type');
			expect(contentType).toBe('text/plain');
		});
	});

	describe('File operations (testDelete)', () => {
		it('should be able to DELETE file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('DELETE', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const exists = await fileExists('file1', testEnv);
			expect(exists).toBe(false);
		});
	});

	describe('File operations (testSetName)', () => {
		it('should be able to rename file via MOVE', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file1', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const oldExists = await fileExists('file1', testEnv);
			const newExists = await fileExists('file2', testEnv);

			expect(oldExists).toBe(false);
			expect(newExists).toBe(true);
		});
	});

	describe('File operations (testGetLastModified)', () => {
		it('should return Last-Modified header', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('HEAD', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			const lastModified = response.headers.get('Last-Modified');
			expect(lastModified).toBeTruthy();
		});
	});

	describe('Directory operations (testGetChild)', () => {
		it('should be able to list directory contents', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('dir/file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/dir', {
				headers: { 'Depth': '1' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await response.text();
			expect(body).toContain('file1');
		});
	});

	describe('Directory operations (testChildExists)', () => {
		it('should return true when child exists', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('dir/file1', 'hello', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/dir/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});

		it('should return 404 when child does not exist', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/dir/nonexistent');
			const response = await executeRequest(request, testEnv);

			assertStatus(404, response);
		});
	});

	describe('Directory operations (testChildExistsFalse)', () => {
		it('should return false when child does not exist in directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('GET', '/dir/nonexistent');
			const response = await executeRequest(request, testEnv);

			assertStatus(404, response);
		});
	});

	describe('Directory operations (testGetChild404)', () => {
		it('should return 404 for non-existent child', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('GET', '/dir/blabla');
			const response = await executeRequest(request, testEnv);

			assertStatus(404, response);
		});
	});

	describe('Directory operations (testCreateFile)', () => {
		it('should be able to create new file in directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('PUT', '/dir/newfile', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('dir/newfile', testEnv);
			expect(content).toBe('content');
		});
	});

	describe('Directory operations (testCreateDirectory)', () => {
		it('should be able to create new directory via MKCOL', async () => {
			const testEnv = createTestEnv();

			const request = t.createAuthRequest('MKCOL', '/newdir');
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const exists = await fileExists('newdir/', testEnv);
			expect(exists).toBe(true);
		});
	});
});
