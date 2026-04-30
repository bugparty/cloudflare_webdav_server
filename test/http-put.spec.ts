/**
 * WebDAV PUT request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/HttpPutTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	getFileContent
} from './webdav-test-utils';

describe('WebDAV PUT Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testPut', () => {
		it('should create a new file with 201 status', async () => {
			const request = t.createAuthRequest('PUT', '/file2', {
				body: 'hello',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request);

			assertStatus(201, response);

			const content = await getFileContent('file2');
			expect(content).toBe('hello');
		});
	});

	describe('testPutExisting', () => {
		it('should update existing file with 204 status', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('PUT', '/file1', {
				body: 'bar',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const content = await getFileContent('file1');
			expect(content).toBe('bar');
		});
	});

	describe('testPutContentRange', () => {
		it('should reject PUT with Content-Range header', async () => {
			const request = t.createAuthRequest('PUT', '/file2', {
				body: 'hello',
				headers: {
					'Content-Range': 'bytes/100-200',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(400, response);
		});
	});

	describe('testPutIfNoneMatchStar', () => {
		it('should create file with If-None-Match: * (new file)', async () => {
			const request = t.createAuthRequest('PUT', '/file2', {
				body: 'hello',
				headers: {
					'If-None-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(201, response);

			const content = await getFileContent('file2');
			expect(content).toBe('hello');
		});
	});

	describe('testPutIfMatchStar', () => {
		it('should fail with 412 when If-Match: * on non-existing file', async () => {
			const request = t.createAuthRequest('PUT', '/file2', {
				body: 'hello',
				headers: {
					'If-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(412, response);
		});
	});

	describe('testPutExistingIfNoneMatchStar', () => {
		it('should fail with 412 when If-None-Match: * on existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('PUT', '/file1', {
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

	describe('testPutExistingIfMatchStar', () => {
		it('should update existing file with If-Match: *', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('PUT', '/file1', {
				body: 'hello',
				headers: {
					'If-Match': '*',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(204, response);

			const content = await getFileContent('file1');
			expect(content).toBe('hello');
		});
	});

	describe('testPutParentCollectionDoesNotExist', () => {
		it('should return 409 when parent collection does not exist', async () => {
			const request = t.createAuthRequest('PUT', '/non-existent-collection/file2', {
				body: 'hello',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request);

			assertStatus(409, response);
		});
	});

	describe('testFinderPutSuccess', () => {
		it('should succeed when X-Expected-Entity-Length matches body', async () => {
			const request = t.createAuthRequest('PUT', '/file2', {
				body: 'hello',
				headers: {
					'X-Expected-Entity-Length': '5',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(201, response);

			const content = await getFileContent('file2');
			expect(content).toBe('hello');
		});
	});

	describe('testFinderPutFail', () => {
		it('should fail with 403 when X-Expected-Entity-Length does not match body', async () => {
			const request = t.createAuthRequest('PUT', '/file2', {
				body: '',
				headers: {
					'X-Expected-Entity-Length': '5',
					'Content-Type': 'text/plain'
				}
			});
			const response = await executeRequest(request);

			assertStatus(403, response);
		});
	});
});
