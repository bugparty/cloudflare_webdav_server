import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

describe('WebDAV macOS tests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

    it('handles macOS WebDAV client OPTIONS request', async () => {
        const request = t.createAuthRequest('OPTIONS', '/', {
            headers: {
                'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/17.5.0 (x86_64)'
            }
        });
        const response = await executeRequest(request);

        // verify the response status
        assertStatus(200, response);

        // verify the response headers
        expect(response.headers.get('Allow')).toContain('OPTIONS');
        expect(response.headers.get('Allow')).toContain('GET');
        expect(response.headers.get('Allow')).toContain('PUT');
        expect(response.headers.get('Allow')).toContain('PROPFIND');
        expect(response.headers.get('Allow')).toContain('LOCK');
        expect(response.headers.get('Allow')).toContain('UNLOCK');
        expect(response.headers.get('DAV')).toBeTruthy();
    });

    it('handles macOS WebDAV client PROPFIND request for DS_STORE', async () => {
        const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
    <D:prop>
        <D:getlastmodified xmlns:D="DAV:"/>
        <D:getcontentlength xmlns:D="DAV:"/>
        <D:creationdate xmlns:D="DAV:"/>
        <D:resourcetype xmlns:D="DAV:"/>
    </D:prop>
</D:propfind>`;

        const request = t.createAuthRequest('PROPFIND', '/.DS_Store', {
            headers: {
                'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/17.5.0 (x86_64)',
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '0'
            },
            body: propfindBody
        });

        const response = await executeRequest(request);

        // PROPFIND returns 207 Multi-Status even for non-existent resources
        assertStatus(207, response);

        // verify response headers
        expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');

        // verify response body contains WebDAV XML
        const responseText = await response.text();
        expect(responseText).toContain('multistatus');
    });
});
