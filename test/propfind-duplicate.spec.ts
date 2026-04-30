/**
 * WebDAV PROPFIND duplicate bug regression tests.
 *
 * This test file specifically targets a bug where directories would appear
 * as their own children in PROPFIND responses (e.g., /testdir/ showing /testdir/testdir/).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('PROPFIND Directory Duplication Bug', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	it('should NOT include directory as its own child in PROPFIND response', async () => {
		const testEnv = createTestEnv();

		// Create an empty directory
		await t.createTestDirectory('testdir', testEnv);

		// Request PROPFIND on the directory
		const request = t.createAuthRequest('PROPFIND', '/testdir/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// The response should contain the directory itself
		expect(body).toContain('<D:href>/testdir/</D:href>');

		// But should NOT contain the directory as a child of itself
		expect(body).not.toContain('<D:href>/testdir/testdir/</D:href>');

		// Count the number of <D:href> occurrences
		const hrefMatches = body.match(/<D:href>/g);
		expect(hrefMatches?.length).toBe(1); // Only the directory itself
	});

	it('should list directory + files without duplicating directory', async () => {
		const testEnv = createTestEnv();

		// Create a directory with files
		await t.createTestDirectory('mydir', testEnv);
		await t.createTestFile('mydir/file1.txt', 'content1', 'text/plain', testEnv);
		await t.createTestFile('mydir/file2.txt', 'content2', 'text/plain', testEnv);

		// Request PROPFIND
		const request = t.createAuthRequest('PROPFIND', '/mydir/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// Should contain directory and both files
		expect(body).toContain('<D:href>/mydir/</D:href>');
		expect(body).toContain('<D:href>/mydir/file1.txt</D:href>');
		expect(body).toContain('<D:href>/mydir/file2.txt</D:href>');

		// Should NOT contain duplicate directory
		expect(body).not.toContain('<D:href>/mydir/mydir/</D:href>');

		// Should have exactly 3 hrefs
		const hrefMatches = body.match(/<D:href>/g);
		expect(hrefMatches?.length).toBe(3);
	});

	it('should list directory + subdirectories without duplication', async () => {
		const testEnv = createTestEnv();

		// Create nested directory structure
		await t.createTestDirectory('parent', testEnv);
		await t.createTestDirectory('parent/child1', testEnv);
		await t.createTestDirectory('parent/child2', testEnv);

		// Request PROPFIND on parent
		const request = t.createAuthRequest('PROPFIND', '/parent/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// Should contain parent and both children
		expect(body).toContain('<D:href>/parent/</D:href>');
		expect(body).toContain('<D:href>/parent/child1/</D:href>');
		expect(body).toContain('<D:href>/parent/child2/</D:href>');

		// Should NOT contain parent as its own child
		expect(body).not.toContain('<D:href>/parent/parent/</D:href>');

		// Should have exactly 3 hrefs
		const hrefMatches = body.match(/<D:href>/g);
		expect(hrefMatches?.length).toBe(3);
	});

	it('should not show parent directory in child directory PROPFIND', async () => {
		const testEnv = createTestEnv();

		// Create nested directories
		await t.createTestDirectory('level1', testEnv);
		await t.createTestDirectory('level1/level2', testEnv);
		await t.createTestDirectory('level1/level2/level3', testEnv);

		// Request PROPFIND on level2
		const request = t.createAuthRequest('PROPFIND', '/level1/level2/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// Should contain level2 and level3
		expect(body).toContain('<D:href>/level1/level2/</D:href>');
		expect(body).toContain('<D:href>/level1/level2/level3/</D:href>');

		// Should NOT contain level1 (parent)
		expect(body).not.toContain('<D:href>/level1/</D:href>');
		expect(body).not.toContain('<D:href>/level1/level2/level1/</D:href>');

		// Should have exactly 2 hrefs
		const hrefMatches = body.match(/<D:href>/g);
		expect(hrefMatches?.length).toBe(2);
	});

	it('should handle complex nested structure correctly', async () => {
		const testEnv = createTestEnv();

		// Create a complex structure
		await t.createTestDirectory('project', testEnv);
		await t.createTestDirectory('project/src', testEnv);
		await t.createTestDirectory('project/src/components', testEnv);
		await t.createTestFile('project/src/index.ts', 'code', 'text/plain', testEnv);
		await t.createTestFile('project/src/components/Button.tsx', 'jsx', 'text/plain', testEnv);

		// Request PROPFIND on src directory
		const request = t.createAuthRequest('PROPFIND', '/project/src/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// Should contain: src/, index.ts, components/
		expect(body).toContain('<D:href>/project/src/</D:href>');
		expect(body).toContain('<D:href>/project/src/index.ts</D:href>');
		expect(body).toContain('<D:href>/project/src/components/</D:href>');

		// Should NOT contain Button.tsx (it's in components, not src)
		expect(body).not.toContain('<D:href>/project/src/components/Button.tsx</D:href>');

		// Should NOT contain duplicates
		expect(body).not.toContain('<D:href>/project/src/src/</D:href>');
		expect(body).not.toContain('<D:href>/project/src/project/</D:href>');

		// Should have exactly 3 items
		const hrefMatches = body.match(/<D:href>/g);
		expect(hrefMatches?.length).toBe(3);
	});

	it('should handle root directory without showing root as child', async () => {
		const testEnv = createTestEnv();

		// Create files in root
		await t.createTestFile('file1.txt', 'content', 'text/plain', testEnv);
		await t.createTestDirectory('dir1', testEnv);

		// Request PROPFIND on root
		const request = t.createAuthRequest('PROPFIND', '/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// Should contain root, file1.txt, and dir1/
		expect(body).toContain('<D:href>/</D:href>');
		expect(body).toContain('<D:href>/file1.txt</D:href>');
		expect(body).toContain('<D:href>/dir1/</D:href>');

		// Should NOT contain root as its own child (this would be "/" inside "/")
		// Since root is "/", we check that we don't have any extra root references
		const rootMatches = body.match(/<D:href>\/<\/D:href>/g);
		expect(rootMatches?.length).toBe(1); // Only one root href
	});

	it('should distinguish between files and directories with same name', async () => {
		const testEnv = createTestEnv();

		// Create a directory and a file with similar names
		await t.createTestDirectory('test', testEnv);
		await t.createTestFile('test.txt', 'file content', 'text/plain', testEnv);

		// Request PROPFIND on root
		const request = t.createAuthRequest('PROPFIND', '/', {
			headers: { 'Depth': '1' }
		});
		const response = await executeRequest(request, testEnv);

		assertStatus(207, response);

		const body = await response.text();

		// Should contain both test/ (directory) and test.txt (file)
		expect(body).toContain('<D:href>/test/</D:href>');
		expect(body).toContain('<D:href>/test.txt</D:href>');

		// Should NOT have test/test/ (directory as its own child)
		expect(body).not.toContain('<D:href>/test/test/</D:href>');
	});
});
