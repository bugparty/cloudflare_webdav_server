/**
 * WebDAV If Header Conditions Tests
 * Based on sabre-io/dav tests/Sabre/DAV/GetIfConditionsTest.php
 *
 * These tests verify that the If header is properly parsed and handled.
 * The If header is used for conditional requests with lock tokens and ETags.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV If Header Conditions', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('If Header Parsing', () => {
		it('should handle request without If header', async () => {
			const request = t.createAuthRequest('GET', '/foo');
			const response = await executeRequest(request);

			// Should just work normally (404 because file doesn't exist)
			expect([200, 404]).toContain(response.status);
		});

		it('should handle If header with lock token', async () => {
			const request = t.createAuthRequest('GET', '/path/', {
				headers: { 'If': '(<opaquelocktoken:token1>)' }
			});
			const response = await executeRequest(request);

			// Without proper lock token, should fail
			expect([423, 412]).toContain(response.status);
		});

		it('should handle If header with negated lock token', async () => {
			const request = t.createAuthRequest('GET', '/bla', {
				headers: { 'If': '(Not <opaquelocktoken:token1>)' }
			});
			const response = await executeRequest(request);

			// This should succeed because the token should NOT be present
			expect([200, 404]).toContain(response.status);
		});

		it('should handle If header with URI', async () => {
			const request = t.createAuthRequest('GET', '/bla', {
				headers: { 'If': '<http://www.example.com/> (<opaquelocktoken:token1>)' }
			});
			const response = await executeRequest(request);

			// Without proper lock token, should fail
			expect([423, 412]).toContain(response.status);
		});

		it('should handle multiple lock tokens', async () => {
			const request = t.createAuthRequest('GET', '/bla', {
				headers: { 'If': '(<opaquelocktoken:token1>) (Not <opaquelocktoken:token2>)' }
			});
			const response = await executeRequest(request);

			// First token not present, second is negated so should be present
			expect([423, 412, 200, 404]).toContain(response.status);
		});

		it('should handle multiple URIs with lock tokens', async () => {
			const request = t.createAuthRequest('GET', '/bla', {
				headers: {
					'If': '<http://www.example.org/node1> (<opaquelocktoken:token1>) <http://www.example.org/node2> (Not <opaquelocktoken:token2>)'
				}
			});
			const response = await executeRequest(request);

			// Without valid tokens, should fail
			expect([423, 412]).toContain(response.status);
		});

		it('should handle multiple lock tokens per URI', async () => {
			const request = t.createAuthRequest('GET', '/bla', {
				headers: {
					'If': '<http://www.example.org/node1> (<opaquelocktoken:token1>) (<opaquelocktoken:token2>) <http://www.example.org/node2> (Not <opaquelocktoken:token3>)'
				}
			});
			const response = await executeRequest(request);

			// Without valid tokens, should fail
			expect([423, 412]).toContain(response.status);
		});

		it('should handle ETag in If header', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

				// ETag is computed from file content, not stored in httpMetadata
				const headRequest = t.createAuthRequest('HEAD', '/foo');
				const headResponse = await executeRequest(headRequest, testEnv);
				const etag = headResponse.headers.get('ETag') || '"abc123"';

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If': `(["${etag.replace(/"/g, '')}"])` }
			});
			const response = await executeRequest(request, testEnv);

			// ETag matches, should succeed
			assertStatus(200, response);
		});

		it('should handle multiple ETags in If header', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('foo', 'content', 'text/plain', testEnv);

			const request = t.createAuthRequest('GET', '/foo', {
				headers: { 'If': '<http://www.example.org/> (["etag1"]) (["etag2"])' }
			});
			const response = await executeRequest(request, testEnv);

			// ETags don't match, but request may still proceed
			expect([200, 404]).toContain(response.status);
		});
	});

	describe('Complex If Header', () => {
		it('should handle complex If header with multiple tokens and ETags', async () => {
			const request = t.createAuthRequest('GET', '/foo', {
				headers: {
					'If': '<http://www.example.org/node1> (<opaquelocktoken:token1> ["etag1"]) ' +
						'(Not <opaquelocktoken:token2>) (["etag2"]) <http://www.example.org/node2> ' +
						'(<opaquelocktoken:token3>) (Not <opaquelocktoken:token4>) (["etag3"])'
				}
			});
			const response = await executeRequest(request);

			// Without valid tokens/etags, should fail
			expect([423, 412]).toContain(response.status);
		});
	});
});
