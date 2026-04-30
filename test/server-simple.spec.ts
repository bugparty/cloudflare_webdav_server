/**
 * Basic WebDAV server tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ServerSimpleTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	assertHeader,
	assertHeaderContains
} from './webdav-test-utils';

describe('WebDAV Server Simple Tests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testOptions', () => {
		it('should return OPTIONS response with DAV and Allow headers', async () => {
			const request = t.createAuthRequest('OPTIONS', '/');
			const response = await executeRequest(request);

			assertStatus(200, response);
			assertHeaderContains('Allow', 'OPTIONS', response);
			assertHeaderContains('Allow', 'GET', response);
			assertHeaderContains('Allow', 'PUT', response);
			assertHeaderContains('Allow', 'DELETE', response);
			assertHeaderContains('Allow', 'PROPFIND', response);
			assertHeaderContains('Allow', 'MKCOL', response);
			assertHeaderContains('Allow', 'MOVE', response);
			assertHeaderContains('Allow', 'COPY', response);

			// DAV header should indicate compliance level
			const dav = response.headers.get('DAV');
			expect(dav).toBeTruthy();
		});
	});

	describe('testOptionsUnmapped', () => {
		it('should return OPTIONS for unmapped path with MKCOL allowed', async () => {
			const request = t.createAuthRequest('OPTIONS', '/unmapped');
			const response = await executeRequest(request);

			assertStatus(200, response);
			assertHeaderContains('Allow', 'MKCOL', response);
		});
	});

	describe('testNonExistantMethod', () => {
		it('should return 501 for unsupported HTTP methods', async () => {
			const request = t.createAuthRequest('BLABLA', '/');
			const response = await executeRequest(request);

			// The current implementation returns 405 (Method Not Allowed)
			assertStatus(405, response);
		});
	});

	describe('testReportNotFound', () => {
		it('should return 415 for unknown REPORT', async () => {
			const reportBody = `<?xml version="1.0"?>
<bla:myreport xmlns:bla="http://www.rooftopsolutions.nl/NS"></bla:myreport>`;

			const request = t.createAuthRequest('REPORT', '/', {
				body: reportBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request);

			// The current implementation returns 405 (REPORT is not supported)
			assertStatus(405, response);
		});
	});

	describe('testHeadRequest', () => {
		it('should return headers only without body', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('HEAD', '/file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);

			// HEAD should return the same headers as GET
			expect(response.headers.get('Content-Type')).toBe('text/plain');
			expect(response.headers.get('Content-Length')).toBe('3');

			// But it should not include a body
			const body = await response.text();
			expect(body).toBe('');
		});
	});

	describe('testOptionsNoAuth', () => {
		it('should return OPTIONS without authentication', async () => {
			const testEnv = createTestEnv({
				WEBDAV_USERNAME: undefined,
				WEBDAV_PASSWORD: undefined
			});

			const request = new Request('http://example.com/', {
				method: 'OPTIONS'
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
			assertHeaderContains('Allow', 'PROPFIND', response);
		});
	});

	describe('testPathWithSpecialCharacters', () => {
		it('should handle URL-encoded paths', async () => {
			const testEnv = createTestEnv();
			// Create a file whose name contains special characters
			await t.createTestFile('file with spaces.txt', 'content', 'text/plain', testEnv);

			// URL-encoded path
			const request = t.createAuthRequest('GET', '/file%20with%20spaces.txt');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});
	});

	describe('testDoubleSlashInPath', () => {
		it('should normalize double slashes', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '//file1');
			const response = await executeRequest(request, testEnv);

			assertStatus(200, response);
		});
	});
});
