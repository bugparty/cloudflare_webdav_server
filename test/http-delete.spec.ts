/**
 * WebDAV DELETE request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/HttpDeleteTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	fileExists
} from './webdav-test-utils';

describe('WebDAV DELETE Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testDelete', () => {
		it('should delete a file with 204 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('DELETE', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const exists = await fileExists('file1', testEnv);
			expect(exists).toBe(false);
		});
	});

	describe('testDeleteDirectory', () => {
		it('should delete a directory with 204 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);
			await t.createTestFile('dir/subfile', 'bar', 'text/plain', testEnv);

			const request = t.createAuthRequest('DELETE', '/dir');
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const dirExists = await fileExists('dir/', testEnv);
			expect(dirExists).toBe(false);
		});
	});

	describe('testDeleteNotFound', () => {
		it('should return 404 for non-existent file', async () => {
			const request = t.createAuthRequest('DELETE', '/file2');
			const response = await executeRequest(request);

			assertStatus(404, response);
		});
	});

	describe('testDeletePreconditions', () => {
		it('should delete with correct If-Match header', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			// Fetch the ETag first
			const getRequest = t.createAuthRequest('GET', '/file1');
			const getResponse = await executeRequest(getRequest, testEnv);
			const etag = getResponse.headers.get('ETag');
			expect(etag).toBeTruthy();

			const request = t.createAuthRequest('DELETE', '/file1', {
				headers: { 'If-Match': etag! }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);
		});
	});

	describe('testDeletePreconditionsFailed', () => {
		it('should fail with 412 for incorrect If-Match header', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('DELETE', '/file1', {
				headers: { 'If-Match': '"wrong-etag"' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(412, response);
		});
	});
});
