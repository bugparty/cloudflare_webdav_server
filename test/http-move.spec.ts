/**
 * WebDAV MOVE request tests.
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

describe('WebDAV MOVE Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testMoveToSelf', () => {
		it('should return 403 when moving file to itself', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file1', {
				headers: { 'Destination': 'http://example.com/file1' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(403, response);

			// Ensure that the source file was not deleted
			const exists = await fileExists('file1', testEnv);
			expect(exists).toBe(true);
		});
	});

	describe('testMove', () => {
		it('should move file to new location with 201 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file1', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const originalExists = await fileExists('file1', testEnv);
			expect(originalExists).toBe(false);

			const newContent = await getFileContent('file2', testEnv);
			expect(newContent).toBe('foo');
		});
	});

	describe('testMoveToExisting', () => {
		it('should overwrite existing file with 204 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);
			await t.createTestFile('file2', 'bar', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file1', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const content = await getFileContent('file2', testEnv);
			expect(content).toBe('foo');

			const originalExists = await fileExists('file1', testEnv);
			expect(originalExists).toBe(false);
		});
	});

	describe('testMoveToExistingOverwriteF', () => {
		it('should return 412 when Overwrite: F and destination exists', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);
			await t.createTestFile('file2', 'bar', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file1', {
				headers: {
					'Destination': 'http://example.com/file2',
					'Overwrite': 'F'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);

			// Ensure that the source file was not deleted
			const exists = await fileExists('file1', testEnv);
			expect(exists).toBe(true);
		});
	});

	describe('testMoveMissingDestination', () => {
		it('should return 400 when Destination header is missing', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('MOVE', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(400, response);
		});
	});

	describe('testMoveSourceNotFound', () => {
		it('should return 404 when source file does not exist', async () => {
			const request = t.createAuthRequest('MOVE', '/nonexistent', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request);

			assertStatus(404, response);
		});
	});
});
