import { describe, it, expect } from 'vitest';
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { testWorker } from './test-worker';
import type { Env } from './types';

describe('WebDAV macOS tests', () => {
    it('handles macOS WebDAV client OPTIONS request', async () => {
        const request = new Request('http://example.com/', {
            method: 'OPTIONS',
            headers: {
                'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/17.5.0 (x86_64)',
                'Authorization': 'Basic Ym93bWFuOnBhc3N3b3Jk'
            }
        });

        const ctx = createExecutionContext();
        const testEnv: Env = {
            ...env,
            WEBDAV_USERNAME: 'bowman',
            WEBDAV_PASSWORD: 'password'
        };
        const response = await testWorker.fetch(request as any, testEnv, ctx);
        await waitOnExecutionContext(ctx);

        // verify the response status
        expect(response.status).toBe(200);

        // verify the response headers
        expect(response.headers.get('Allow')).toContain('OPTIONS');
        expect(response.headers.get('Allow')).toContain('GET');
        expect(response.headers.get('Allow')).toContain('PUT');
        expect(response.headers.get('Allow')).toContain('PROPFIND');
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

        const request = new Request('http://example.com/.DS_Store', {
            method: 'PROPFIND',
            headers: {
                'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/17.5.0 (x86_64)',
                'Authorization': 'Basic Ym93bWFuOnBhc3N3b3Jk',
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '0'
            },
            body: propfindBody
        });

        const ctx = createExecutionContext();
        const testEnv: Env = {
            ...env,
            WEBDAV_USERNAME: 'bowman',
            WEBDAV_PASSWORD: 'password'
        };
        const response = await testWorker.fetch(request as any, testEnv, ctx);
        await waitOnExecutionContext(ctx);

        // PROPFIND returns 207 Multi-Status even for non-existent resources
        expect(response.status).toBe(207);

        // verify response headers
        expect(response.headers.get('Content-Type')).toBe('application/xml; charset=utf-8');

        // verify response body contains WebDAV XML
        const responseText = await response.text();
        expect(responseText).toContain('multistatus');
    });
});
