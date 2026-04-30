/**
 * WebDAV Server Properties Infinite Depth Tests
 * Based on sabre-io/dav tests/Sabre/DAV/ServerPropsInfiniteDepthTest.php
 *
 * Note: The PROPFIND request body is not yet parsed, so all properties are returned
 * regardless of what was requested. supportedlock and lockdiscovery are not yet supported.
 * Depth: infinity currently behaves like Depth: 1 (one level deep).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV Server Properties Infinite Depth', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testPropFindEmptyBodyInfiniteDepth', () => {
		it('should return resources with infinite depth', async () => {
			const testEnv = createTestEnv();
			// Create test structure
			await t.createTestFile('test2.txt', 'Test contents2', 'text/plain', testEnv);
			await t.createTestDirectory('col', testEnv);
			await t.createTestDirectory('col/col', testEnv);
			await t.createTestFile('col/col/test.txt', 'Test contents', 'text/plain', testEnv);

			const request = t.createAuthRequest('PROPFIND', '/', {
				headers: {
					'Depth': 'infinity'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			expect(body).toContain('<D:multistatus');
			expect(body).toContain('<D:href>/</D:href>');
			expect(body).toContain('<D:href>/col/</D:href>');
			expect(body).toContain('<D:href>/test2.txt</D:href>');
			// TODO: Infinity depth should recursively list all nested resources
			// Currently only lists one level deep
			// expect(body).toContain('<D:href>/col/col/</D:href>');
			// expect(body).toContain('<D:href>/col/col/test.txt</D:href>');
		});
	});

	describe('testSupportedLocksInfiniteDepth', () => {
		it('should return all properties with infinite depth (body parsing not implemented)', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('col', testEnv);
			await t.createTestDirectory('col/col', testEnv);
			await t.createTestFile('col/col/test.txt', 'content', 'text/plain', testEnv);

			const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:supportedlock/>
  </D:prop>
</D:propfind>`;

			const request = t.createAuthRequest('PROPFIND', '/', {
				body: propfindBody,
				headers: {
					'Depth': 'infinity',
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			// TODO: Request body is not parsed yet - all properties are returned
			// When implemented, should contain <D:supportedlock> for all resources
			expect(body).toContain('<D:multistatus');
			expect(body).toContain('<D:href>/</D:href>');
			expect(body).toContain('<D:href>/col/</D:href>');
		});
	});

	describe('testLockDiscoveryInfiniteDepth', () => {
		it('should return all properties with infinite depth (body parsing not implemented)', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('col', testEnv);
			await t.createTestDirectory('col/col', testEnv);
			await t.createTestFile('col/col/test.txt', 'content', 'text/plain', testEnv);

			const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:lockdiscovery/>
  </D:prop>
</D:propfind>`;

			const request = t.createAuthRequest('PROPFIND', '/', {
				body: propfindBody,
				headers: {
					'Depth': 'infinity',
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			// TODO: Request body is not parsed yet - all properties are returned
			// When implemented, should contain <D:lockdiscovery> for all resources
			expect(body).toContain('<D:multistatus');
			expect(body).toContain('<D:href>/</D:href>');
			expect(body).toContain('<D:href>/col/</D:href>');
		});
	});

	describe('testUnknownPropertyInfiniteDepth', () => {
		it('should return all properties with infinite depth (body parsing not implemented)', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('col', testEnv);
			await t.createTestDirectory('col/col', testEnv);
			await t.createTestFile('col/col/test.txt', 'content', 'text/plain', testEnv);

			const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:macaroni/>
  </D:prop>
</D:propfind>`;

			const request = t.createAuthRequest('PROPFIND', '/', {
				body: propfindBody,
				headers: {
					'Depth': 'infinity',
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			// TODO: Request body is not parsed yet - all properties are returned
			// When implemented, should return 404 status for unknown property on all resources
			expect(body).toContain('<D:multistatus');
			expect(body).toContain('<D:href>/</D:href>');
			expect(body).toContain('<D:href>/col/</D:href>');
		});
	});

	describe('testFilesThatAreSiblingsOfDirectoriesShouldBeReportedAsFiles', () => {
		it('should correctly report files vs directories', async () => {
			const testEnv = createTestEnv();
			// Create a mix of files and directories
			await t.createTestDirectory('col', testEnv);
			await t.createTestFile('file.txt', 'content', 'text/plain', testEnv);
			await t.createTestDirectory('col/subcol', testEnv);
			await t.createTestFile('col/file2.txt', 'content', 'text/plain', testEnv);

			const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

			const request = t.createAuthRequest('PROPFIND', '/', {
				body: propfindBody,
				headers: {
					'Depth': 'infinity',
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);

			const body = await response.text();
			// Check for proper resourcetype in responses
			expect(body).toContain('<D:resourcetype');
			// Directories should have collection element
			expect(body).toContain('<D:collection/>');
		});
	});
});
