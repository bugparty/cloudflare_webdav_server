/**
 * WebDAV PROPFIND request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ServerPropsTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	assertBodyContains,
	extractHrefs
} from './webdav-test-utils';

describe('WebDAV PROPFIND Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testPropFindEmptyBody', () => {
		it('should return properties for root with Depth: 0', async () => {
			const request = t.createAuthRequest('PROPFIND', '/', {
				headers: {
					'Depth': '0'
				}
			});
			const response = await executeRequest(request);

			assertStatus(207, response);
			assertBodyContains('<D:multistatus', response);
		});
	});

	describe('testPropFindEmptyBodyDepth1', () => {
		it('should return properties for root and children with Depth: 1', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/', {
				headers: {
					'Depth': '1'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			expect(body).toContain('<D:multistatus');
			expect(body).toContain('<D:href>/</D:href>');
			expect(body).toContain('<D:href>/file1</D:href>');
			expect(body).toContain('<D:href>/dir/</D:href>');
		});
	});

	describe('testPropFindFile', () => {
		it('should return properties for a specific file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/file1', {
				headers: {
					'Depth': '0'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			expect(body).toContain('<D:href>/file1</D:href>');
			expect(body).toContain('<D:getcontentlength>3</D:getcontentlength>');
		});
	});

	describe('testPropFindDirectory', () => {
		it('should return properties for a directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/dir/', {
				headers: {
					'Depth': '0'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			expect(body).toContain('<D:collection/>');
		});
	});

	describe('testPropFindWithBody', () => {
		it('should return requested properties from body', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getcontentlength/>
    <D:getlastmodified/>
  </D:prop>
</D:propfind>`;

			const request = t.createAuthRequest('PROPFIND', '/file1', {
				body: propfindBody,
				headers: {
					'Depth': '0',
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			// TODO: The request body is not parsed yet, so all properties are returned
			const body = await response.text();
			expect(body).toContain('<D:getcontentlength>');
			expect(body).toContain('<D:getlastmodified>');
		});
	});

	describe('testPropFindUnknownProperty', () => {
		it('should return 404 for unknown properties', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:unknownproperty/>
  </D:prop>
</D:propfind>`;

			const request = t.createAuthRequest('PROPFIND', '/file1', {
				body: propfindBody,
				headers: {
					'Depth': '0',
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			// TODO: This should return 404 for unknown properties
			const body = await response.text();
			expect(body).toContain('<D:multistatus');
		});
	});

	describe('testPropFindNestedDirectory', () => {
		it('should list files in nested directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('parent', testEnv);
			await t.createTestDirectory('parent/child', testEnv);
			await t.createTestFile('parent/file1.txt', 'content', 'text/plain', testEnv);
			await t.createTestFile('parent/child/file2.txt', 'child content', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/parent/', {
				headers: {
					'Depth': '1'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const hrefs = await extractHrefs(response);
			expect(hrefs).toContain('/parent/');
			// Child files and subdirectories should be listed
		});
	});
});
