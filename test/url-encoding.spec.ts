/**
 * WebDAV URL encoding tests.
 * Tests for handling special characters in file and directory names.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	fileExists,
	getFileContent
} from './webdav-test-utils';

describe('WebDAV URL Encoding', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('File names with spaces', () => {
		it('should PUT file with space in name', async () => {
			const testEnv = createTestEnv();
			const request = t.createAuthRequest('PUT', '/test%20space.txt', {
				body: 'content with space',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('test space.txt', testEnv);
			expect(content).toBe('content with space');
		});

		it('should GET file with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test space.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/test%20space.txt');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			const content = await response.text();
			expect(content).toBe('content');
		});

		it('should DELETE file with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test space.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('DELETE', '/test%20space.txt');
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const exists = await fileExists('test space.txt', testEnv);
			expect(exists).toBe(false);
		});

		it('should MOVE file with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test space.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/test%20space.txt', {
				headers: { 'Destination': 'http://example.com/new%20name.txt' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const oldExists = await fileExists('test space.txt', testEnv);
			expect(oldExists).toBe(false);

			const content = await getFileContent('new name.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should COPY file with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test space.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/test%20space.txt', {
				headers: { 'Destination': 'http://example.com/copy%20space.txt' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const original = await getFileContent('test space.txt', testEnv);
			expect(original).toBe('content');

			const copy = await getFileContent('copy space.txt', testEnv);
			expect(copy).toBe('content');
		});

		it('should PROPFIND file with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test space.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/test%20space.txt', {
				headers: { 'Depth': '0' },
				body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>'
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await response.text();
			expect(body).toContain('test%20space.txt');
		});
	});

	describe('File names with special characters', () => {
		it('should handle parentheses in file name', async () => {
			const testEnv = createTestEnv();
			// file (1).txt -> file%20%281%29.txt
			const request = t.createAuthRequest('PUT', '/file%20%281%29.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file (1).txt', testEnv);
			expect(content).toBe('content');
		});

		it('should handle plus sign in file name', async () => {
			const testEnv = createTestEnv();
			// file+name.txt -> file%2Bname.txt
			const request = t.createAuthRequest('PUT', '/file%2Bname.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file+name.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should handle ampersand in file name', async () => {
			const testEnv = createTestEnv();
			// file&name.txt -> file%26name.txt
			const request = t.createAuthRequest('PUT', '/file%26name.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file&name.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should handle hash in file name', async () => {
			const testEnv = createTestEnv();
			// file#name.txt -> file%23name.txt
			const request = t.createAuthRequest('PUT', '/file%23name.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file#name.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should handle percent sign in file name', async () => {
			const testEnv = createTestEnv();
			// 100%.txt -> 100%25.txt
			const request = t.createAuthRequest('PUT', '/100%25.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('100%.txt', testEnv);
			expect(content).toBe('content');
		});
	});

	describe('Directory names with spaces', () => {
		it('should MKCOL directory with space in name', async () => {
			const testEnv = createTestEnv();
			const request = t.createAuthRequest('MKCOL', '/my%20folder/');
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const exists = await fileExists('my folder/', testEnv);
			expect(exists).toBe(true);
		});

		it('should PUT file in directory with space', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('my folder', testEnv);

			const request = t.createAuthRequest('PUT', '/my%20folder/file.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('my folder/file.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should MOVE directory with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('old folder', testEnv);
			await t.createTestFile('old folder/file.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/old%20folder/', {
				headers: { 'Destination': 'http://example.com/new%20folder/' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const oldExists = await fileExists('old folder/', testEnv);
			expect(oldExists).toBe(false);

			const content = await getFileContent('new folder/file.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should PROPFIND directory with space in name', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('my folder', testEnv);
			await t.createTestFile('my folder/file.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/my%20folder/', {
				headers: { 'Depth': '1' },
				body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>'
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await response.text();
			expect(body).toContain('my%20folder/');
			expect(body).toContain('file.txt');
		});
	});

	describe('Multiple spaces and special chars', () => {
		it('should handle multiple spaces in file name', async () => {
			const testEnv = createTestEnv();
			// "file  with   spaces.txt" -> "file%20%20with%20%20%20spaces.txt"
			const request = t.createAuthRequest('PUT', '/file%20%20with%20%20%20spaces.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file  with   spaces.txt', testEnv);
			expect(content).toBe('content');
		});

		it('should handle complex file name with multiple special chars', async () => {
			const testEnv = createTestEnv();
			// "file (copy) [1].txt" -> "file%20%28copy%29%20%5B1%5D.txt"
			const request = t.createAuthRequest('PUT', '/file%20%28copy%29%20%5B1%5D.txt', {
				body: 'content',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const content = await getFileContent('file (copy) [1].txt', testEnv);
			expect(content).toBe('content');
		});
	});
});
