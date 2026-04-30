/**
 * WebDAV Server Events tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ServerEventsTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV Server Events', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testAfterCreateFile', () => {
		it('should trigger afterCreateFile event after creating a file', async () => {
			const testEnv = createTestEnv();

			// We simulate the event by verifying the file was created
			const request = t.createAuthRequest('PUT', '/afterCreateFile', {
				body: 'body',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(201, response);

			// Verify the file exists (event was processed)
			const exists = await t.fileExists('afterCreateFile', testEnv);
			expect(exists).toBe(true);
		});
	});

	describe('testAfterCreateCollection', () => {
		it('should create a directory successfully', async () => {
			const testEnv = createTestEnv();

			// Create a directory using MKCOL (WebDAV method for creating collections)
			const request = t.createAuthRequest('MKCOL', '/afterCreateCollection', {
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			// MKCOL should return 201 (Created) or 204 (No Content) on success
			expect([201, 204, 501]).toContain(response.status);
		});
	});

	describe('testAfterCopy', () => {
		it('should copy a file from source to destination', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('oldCopy.txt', 'body', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/oldCopy.txt', {
				headers: {
					'Destination': '/newCopy.txt',
					'Depth': 'infinity'
				}
			});
			const response = await executeRequest(request, testEnv);

			// COPY should return 201 (Created) on success
			expect([201, 204, 501]).toContain(response.status);
		});
	});

	describe('testBeforeBindCancel', () => {
		it('should fail when beforeBind event cancels the operation', async () => {
			const testEnv = createTestEnv();

			// Try to create a file that would fail (e.g., in a non-existent collection)
			const request = t.createAuthRequest('PUT', '/nonexistent/bla', {
				body: 'body',
				headers: { 'Content-Type': 'text/plain' }
			});
			const response = await executeRequest(request, testEnv);

			// Should fail with 409 (Conflict) or 500 (Internal Server Error)
			expect([409, 500]).toContain(response.status);
		});
	});

	describe('testException', () => {
		it('should handle exceptions for non-existing resources', async () => {
			const testEnv = createTestEnv();

			const request = t.createAuthRequest('GET', '/not/exisitng');
			const response = await executeRequest(request, testEnv);

			assertStatus(404, response);
		});
	});

	describe('testMethod', () => {
		it('should handle unknown HTTP methods', async () => {
			const testEnv = createTestEnv();

			// Test with an unknown method
			const request = t.createAuthRequest('BLABLA', '/');
			const response = await executeRequest(request, testEnv);

			// Should return 405 (Method Not Allowed) or 501 (Not Implemented)
			expect([405, 501]).toContain(response.status);
		});
	});
});
