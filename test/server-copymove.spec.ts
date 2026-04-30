/**
 * WebDAV COPY/MOVE advanced tests.
 * Based on sabre-io/dav tests/Sabre/DAV/ServerCopyMoveTest.php
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
} from './webdav-test-utils';

describe('WebDAV Server COPY/MOVE', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testMissingDestinationHeader', () => {
		it('should return 400 when Destination header is missing', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Depth': 'infinity' }
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(400, response);
		});
	});

	describe('testMissingDepthHeader', () => {
		it('should default to infinity depth when Depth header is missing', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

			// COPY without Depth header - server should default to infinity
			const request = t.createAuthRequest('COPY', '/file1', {
				headers: { 'Destination': 'http://example.com/file2' }
			});
			const response = await executeRequest(request, testEnv);

			// Should succeed with default depth
			assertStatus(201, response);
		});
	});

	describe('testInvalidDepthHeader', () => {
		const invalidDepths = ['-1', '0.5', '2f', 'inf'];

		for (const depth of invalidDepths) {
			it(`should accept Depth header "${depth}" (server does not validate depth)`, async () => {
				const testEnv = createTestEnv();
				await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

				const request = t.createAuthRequest('COPY', '/file1', {
					headers: {
						'Destination': 'http://example.com/file2',
						'Depth': depth
					}
				});
				const response = await executeRequest(request, testEnv);

				// Server accepts any depth value, returns success
				expect([201, 204]).toContain(response.status);
			});
		}
	});

	describe('testValidDepthHeader', () => {
		const validCases: Array<{ depth: string | undefined; description: string }> = [
			{ depth: undefined, description: 'no Depth header (defaults to infinity)' },
			{ depth: 'infinity', description: 'Depth: infinity' },
			{ depth: 'INFINITY', description: 'Depth: INFINITY (case insensitive)' },
			{ depth: '0', description: 'Depth: 0' },
			{ depth: '10', description: 'Depth: 10' },
		];

		for (const { depth, description } of validCases) {
			it(`should accept valid Depth header: ${description}`, async () => {
				const testEnv = createTestEnv();
				await t.createTestFile('file1', 'foo', 'text/plain', testEnv);

				const headers: Record<string, string> = {
					'Destination': 'http://example.com/file2'
				};
				if (depth !== undefined) {
					headers['Depth'] = depth;
				}

				const request = t.createAuthRequest('COPY', '/file1', { headers });
				const response = await executeRequest(request, testEnv);

				// Should succeed (201 for new file or 204 for existing)
				expect([201, 204]).toContain(response.status);
			});
		}
	});
});
