import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

// Type assertion to ensure worker is available
const testWorker = worker as unknown as { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };

describe('WebDAV macOS tests', () => {

    it('handles macOS WebDAV client OPTIONS request', async () => {
        const credentials = btoa('testuser:testpass');
        const request = new Request('http://localhost:8080/', {
            method: 'OPTIONS',
            headers: {
                'Host': 'localhost:8080',
                'Accept': '*/*',
                'Content-Length': '0',
                'Connection': 'keep-alive',
                'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)'
            }
        });
        const ctx = createExecutionContext();
        const testEnv: Env = {
            ...env,
            WEBDAV_USERNAME: 'testuser',
            WEBDAV_PASSWORD: 'testpass'
        };
        const response = await testWorker.fetch(request as any, testEnv, ctx);
        await waitOnExecutionContext(ctx);

        // 验证响应状态
        expect(response.status).toBe(200);

        // 验证响应头
        expect(response.headers.get('Accept-Ranges')).toBe('bytes');
        expect(response.headers.get('Allow')).toBe('OPTIONS, LOCK, DELETE, PROPPATCH, COPY, MOVE, UNLOCK, PROPFIND');
        expect(response.headers.get('DAV')).toBe('1, 2');
        expect(response.headers.get('MS-Author-Via')).toBe('DAV');
        expect(response.headers.get('Content-Length')).toBe('0');

        // 验证响应体为空
        const text = await response.text();
        expect(text).toBe('');
    });


    it('handles macOS WebDAV client PROPFIND request for DS_STORE', async () => {
        const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
<D:prop>
<D:getlastmodified/>
<D:getcontentlength/>
<D:creationdate/>
<D:resourcetype/>
</D:prop>
</D:propfind>`;
		const credentials = btoa('bowman:password');
        const request = new Request('http://localhost:8080/.DS_Store', {
            method: 'PROPFIND',
            headers: {
                'Host': 'localhost:8080',
                'Content-Type': 'text/xml',
                'Depth': '0',
                'Accept': '*/*',
                'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)',
                'Content-Length': '179',
                'Connection': 'keep-alive',
				'Authorization': `Basic ${credentials}`
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

        // 验证响应状态
        expect(response.status).toBe(404); // Multi-Status

        // 验证响应头
        expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8"');

        // 验证响应体包含WebDAV XML
        const responseText = await response.text();
        expect(responseText).toBe('Not Found');
    });

});
