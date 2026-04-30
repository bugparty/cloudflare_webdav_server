/**
 * WebDAV MOVE/COPY collection (directory) tests.
 * Based on sabre-io/dav tests/Sabre/DAV/HttpMoveTest.php
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

describe('WebDAV MOVE/COPY Collections', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('MOVE Collections', () => {
		describe('testMoveEmptyCollection', () => {
			it('should move empty collection to new location with 201 status', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);

				const request = t.createAuthRequest('MOVE', '/dir1/', {
					headers: { 'Destination': 'http://example.com/dir2/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				const originalExists = await fileExists('dir1/', testEnv);
				expect(originalExists).toBe(false);

				const newExists = await fileExists('dir2/', testEnv);
				expect(newExists).toBe(true);
			});
		});

		describe('testMoveCollectionWithFile', () => {
			it('should move collection with file to new location', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestFile('dir1/file1.txt', 'content', 'text/plain', testEnv);

				const request = t.createAuthRequest('MOVE', '/dir1/', {
					headers: { 'Destination': 'http://example.com/dir2/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				const originalDirExists = await fileExists('dir1/', testEnv);
				expect(originalDirExists).toBe(false);

				const originalFileExists = await fileExists('dir1/file1.txt', testEnv);
				expect(originalFileExists).toBe(false);

				const newDirExists = await fileExists('dir2/', testEnv);
				expect(newDirExists).toBe(true);

				const newFileContent = await getFileContent('dir2/file1.txt', testEnv);
				expect(newFileContent).toBe('content');
			});
		});

		describe('testMoveCollectionWithNestedStructure', () => {
			it('should move collection with nested directories and files', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestDirectory('dir1/subdir', testEnv);
				await t.createTestFile('dir1/file1.txt', 'file1 content', 'text/plain', testEnv);
				await t.createTestFile('dir1/subdir/file2.txt', 'file2 content', 'text/plain', testEnv);

				const request = t.createAuthRequest('MOVE', '/dir1/', {
					headers: { 'Destination': 'http://example.com/dir2/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				const newDirExists = await fileExists('dir2/', testEnv);
				expect(newDirExists).toBe(true);

				const newSubdirExists = await fileExists('dir2/subdir/', testEnv);
				expect(newSubdirExists).toBe(true);

				const newFile1 = await getFileContent('dir2/file1.txt', testEnv);
				expect(newFile1).toBe('file1 content');

				const newFile2 = await getFileContent('dir2/subdir/file2.txt', testEnv);
				expect(newFile2).toBe('file2 content');
			});
		});

		describe('testRenameCollection', () => {
			it('should rename collection in same parent directory', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('olddir', testEnv);
				await t.createTestFile('olddir/file.txt', 'content', 'text/plain', testEnv);

				const request = t.createAuthRequest('MOVE', '/olddir/', {
					headers: { 'Destination': 'http://example.com/newdir/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				const oldExists = await fileExists('olddir/', testEnv);
				expect(oldExists).toBe(false);

				const newExists = await fileExists('newdir/', testEnv);
				expect(newExists).toBe(true);

				const fileContent = await getFileContent('newdir/file.txt', testEnv);
				expect(fileContent).toBe('content');
			});
		});

		describe('testMoveCollectionToExistingCollection', () => {
			it('should overwrite existing collection with 204 status', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestFile('dir1/file1.txt', 'content1', 'text/plain', testEnv);
				await t.createTestDirectory('dir2', testEnv);
				await t.createTestFile('dir2/file2.txt', 'content2', 'text/plain', testEnv);

				const request = t.createAuthRequest('MOVE', '/dir1/', {
					headers: { 'Destination': 'http://example.com/dir2/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(204, response);

				const originalExists = await fileExists('dir1/', testEnv);
				expect(originalExists).toBe(false);

				// dir2 should now contain file1, not file2
				const file1Content = await getFileContent('dir2/file1.txt', testEnv);
				expect(file1Content).toBe('content1');

				// file2 should be gone (overwritten)
				const file2Exists = await fileExists('dir2/file2.txt', testEnv);
				expect(file2Exists).toBe(false);
			});
		});

		describe('testMoveCollectionToExistingWithOverwriteF', () => {
			it('should return 412 when Overwrite: F and destination exists', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestDirectory('dir2', testEnv);

				const request = t.createAuthRequest('MOVE', '/dir1/', {
					headers: {
						'Destination': 'http://example.com/dir2/',
						'Overwrite': 'F'
					}
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(412, response);

				// Source should still exist
				const sourceExists = await fileExists('dir1/', testEnv);
				expect(sourceExists).toBe(true);
			});
		});

		describe('testMoveCollectionSourceNotFound', () => {
			it('should return 404 when source collection does not exist', async () => {
				const request = t.createAuthRequest('MOVE', '/nonexistent/', {
					headers: { 'Destination': 'http://example.com/newdir/' }
				});
				const response = await executeRequest(request);

				assertStatus(404, response);
			});
		});

		describe('testMoveCollectionParentNotFound', () => {
			it('should return 409 when destination parent does not exist', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);

				const request = t.createAuthRequest('MOVE', '/dir1/', {
					headers: { 'Destination': 'http://example.com/nonexistent/newdir/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(409, response);
			});
		});

		describe('testMoveCollectionIntoAnotherDirectory', () => {
			it('should move collection into another existing directory', async () => {
				const testEnv = createTestEnv();
				// Create source directory with files
				await t.createTestDirectory('sourcedir', testEnv);
				await t.createTestFile('sourcedir/file1.txt', 'content1', 'text/plain', testEnv);
				await t.createTestFile('sourcedir/file2.txt', 'content2', 'text/plain', testEnv);

				// Create target directory
				await t.createTestDirectory('targetdir', testEnv);

				const request = t.createAuthRequest('MOVE', '/sourcedir/', {
					headers: { 'Destination': 'http://example.com/targetdir/sourcedir/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				// Source should be gone
				const sourceExists = await fileExists('sourcedir/', testEnv);
				expect(sourceExists).toBe(false);

				// Should exist in target directory
				const newDirExists = await fileExists('targetdir/sourcedir/', testEnv);
				expect(newDirExists).toBe(true);

				const file1Content = await getFileContent('targetdir/sourcedir/file1.txt', testEnv);
				expect(file1Content).toBe('content1');

				const file2Content = await getFileContent('targetdir/sourcedir/file2.txt', testEnv);
				expect(file2Content).toBe('content2');
			});
		});

		describe('testMoveNestedCollectionIntoAnotherDirectory', () => {
			it('should move nested collection structure into another directory', async () => {
				const testEnv = createTestEnv();
				// Create source with nested structure
				await t.createTestDirectory('sourcedir', testEnv);
				await t.createTestDirectory('sourcedir/subdir', testEnv);
				await t.createTestFile('sourcedir/file1.txt', 'file1', 'text/plain', testEnv);
				await t.createTestFile('sourcedir/subdir/file2.txt', 'file2', 'text/plain', testEnv);

				// Create target directory
				await t.createTestDirectory('targetdir', testEnv);

				const request = t.createAuthRequest('MOVE', '/sourcedir/', {
					headers: { 'Destination': 'http://example.com/targetdir/sourcedir/' }
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				// Check nested structure is preserved
				const subdirExists = await fileExists('targetdir/sourcedir/subdir/', testEnv);
				expect(subdirExists).toBe(true);

				const file1 = await getFileContent('targetdir/sourcedir/file1.txt', testEnv);
				expect(file1).toBe('file1');

				const file2 = await getFileContent('targetdir/sourcedir/subdir/file2.txt', testEnv);
				expect(file2).toBe('file2');
			});
		});
	});

	describe('COPY Collections', () => {
		describe('testCopyEmptyCollection', () => {
			it('should copy empty collection to new location with 201 status', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);

				const request = t.createAuthRequest('COPY', '/dir1/', {
					headers: {
						'Destination': 'http://example.com/dir2/',
						'Depth': 'infinity'
					}
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				// Original should still exist
				const originalExists = await fileExists('dir1/', testEnv);
				expect(originalExists).toBe(true);

				const newExists = await fileExists('dir2/', testEnv);
				expect(newExists).toBe(true);
			});
		});

		describe('testCopyCollectionWithFiles', () => {
			it('should copy collection with files (depth infinity)', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestFile('dir1/file1.txt', 'content', 'text/plain', testEnv);

				const request = t.createAuthRequest('COPY', '/dir1/', {
					headers: {
						'Destination': 'http://example.com/dir2/',
						'Depth': 'infinity'
					}
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				// Original should still exist
				const originalFile = await getFileContent('dir1/file1.txt', testEnv);
				expect(originalFile).toBe('content');

				// Copy should exist
				const copyFile = await getFileContent('dir2/file1.txt', testEnv);
				expect(copyFile).toBe('content');
			});
		});

		describe('testCopyCollectionDepthZero', () => {
			it('should copy only the collection itself, not its children', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestFile('dir1/file1.txt', 'content', 'text/plain', testEnv);

				const request = t.createAuthRequest('COPY', '/dir1/', {
					headers: {
						'Destination': 'http://example.com/dir2/',
						'Depth': '0'
					}
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				// New directory should exist but be empty
				const newDirExists = await fileExists('dir2/', testEnv);
				expect(newDirExists).toBe(true);

				const newFileExists = await fileExists('dir2/file1.txt', testEnv);
				expect(newFileExists).toBe(false);
			});
		});

		describe('testCopyCollectionToExisting', () => {
			it('should overwrite existing collection with 204 status', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestFile('dir1/file1.txt', 'content1', 'text/plain', testEnv);
				await t.createTestDirectory('dir2', testEnv);
				await t.createTestFile('dir2/file2.txt', 'content2', 'text/plain', testEnv);

				const request = t.createAuthRequest('COPY', '/dir1/', {
					headers: {
						'Destination': 'http://example.com/dir2/',
						'Depth': 'infinity'
					}
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(204, response);

				// Original should still exist
				const originalExists = await fileExists('dir1/file1.txt', testEnv);
				expect(originalExists).toBe(true);

				// Destination should have file1
				const copyFile = await getFileContent('dir2/file1.txt', testEnv);
				expect(copyFile).toBe('content1');
			});
		});

		describe('testCopyCollectionWithNestedStructure', () => {
			it('should copy nested directories and files', async () => {
				const testEnv = createTestEnv();
				await t.createTestDirectory('dir1', testEnv);
				await t.createTestDirectory('dir1/subdir', testEnv);
				await t.createTestFile('dir1/file1.txt', 'file1', 'text/plain', testEnv);
				await t.createTestFile('dir1/subdir/file2.txt', 'file2', 'text/plain', testEnv);

				const request = t.createAuthRequest('COPY', '/dir1/', {
					headers: {
						'Destination': 'http://example.com/dir2/',
						'Depth': 'infinity'
					}
				});
				const response = await executeRequest(request, testEnv);

				assertStatus(201, response);

				const copyFile1 = await getFileContent('dir2/file1.txt', testEnv);
				expect(copyFile1).toBe('file1');

				const copyFile2 = await getFileContent('dir2/subdir/file2.txt', testEnv);
				expect(copyFile2).toBe('file2');
			});
		});
	});
});
