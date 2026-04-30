/**
 * WebDAV test framework based on the sabre-io/dav PHP test cases.
 *
 * This file provides a set of test helpers that mirror sabre-io/dav's testing style.
 */

import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

const testWorker = worker as unknown as {
	fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>
};

/**
 * Create a test environment configuration.
 */
export function createTestEnv(overrides: Partial<Env> = {}): Env {
	return {
		...env,
		DB: undefined,
		LOG_DO: undefined,
		WEBDAV_USERNAME: 'testuser',
		WEBDAV_PASSWORD: 'testpass',
		LOCKS: env.LOCKS || {} as KVNamespace, // Use env.LOCKS if available, otherwise mock
		...overrides
	};
}

/**
 * Create a request with Basic Auth.
 */
export function createAuthRequest(
	method: string,
	path: string,
	options: {
		headers?: Record<string, string>;
		body?: string | ArrayBuffer;
		username?: string;
		password?: string;
	} = {}
): Request {
	const username = options.username || 'testuser';
	const password = options.password || 'testpass';
	const credentials = btoa(`${username}:${password}`);

	const url = path.startsWith('http') ? path : `http://example.com${path.startsWith('/') ? '' : '/'}${path}`;

	const headers: Record<string, string> = {
		'Authorization': `Basic ${credentials}`,
		...options.headers
	};

	// Handle invalid HTTP method names by using GET and overriding later
	const upperMethod = method.toUpperCase();
	const validMethods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'CONNECT', 'TRACE', 'MKCOL', 'PROPFIND', 'REPORT', 'MOVE', 'COPY', 'LOCK', 'UNLOCK', 'PROPPATCH'];
	const validMethod = validMethods.includes(upperMethod) ? upperMethod : 'GET';

	const req = new Request(url, {
		method: validMethod,
		headers,
		body: options.body
	});

	// Override the method for invalid method names using Object.defineProperty
	if (validMethod !== upperMethod) {
		Object.defineProperty(req, 'method', { value: upperMethod, writable: false, configurable: false });
	}

	return req;
}

/**
 * Execute a request and return the response.
 */
export async function executeRequest(
	request: Request,
	testEnv: Env = createTestEnv()
): Promise<Response> {
	const ctx = createExecutionContext();
	const response = await testWorker.fetch(request, testEnv, ctx);
	const materializedResponse = await materializeResponse(response);
	await waitOnExecutionContext(ctx);
	return materializedResponse;
}

async function materializeResponse(response: Response): Promise<Response> {
	if (response.body === null) {
		return response;
	}

	const body = await response.arrayBuffer();
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}

/**
 * Create a test file.
 */
export async function createTestFile(
	path: string,
	content: string | ArrayBuffer,
	contentType?: string,
	testEnv: Env = createTestEnv()
): Promise<void> {
	const body = typeof content === 'string' ? new TextEncoder().encode(content) : content;
	const metadata = contentType ? { contentType } : {};
	await testEnv.BUCKET.put(path, body, { httpMetadata: metadata });
}

/**
 * Create a test directory.
 */
export async function createTestDirectory(
	path: string,
	testEnv: Env = createTestEnv()
): Promise<void> {
	const normalizedPath = path.endsWith('/') ? path : `${path}/`;
	await testEnv.BUCKET.put(normalizedPath, '', {
		httpMetadata: { contentType: 'text/directory' }
	});
}

/**
 * Delete a test file.
 */
export async function deleteTestFile(
	path: string,
	testEnv: Env = createTestEnv()
): Promise<void> {
	await testEnv.BUCKET.delete(path);
}

/**
 * Check whether a file or directory exists.
 */
export async function fileExists(
	path: string,
	testEnv: Env = createTestEnv()
): Promise<boolean> {
	// Check if it's a directory (ends with /)
	if (path.endsWith('/')) {
		// First check for directory placeholder (key ends with /)
		const placeholder = await testEnv.BUCKET.get(path);
		if (placeholder) return true;

		// Then check if there are any objects with this prefix
		const prefix = path.replace(/\/+$/, '');
		const list = await testEnv.BUCKET.list({ prefix: prefix + '/', limit: 1 });
		return list.objects.length > 0;
	}
	// Check for file
	const obj = await testEnv.BUCKET.get(path);
	return obj !== null;
}

/**
 * Get file contents.
 */
export async function getFileContent(
	path: string,
	testEnv: Env = createTestEnv()
): Promise<string | null> {
	const obj = await testEnv.BUCKET.get(path);
	if (!obj) return null;
	return await obj.text();
}

/**
 * Clean up the test environment by deleting all test files.
 */
export async function clearTestBucket(
	testEnv: Env = createTestEnv()
): Promise<void> {
	let cursor: string | undefined;
	do {
		const listed = await testEnv.BUCKET.list({ cursor });
		for (const obj of listed.objects) {
			await testEnv.BUCKET.delete(obj.key);
		}
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);
}

/**
 * Assert the response status code.
 */
export function assertStatus(expected: number, response: Response, message?: string): void {
	expect(response.status).toBe(expected);
	if (message && response.status !== expected) {
		console.log(`${message}\nResponse body: ${response.body}`);
	}
}

/**
 * Assert a response header.
 */
export function assertHeader(name: string, expected: string | null, response: Response): void {
	const actual = response.headers.get(name);
	expect(actual).toBe(expected);
}

/**
 * Assert that a response header contains a specific value.
 */
export function assertHeaderContains(name: string, expected: string, response: Response): void {
	const actual = response.headers.get(name);
	expect(actual).toContain(expected);
}

/**
 * Assert the response body.
 */
export async function assertBody(expected: string, response: Response): Promise<void> {
	const actual = await response.text();
	expect(actual).toBe(expected);
}

/**
 * Assert that the response body contains specific content.
 */
export async function assertBodyContains(expected: string, response: Response): Promise<void> {
	const actual = await response.text();
	expect(actual).toContain(expected);
}

/**
 * Extract a list of href values from an XML response.
 */
export async function extractHrefs(response: Response): Promise<string[]> {
	const text = await response.text();
	const hrefs: string[] = [];
	const regex = /<D:href>(.*?)<\/D:href>/g;
	let match;
	while ((match = regex.exec(text)) !== null) {
		hrefs.push(match[1]);
	}
	return hrefs;
}

/**
 * Generate a simple ETag, similar to the md5 used in the PHP tests.
 */
export function generateETag(content: string): string {
	// Simple hash function for testing
	let hash = 0;
	for (let i = 0; i < content.length; i++) {
		const char = content.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash = hash & hash;
	}
	return `"${Math.abs(hash).toString(16)}"`;
}

/**
 * Test suite factory function for creating a standard WebDAV test suite.
 */
export function createWebDAVTestSuite(suiteName: string, testCases: () => void) {
	describe(suiteName, () => {
		beforeEach(async () => {
			// Clean the bucket before each test
			await clearTestBucket();
		});

		afterEach(async () => {
			// Clean again after each test
			await clearTestBucket();
		});

		testCases();
	});
}

/**
 * Export all helper functions.
 */
export const WebDAVTest = {
	createTestEnv,
	createAuthRequest,
	executeRequest,
	createTestFile,
	createTestDirectory,
	deleteTestFile,
	fileExists,
	getFileContent,
	clearTestBucket,
	assertStatus,
	assertHeader,
	assertHeaderContains,
	assertBody,
	assertBodyContains,
	extractHrefs,
	generateETag,
	createWebDAVTestSuite
};
