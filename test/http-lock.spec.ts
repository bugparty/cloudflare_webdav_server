/**
 * WebDAV LOCK/UNLOCK tests.
 * Tests for RFC 4918 locking functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV LOCK/UNLOCK', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('LOCK', () => {
		it('should create a lock on an existing resource', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'Hello World', 'text/plain', testEnv);

			const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
  <D:owner>Test User</D:owner>
</D:lockinfo>`;

			const request = t.createAuthRequest('LOCK', '/test.txt', {
				body: lockBody,
				headers: {
					'Content-Type': 'application/xml; charset=utf-8',
					'Depth': '0'
				}
			});

			const response = await executeRequest(request, testEnv);

			// Should return 200 OK for existing resource
			assertStatus(200, response);
			expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');
			expect(response.headers.get('Lock-Token')).toBeDefined();

			// Verify response body contains lock information
			const body = await response.text();
			expect(body).toContain('lockdiscovery');
			expect(body).toContain('opaquelocktoken:');
		});

		it('should create a lock on a non-existing resource', async () => {
			const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
  <D:owner>Test User</D:owner>
</D:lockinfo>`;

			const request = t.createAuthRequest('LOCK', '/newfile.txt', {
				body: lockBody,
				headers: {
					'Content-Type': 'application/xml; charset=utf-8'
				}
			});

			const response = await executeRequest(request);

			// Should return 201 Created for new resource lock
			assertStatus(201, response);
			expect(response.headers.get('Lock-Token')).toBeDefined();
		});

		it('should reject write operations without lock token on locked resource', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('locked.txt', 'content', 'text/plain', testEnv);

			// Lock the file
			const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
</D:lockinfo>`;

			const lockRequest = t.createAuthRequest('LOCK', '/locked.txt', {
				body: lockBody,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});

			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(200, lockResponse);

			// Try to delete without lock token
			const deleteRequest = t.createAuthRequest('DELETE', '/locked.txt');
			const deleteResponse = await executeRequest(deleteRequest, testEnv);

			// Should return 423 Locked
			assertStatus(423, deleteResponse);
		});

		it('should allow write operations with correct lock token', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('locked.txt', 'content', 'text/plain', testEnv);

			// Lock the file
			const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
</D:lockinfo>`;

			const lockRequest = t.createAuthRequest('LOCK', '/locked.txt', {
				body: lockBody,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});

			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(200, lockResponse);

			// Extract lock token from response
			const lockToken = lockResponse.headers.get('Lock-Token');
			expect(lockToken).toBeDefined();

			// Try to delete with lock token in If header
			const deleteRequest = t.createAuthRequest('DELETE', '/locked.txt', {
				headers: { 'If': `(${lockToken})` }
			});

			const deleteResponse = await executeRequest(deleteRequest, testEnv);

			// Should succeed
			assertStatus(204, deleteResponse);

			// Verify file is deleted
			const exists = await t.fileExists('locked.txt', testEnv);
			expect(exists).toBe(false);
		});
	});

	describe('UNLOCK', () => {
		it('should unlock a locked resource', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'content', 'text/plain', testEnv);

			// Lock the file
			const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
</D:lockinfo>`;

			const lockRequest = t.createAuthRequest('LOCK', '/test.txt', {
				body: lockBody,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});

			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(200, lockResponse);

			const lockToken = lockResponse.headers.get('Lock-Token');
			expect(lockToken).toBeDefined();

			// Unlock the file
			const unlockRequest = t.createAuthRequest('UNLOCK', '/test.txt', {
				headers: { 'Lock-Token': lockToken! }
			});

			const unlockResponse = await executeRequest(unlockRequest, testEnv);
			assertStatus(204, unlockResponse);

			// Now should be able to delete without lock token
			const deleteRequest = t.createAuthRequest('DELETE', '/test.txt');
			const deleteResponse = await executeRequest(deleteRequest, testEnv);
			assertStatus(204, deleteResponse);
		});

		it('should reject unlock with wrong lock token', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('test.txt', 'content', 'text/plain', testEnv);

			// Lock the file
			const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
</D:lockinfo>`;

			const lockRequest = t.createAuthRequest('LOCK', '/test.txt', {
				body: lockBody,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});

			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(200, lockResponse);

			// Try to unlock with wrong token
			const unlockRequest = t.createAuthRequest('UNLOCK', '/test.txt', {
				headers: { 'Lock-Token': '<opaquelocktoken:wrong-token>' }
			});

			const unlockResponse = await executeRequest(unlockRequest, testEnv);

			// Should return 403 Forbidden
			assertStatus(403, unlockResponse);
		});

		it('should return 204 when unlocking unlocked resource', async () => {
			const unlockRequest = t.createAuthRequest('UNLOCK', '/unlocked.txt', {
				headers: { 'Lock-Token': '<opaquelocktoken:some-token>' }
			});

			const unlockResponse = await executeRequest(unlockRequest);
			assertStatus(204, unlockResponse);
		});
	});
});
