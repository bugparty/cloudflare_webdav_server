/**
 * WebDAV COPY request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/HttpCopyTest.php
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

describe('WebDAV COPY Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testCopyFile', () => {
		it('should copy file to new location with 201 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const originalExists = await fileExists('file1', testEnv);
			expect(originalExists).toBe(true);

			const newContent = await getFileContent('file2', testEnv);
			expect(newContent).toBe('foo');
		});

		it('should accept a relative Destination path', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Destination': '/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			const newContent = await getFileContent('file2', testEnv);
			expect(newContent).toBe('foo');
		});
	});

	describe('testCopyFileToSelf', () => {
		it('should return 403 when copying file to itself', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Destination': 'http://example.com/file1' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(403, response);
		});
	});

	describe('testCopyFileToExisting', () => {
		it('should overwrite existing file with 204 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);
			await t.createTestFile('file2', 'bar', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const content = await getFileContent('file2', testEnv);
			expect(content).toBe('foo');
		});
	});

	describe('testCopyFileToExistingOverwriteF', () => {
		it('should return 412 when Overwrite: F and destination exists', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);
			await t.createTestFile('file2', 'bar', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: {
					'Destination': 'http://example.com/file2',
					'Overwrite': 'F'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});
	});

	describe('testCopyFileNonExistantParent', () => {
		it('should return 409 when destination parent does not exist', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Destination': 'http://example.com/nonexistent/file2' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(409, response);
		});
	});
});
