/**
 * WebDAV PROPPATCH request tests.
 * Based on sabre-io/dav tests/Sabre/DAV/PropPatchTest.php
 *
 * Note: PROPPATCH is not yet implemented in this WebDAV server.
 * These tests verify the server returns appropriate 405 Method Not Allowed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus,
	assertBodyContains
} from './webdav-test-utils';

describe('WebDAV PROPPATCH Requests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

	describe('testPropPatchSingleSuccess', () => {
		it('should return 405 Method Not Allowed (PROPPATCH not implemented)', async () => {
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

			// PROPPATCH is not implemented yet - returns 405
			assertStatus(405, response);
		});
	});

	describe('testPropPatchSingleDelete', () => {
		it('should return 405 Method Not Allowed for property deletion', async () => {
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

			assertStatus(405, response);
		});
	});

	describe('testPropPatchMultipleProperties', () => {
		it('should return 405 for multiple property updates', async () => {
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

			assertStatus(405, response);
		});
	});

	describe('testPropPatchCustomNamespace', () => {
		it('should return 405 for custom namespace properties', async () => {
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

			assertStatus(405, response);
		});
	});

	describe('testPropPatchMultipleOperations', () => {
		it('should return 405 for set and remove operations in sequence', async () => {
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

			assertStatus(405, response);
		});
	});

	describe('testPropPatchOnDirectory', () => {
		it('should return 405 for PROPPATCH on directory', async () => {
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

			assertStatus(405, response);
		});
	});

	describe('testPropPatch404', () => {
		it('should return 405 for non-existent resource (not 404 since method not allowed)', async () => {
			const proppatchBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Test</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

			const request = t.createAuthRequest('PROPPATCH', '/nonexistent', {
				body: proppatchBody,
				headers: {
					'Content-Type': 'application/xml; charset="utf-8"'
				}
			});
			const response = await executeRequest(request);

			// Since PROPPATCH is not implemented at all, it returns 405 even for non-existent resources
			assertStatus(405, response);
		});
	});
});
