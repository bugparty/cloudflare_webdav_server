/**
 * WebDAV MKCOL request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ServerMKCOLTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	fileExists
} from './webdav-test-utils';

describe('WebDAV MKCOL Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testMkcol', () => {
		it('should create a collection with 201 status', async () => {
			const request = t.createAuthRequest('MKCOL', '/newdir');
			const response = await executeRequest(request);

			assertStatus(201, response);

			const exists = await fileExists('newdir/');
			expect(exists).toBe(true);
		});
	});

	describe('testMKCOLNoParent', () => {
		it('should return 409 when parent does not exist', async () => {
			const request = t.createAuthRequest('MKCOL', '/nonexistent/newdir');
			const response = await executeRequest(request);

			assertStatus(409, response);
		});
	});

	describe('testMKCOLAlreadyExists', () => {
		it('should return 405 when collection already exists', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('existing', testEnv);

			const request = t.createAuthRequest('MKCOL', '/existing');
			const response = await executeRequest(request, testEnv);

			assertStatus(405, response);
		});
	});

	describe('testMKCOLFileAlreadyExists', () => {
		it('should return 405 when a file with same name exists', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('existing', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('MKCOL', '/existing');
			const response = await executeRequest(request, testEnv);

			assertStatus(405, response);
		});
	});

	describe('testMKCOLWithXML', () => {
		it('should create collection with XML body specifying resourcetype', async () => {
			const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<D:mkcol xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop>
  </D:set>
</D:mkcol>`;

			const request = t.createAuthRequest('MKCOL', '/newdir', {
				body: xmlBody,
				headers: { 'Content-Type': 'application/xml; charset="utf-8"' }
			});
			const response = await executeRequest(request);

			// The current implementation does not parse the XML body, but it allows directory creation
			assertStatus(201, response);

			const exists = await fileExists('newdir/');
			expect(exists).toBe(true);
		});
	});
});
