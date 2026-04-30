/**
 * WebDAV Object Tree tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ObjectTreeTest.php
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

describe('WebDAV Object Tree Tests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testGetRootNode', () => {
		it('should be able to access root node via PROPFIND', async () => {
			const request = t.createAuthRequest('PROPFIND', '/', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request);

			assertStatus(207, response);
		});
	});

	describe('testGetSubDir', () => {
		it('should be able to access subdirectory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('subdir', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/subdir', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await response.text();
			expect(body).toContain('subdir');
		});
	});

	describe('testCopyFile', () => {
		it('should copy file to new location', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'contents', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file.txt', {
				headers: { 'Destination': 'http://example.com/file2.txt' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			// Original should still exist
			const originalExists = await fileExists('file.txt', testEnv);
			expect(originalExists).toBe(true);

			// Copy should exist with same contents
			const copyExists = await fileExists('file2.txt', testEnv);
			expect(copyExists).toBe(true);

			const copyContent = await getFileContent('file2.txt', testEnv);
			expect(copyContent).toBe('contents');
		});
	});

	describe('testCopyDirectory', () => {
		it('should copy directory with all children', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('subdir', testEnv);
			await t.createTestFile('subdir/subfile.txt', 'subcontents', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/subdir', {
				headers: {
					'Destination': 'http://example.com/subdir2',
					'Depth': 'infinity'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			// Original directory should still exist
			const origDirExists = await fileExists('subdir/', testEnv);
			expect(origDirExists).toBe(true);

			// Copied directory should exist
			const copyDirExists = await fileExists('subdir2/', testEnv);
			expect(copyDirExists).toBe(true);

			// Copied file should exist with same contents
			const copyFileExists = await fileExists('subdir2/subfile.txt', testEnv);
			expect(copyFileExists).toBe(true);

			const copyFileContent = await getFileContent('subdir2/subfile.txt', testEnv);
			expect(copyFileContent).toBe('subcontents');
		});
	});

	describe('testMoveFile', () => {
		it('should move file to new location', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'contents', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file.txt', {
				headers: { 'Destination': 'http://example.com/file2.txt' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			// Original should no longer exist
			const originalExists = await fileExists('file.txt', testEnv);
			expect(originalExists).toBe(false);

			// New location should exist with same contents
			const newExists = await fileExists('file2.txt', testEnv);
			expect(newExists).toBe(true);

			const newContent = await getFileContent('file2.txt', testEnv);
			expect(newContent).toBe('contents');
		});
	});

	describe('testMoveFileNewParent', () => {
		it('should move file to a different parent directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'contents', 'text/plain', testEnv);
			await t.createTestDirectory('subdir', testEnv);

			const request = t.createAuthRequest('MOVE', '/file.txt', {
				headers: { 'Destination': 'http://example.com/subdir/file2.txt' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			// Original should no longer exist
			const originalExists = await fileExists('file.txt', testEnv);
			expect(originalExists).toBe(false);

			// New location in subdir should exist
			const newExists = await fileExists('subdir/file2.txt', testEnv);
			expect(newExists).toBe(true);

			const newContent = await getFileContent('subdir/file2.txt', testEnv);
			expect(newContent).toBe('contents');
		});
	});

	describe('testMoveDirectory', () => {
		it('should move directory with all children', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('subdir', testEnv);
			await t.createTestFile('subdir/subfile.txt', 'subcontents', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/subdir', {
				headers: {
					'Destination': 'http://example.com/subdir2',
					'Depth': 'infinity'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			// Original directory should no longer exist
			const origDirExists = await fileExists('subdir/', testEnv);
			expect(origDirExists).toBe(false);

			// New directory should exist
			const newDirExists = await fileExists('subdir2/', testEnv);
			expect(newDirExists).toBe(true);

			// Moved file should exist with same contents
			const movedFileExists = await fileExists('subdir2/subfile.txt', testEnv);
			expect(movedFileExists).toBe(true);

			const movedFileContent = await getFileContent('subdir2/subfile.txt', testEnv);
			expect(movedFileContent).toBe('subcontents');
		});
	});
});
