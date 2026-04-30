/**
 * Windows WebDAV client compatibility tests.
 *
 * Covers the properties and request sequences required by the Windows
 * WebDAV MiniRedirector (WebClient service) to correctly upload and
 * verify files via Windows Explorer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

// Extract the raw text of an already-materialised response without consuming it again.
async function bodyText(response: Response): Promise<string> {
	return response.text();
}

// Parse the value of a single XML element (first occurrence).
function extractXmlValue(xml: string, tag: string): string | null {
	const open = `<D:${tag}>`;
	const close = `</D:${tag}>`;
	const start = xml.indexOf(open);
	if (start === -1) return null;
	const end = xml.indexOf(close, start);
	if (end === -1) return null;
	return xml.slice(start + open.length, end);
}

const LOCK_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
  <D:locktype><D:write/></D:locktype>
  <D:lockscope><D:exclusive/></D:lockscope>
  <D:owner>Windows Explorer</D:owner>
</D:lockinfo>`;

describe('Windows WebDAV client compatibility', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	// -------------------------------------------------------------------------
	// OPTIONS
	// -------------------------------------------------------------------------

	describe('OPTIONS', () => {
		it('should include PROPPATCH in Allow header', async () => {
			const request = t.createAuthRequest('OPTIONS', '/');
			const response = await executeRequest(request);

			assertStatus(200, response);
			const allow = response.headers.get('Allow') || '';
			expect(allow).toContain('PROPPATCH');
		});

		it('should include Ms-Author-Via: DAV header', async () => {
			const request = t.createAuthRequest('OPTIONS', '/');
			const response = await executeRequest(request);

			assertStatus(200, response);
			const msAuthorVia = response.headers.get('Ms-Author-Via');
			expect(msAuthorVia).toBe('DAV');
		});

		it('should advertise DAV class 1 and 2', async () => {
			const request = t.createAuthRequest('OPTIONS', '/');
			const response = await executeRequest(request);

			assertStatus(200, response);
			const dav = response.headers.get('DAV') || '';
			expect(dav).toContain('1');
			expect(dav).toContain('2');
		});
	});

	// -------------------------------------------------------------------------
	// PROPFIND – getetag
	// -------------------------------------------------------------------------

	describe('PROPFIND getetag property', () => {
		it('should include getetag for a file (Depth: 0)', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('doc.txt', 'hello world', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/doc.txt', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			expect(body).toContain('<D:getetag>');
		});

		it('should include getetag for files listed in a directory (Depth: 1)', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('folder', testEnv);
			await t.createTestFile('folder/note.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/folder/', {
				headers: { 'Depth': '1' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			expect(body).toContain('<D:getetag>');
		});

		it('should NOT include getetag for a collection', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('folder', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/folder/', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			// The directory's own response block must not carry getetag
			// (files inside may, but depth 0 returns only the directory itself)
			expect(body).not.toContain('<D:getetag>');
		});

		it('getetag value should be a quoted string', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'data', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/file.txt', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			const etag = extractXmlValue(body, 'getetag');
			expect(etag).not.toBeNull();
			expect(etag).toMatch(/^"[^"]+"$/); // must be "..."
		});
	});

	// -------------------------------------------------------------------------
	// PROPFIND – ETag consistency with PUT
	// -------------------------------------------------------------------------

	describe('ETag consistency between PUT and PROPFIND', () => {
		it('getetag in PROPFIND should match ETag returned by PUT', async () => {
			const testEnv = createTestEnv();

			// Upload the file
			const putRequest = t.createAuthRequest('PUT', '/upload.txt', {
				body: 'windows upload',
				headers: { 'Content-Type': 'text/plain' }
			});
			const putResponse = await executeRequest(putRequest, testEnv);
			assertStatus(201, putResponse);

			const putEtag = putResponse.headers.get('ETag');
			expect(putEtag).not.toBeNull();

			// Verify via PROPFIND (what Windows Explorer does after upload)
			const propfindRequest = t.createAuthRequest('PROPFIND', '/upload.txt', {
				headers: { 'Depth': '0' }
			});
			const propfindResponse = await executeRequest(propfindRequest, testEnv);
			assertStatus(207, propfindResponse);

			const body = await bodyText(propfindResponse);
			const propfindEtag = extractXmlValue(body, 'getetag');
			expect(propfindEtag).not.toBeNull();
			expect(propfindEtag).toBe(putEtag);
		});

		it('getetag should update after file is overwritten', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('update.txt', 'original', 'text/plain', testEnv);

			// Get initial getetag
			const first = await executeRequest(
				t.createAuthRequest('PROPFIND', '/update.txt', { headers: { 'Depth': '0' } }),
				testEnv
			);
			const firstEtag = extractXmlValue(await bodyText(first), 'getetag');

			// Overwrite the file
			await executeRequest(
				t.createAuthRequest('PUT', '/update.txt', {
					body: 'updated content',
					headers: { 'Content-Type': 'text/plain' }
				}),
				testEnv
			);

			// ETag must change
			const second = await executeRequest(
				t.createAuthRequest('PROPFIND', '/update.txt', { headers: { 'Depth': '0' } }),
				testEnv
			);
			const secondEtag = extractXmlValue(await bodyText(second), 'getetag');

			expect(secondEtag).not.toBeNull();
			expect(secondEtag).not.toBe(firstEtag);
		});
	});

	// -------------------------------------------------------------------------
	// PROPFIND – supportedlock and lockdiscovery
	// -------------------------------------------------------------------------

	describe('PROPFIND supportedlock and lockdiscovery properties', () => {
		it('should include supportedlock for a file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/file.txt', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			expect(body).toContain('<D:supportedlock>');
			expect(body).toContain('<D:exclusive/>');
		});

		it('should include lockdiscovery for a file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/file.txt', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			expect(body).toContain('<D:lockdiscovery');
		});

		it('should include supportedlock for a directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/dir/', {
				headers: { 'Depth': '0' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			expect(body).toContain('<D:supportedlock>');
		});

		it('should include supportedlock for children in directory listing', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);
			await t.createTestFile('dir/child.txt', 'hi', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/dir/', {
				headers: { 'Depth': '1' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await bodyText(response);
			expect(body).toContain('<D:supportedlock>');
		});
	});

	// -------------------------------------------------------------------------
	// PROPPATCH
	// -------------------------------------------------------------------------

	describe('PROPPATCH', () => {
		it('should return 207 for an existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file.txt', 'content', 'text/plain', testEnv);

			const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:getlastmodified>Thu, 01 Jan 2026 00:00:00 GMT</D:getlastmodified>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/file.txt', {
				body,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const responseBody = await bodyText(response);
			expect(responseBody).toContain('<D:multistatus');
			expect(responseBody).toContain('/file.txt');
		});

		it('should return 207 for a directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set><D:prop><D:displayname>renamed</D:displayname></D:prop></D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/dir/', {
				body,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});

		it('should return 404 for a non-existent resource', async () => {
			const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set><D:prop><D:displayname>x</D:displayname></D:prop></D:set>
</D:propertyupdate>`;

			const testEnv = createTestEnv();
			await t.createTestDirectory('existing', testEnv); // parent exists
			const request = t.createAuthRequest('PROPPATCH', '/existing/ghost.txt', {
				body,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(404, response);
		});

		it('should return 423 on a locked resource without the lock token', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('locked.txt', 'content', 'text/plain', testEnv);

			// Lock the file first
			const lockRequest = t.createAuthRequest('LOCK', '/locked.txt', {
				body: LOCK_BODY,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
			});
			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(200, lockResponse);

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set><D:prop><D:displayname>x</D:displayname></D:prop></D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/locked.txt', {
				body: proppatchBody,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' }
				// No If header with lock token
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(423, response);
		});
	});

	// -------------------------------------------------------------------------
	// Full Windows Explorer upload sequence
	// -------------------------------------------------------------------------

	describe('Windows Explorer upload sequence (LOCK → PUT → PROPFIND → UNLOCK)', () => {
		it('should complete a full upload and verify ETag consistency', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('uploads', testEnv);

			// Step 1: LOCK the target path (file doesn't exist yet)
			const lockRequest = t.createAuthRequest('LOCK', '/uploads/report.txt', {
				body: LOCK_BODY,
				headers: {
					'Content-Type': 'application/xml; charset=utf-8',
					'Depth': '0',
					'Timeout': 'Second-3600'
				}
			});
			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(201, lockResponse); // 201 = new resource locked
			const lockToken = lockResponse.headers.get('Lock-Token');
			expect(lockToken).not.toBeNull();

			// Step 2: PUT the file content (with If header providing the lock token)
			const putRequest = t.createAuthRequest('PUT', '/uploads/report.txt', {
				body: 'quarterly report data',
				headers: {
					'Content-Type': 'text/plain',
					'If': `(${lockToken})`
				}
			});
			const putResponse = await executeRequest(putRequest, testEnv);
			assertStatus(201, putResponse);
			const putEtag = putResponse.headers.get('ETag');
			expect(putEtag).not.toBeNull();

			// Step 3: PROPFIND to verify (this is what Windows does to confirm upload)
			const propfindRequest = t.createAuthRequest('PROPFIND', '/uploads/report.txt', {
				headers: { 'Depth': '0' }
			});
			const propfindResponse = await executeRequest(propfindRequest, testEnv);
			assertStatus(207, propfindResponse);

			const propBody = await bodyText(propfindResponse);
			// File must appear in the response
			expect(propBody).toContain('report.txt');
			// ETag must be present and match PUT
			const propEtag = extractXmlValue(propBody, 'getetag');
			expect(propEtag).not.toBeNull();
			expect(propEtag).toBe(putEtag);
			// Lock properties must be present
			expect(propBody).toContain('<D:supportedlock>');
			expect(propBody).toContain('<D:lockdiscovery');

			// Step 4: UNLOCK
			const unlockRequest = t.createAuthRequest('UNLOCK', '/uploads/report.txt', {
				headers: { 'Lock-Token': lockToken! }
			});
			const unlockResponse = await executeRequest(unlockRequest, testEnv);
			assertStatus(204, unlockResponse);

			// File must still exist after unlock
			const exists = await t.fileExists('uploads/report.txt', testEnv);
			expect(exists).toBe(true);
		});

		it('should allow overwriting an existing file with correct lock token', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('uploads', testEnv);
			await t.createTestFile('uploads/existing.txt', 'old content', 'text/plain', testEnv);

			// Lock the existing file
			const lockRequest = t.createAuthRequest('LOCK', '/uploads/existing.txt', {
				body: LOCK_BODY,
				headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' }
			});
			const lockResponse = await executeRequest(lockRequest, testEnv);
			assertStatus(200, lockResponse); // 200 = existing resource locked
			const lockToken = lockResponse.headers.get('Lock-Token');

			// PUT new content
			const putRequest = t.createAuthRequest('PUT', '/uploads/existing.txt', {
				body: 'new content',
				headers: {
					'Content-Type': 'text/plain',
					'If': `(${lockToken})`
				}
			});
			const putResponse = await executeRequest(putRequest, testEnv);
			assertStatus(204, putResponse); // 204 = updated existing

			// Verify the content changed
			const content = await t.getFileContent('uploads/existing.txt', testEnv);
			expect(content).toBe('new content');

			// PROPFIND must reflect the updated ETag
			const propfindResponse = await executeRequest(
				t.createAuthRequest('PROPFIND', '/uploads/existing.txt', { headers: { 'Depth': '0' } }),
				testEnv
			);
			assertStatus(207, propfindResponse);
			const body = await bodyText(propfindResponse);
			expect(body).toContain('<D:getetag>');

			// Cleanup
			await executeRequest(
				t.createAuthRequest('UNLOCK', '/uploads/existing.txt', { headers: { 'Lock-Token': lockToken! } }),
				testEnv
			);
		});
	});
});
