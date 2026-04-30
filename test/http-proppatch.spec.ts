/**
 * WebDAV PROPPATCH request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/PropPatchTest.php
 *
 * The server accepts PROPPATCH and returns 207 Multi-Status, acknowledging
 * the request without actually persisting custom properties (live properties
 * such as getlastmodified are read-only; custom dead properties are silently
 * ignored rather than stored).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV PROPPATCH Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testPropPatchSingleSuccess', () => {
		it('should return 207 for a set operation on an existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'content', 'text/plain', testEnv);

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Test File</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/file1', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
			const body = await response.text();
			expect(body).toContain('<D:multistatus');
			expect(body).toContain('/file1');
		});
	});

	describe('testPropPatchSingleDelete', () => {
		it('should return 207 for a remove operation on an existing file', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'content', 'text/plain', testEnv);

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:remove>
    <D:prop>
      <D:displayname/>
    </D:prop>
  </D:remove>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/file1', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});
	});

	describe('testPropPatchMultipleProperties', () => {
		it('should return 207 for multiple property updates', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'content', 'text/plain', testEnv);

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:t="http://example.com/test">
  <D:set>
    <D:prop>
      <D:displayname>Test File</D:displayname>
      <t:customprop>custom value</t:customprop>
    </D:prop>
  </D:set>
  <D:remove>
    <D:prop>
      <D:resourcetype/>
    </D:prop>
  </D:remove>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/file1', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});
	});

	describe('testPropPatchCustomNamespace', () => {
		it('should return 207 for custom namespace properties', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'content', 'text/plain', testEnv);

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:custom="http://sabredav.org/NS/test">
  <D:set>
    <D:prop>
      <custom:someprop>somevalue</custom:someprop>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/file1', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});
	});

	describe('testPropPatchMultipleOperations', () => {
		it('should return 207 for set and remove operations in sequence', async () => {
			const testEnv = createTestEnv();
			await t.createTestFile('file1', 'content', 'text/plain', testEnv);

			const proppatchBody = `<?xml version="1.0"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:s="http://sabredav.org/NS/test">
  <D:set><D:prop><s:someprop>somevalue</s:someprop></D:prop></D:set>
  <D:remove><D:prop><s:someprop2/></D:prop></D:remove>
  <D:set><D:prop><s:someprop3>removeme</s:someprop3></D:prop></D:set>
  <D:remove><D:prop><s:someprop3/></D:prop></D:remove>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/file1', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});
	});

	describe('testPropPatchOnDirectory', () => {
		it('should return 207 for PROPPATCH on a directory', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv);

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Test Directory</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/dir/', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(207, response);
		});
	});

	describe('testPropPatch404', () => {
		it('should return 404 for a non-existent resource', async () => {
			const testEnv = createTestEnv();
			await t.createTestDirectory('dir', testEnv); // parent exists

			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Test</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/dir/nonexistent.txt', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request, testEnv);

			assertStatus(404, response);
		});
	});
});
