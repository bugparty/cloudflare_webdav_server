import { describe, it, expect, beforeEach } from 'vitest';
import {
	WebDAVTest as t,
	createTestEnv,
	executeRequest,
	assertStatus
} from './webdav-test-utils';

const MACOS_USER_AGENT = 'WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)';

describe('WebDAV macOS tests', () => {
	beforeEach(async () => {
		await t.clearTestBucket();
	});

    it('handles macOS WebDAV client OPTIONS request', async () => {
        const request = t.createAuthRequest('OPTIONS', '/', {
            headers: {
                'User-Agent': MACOS_USER_AGENT
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
                'User-Agent': MACOS_USER_AGENT,
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '0'
            },
            body: propfindBody
        });

        const response = await executeRequest(request);

        assertStatus(404, response);
    });

    it('treats macOS cleanup DELETE for missing AppleDouble files as successful', async () => {
        const request = t.createAuthRequest('DELETE', '/._logo_blogger_40px_2x.png', {
            headers: {
                'User-Agent': MACOS_USER_AGENT
            }
        });
        const response = await executeRequest(request);

        assertStatus(204, response);
    });

    it('keeps standard DELETE semantics for missing files from other clients', async () => {
        const request = t.createAuthRequest('DELETE', '/._logo_blogger_40px_2x.png');
        const response = await executeRequest(request);

        assertStatus(404, response);
    });

    it('supports the Finder replace sequence when sidecar cleanup targets are absent', async () => {
        const testEnv = createTestEnv();
        await t.createTestFile('logo_blogger_40px_2x.png', 'old image', 'image/png', testEnv);

        const sidecarDelete = t.createAuthRequest('DELETE', '/._logo_blogger_40px_2x.png', {
            headers: {
                'User-Agent': MACOS_USER_AGENT
            }
        });
        const sidecarDeleteResponse = await executeRequest(sidecarDelete, testEnv);
        assertStatus(204, sidecarDeleteResponse);

        const replace = t.createAuthRequest('PUT', '/logo_blogger_40px_2x.png', {
            headers: {
                'User-Agent': MACOS_USER_AGENT,
                'Content-Type': 'image/png'
            },
            body: 'new image'
        });
        const replaceResponse = await executeRequest(replace, testEnv);
        assertStatus(204, replaceResponse);

        const content = await t.getFileContent('logo_blogger_40px_2x.png', testEnv);
        expect(content).toBe('new image');
    });
});
