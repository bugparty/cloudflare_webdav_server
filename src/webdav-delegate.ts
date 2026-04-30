import { WebDAVDelegate, Env, ObjectMetadata } from './types';
import { createResponse, addMacOSCompatibilityHeaders } from './macos';
import { logWriteOperation, logHttpInteraction, handleDebugRoutes } from './logger';

/**
 * Normalize a path by collapsing duplicate slashes and removing the leading slash.
 */
function normalizePath(pathname: string): string {
	return pathname.replace(/\/+/g, '/').replace(/^\//, '');
}

/**
 * Generate a content-based ETag.
 */
async function generateETag(content: ArrayBuffer | string): Promise<string> {
	// Use the Web Crypto API to generate a SHA-1 hash
	const data = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
	const hashBuffer = await crypto.subtle.digest('SHA-1', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	return `"${hashHex}"`;
}

/**
 * Validate the If-Match condition.
 */
async function validateIfMatch(
	ifMatch: string | null,
	existingObj: R2ObjectBody | null
): Promise<{ valid: boolean; status?: number }> {
	if (!ifMatch) return { valid: true };

	// If-Match: * means the resource must exist
	if (ifMatch === '*') {
		if (!existingObj) {
			return { valid: false, status: 412 }; // Precondition Failed
		}
		return { valid: true };
	}

	// If-Match: "etag1", "etag2" - one of them must match
	if (!existingObj) {
		return { valid: false, status: 412 };
	}

	const etags = ifMatch.split(',').map(e => e.trim().replace(/"/g, ''));
	const content = await existingObj.arrayBuffer();
	const currentEtag = await generateETag(content);
	const currentEtagClean = currentEtag.replace(/"/g, '');

	if (!etags.includes(currentEtagClean)) {
		return { valid: false, status: 412 };
	}

	return { valid: true };
}

/**
 * Validate the If-None-Match condition.
 */
async function validateIfNoneMatch(
	ifNoneMatch: string | null,
	existingObj: R2ObjectBody | null
): Promise<{ valid: boolean; status?: number }> {
	if (!ifNoneMatch) return { valid: true };

	// If-None-Match: * means the resource must not exist
	if (ifNoneMatch === '*') {
		if (existingObj) {
			return { valid: false, status: 412 }; // Precondition Failed
		}
		return { valid: true };
	}

	// If-None-Match: "etag1", "etag2" - none of them may match
	if (!existingObj) {
		return { valid: true };
	}

	const etags = ifNoneMatch.split(',').map(e => e.trim().replace(/"/g, ''));
	const content = await existingObj.arrayBuffer();
	const currentEtag = await generateETag(content);
	const currentEtagClean = currentEtag.replace(/"/g, '');

	if (etags.includes(currentEtagClean)) {
		return { valid: false, status: 412 };
	}

	return { valid: true };
}

/**
 * Check whether the parent path exists.
 */
async function checkParentExists(path: string, bucket: R2Bucket): Promise<boolean> {
	const lastSlash = path.lastIndexOf('/');
	if (lastSlash <= 0) return true; // The root directory always exists.

	const parentPath = path.substring(0, lastSlash);
	if (!parentPath) return true;

	// Check whether the parent path is a directory
	const parentDir = await bucket.get(parentPath + '/');
	if (parentDir) return true;

	// Check whether the parent path is a file, which should not happen
	const parentFile = await bucket.get(parentPath);
	if (parentFile) return false; // The parent path is a file, not a directory

	return false; // The parent path does not exist
}

export class WebDAVDelegateImpl implements WebDAVDelegate {
	env: Env;
	constructor() {
		this.env = {} as Env;
	}
	init(env: Env) {
		this.env = env;
	}

	async onGet(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);

		// GET/HEAD download or metadata retrieval
		const obj = await this.env.BUCKET.get(path);
		if (!obj) return createResponse('Not Found', { status: 404 }, request);

		// Check If-None-Match for caching
		const ifNoneMatch = request.headers.get('If-None-Match');
		if (ifNoneMatch) {
			const content = await obj.arrayBuffer();
			const etag = await generateETag(content);
			const etags = ifNoneMatch.split(',').map(e => e.trim().replace(/"/g, ''));
			if (etags.includes(etag.replace(/"/g, ''))) {
				return createResponse(null, { status: 304 }, request); // Not Modified
			}
			// Re-fetch the object because the body has already been consumed
			const obj2 = await this.env.BUCKET.get(path);
			return createResponse(request.method === 'HEAD' ? null : obj2!.body, {
				status: 200,
				headers: {
					'Content-Type': obj2!.httpMetadata?.contentType || 'application/octet-stream',
					'Content-Length': obj2!.size.toString(),
					'Last-Modified': obj2!.uploaded.toUTCString(),
					'ETag': etag
				}
			}, request);
		}

		return createResponse(request.method === 'HEAD' ? null : obj.body, {
			status: 200,
			headers: {
				'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
				'Content-Length': obj.size.toString(),
				'Last-Modified': obj.uploaded.toUTCString()
			}
		}, request);
	}

	async onPut(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);

		// Reject requests with a Content-Range header
		if (request.headers.get('Content-Range')) {
			return createResponse('Content-Range not supported for PUT', { status: 400 }, request);
		}

		// Check X-Expected-Entity-Length (macOS Finder)
		const expectedLength = request.headers.get('X-Expected-Entity-Length');
		const body = await request.arrayBuffer();
		if (expectedLength && parseInt(expectedLength) !== body.byteLength) {
			return createResponse('Content length mismatch', { status: 403 }, request);
		}

		const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

		// Check whether the file already exists
		const existingObj = await this.env.BUCKET.get(path);
		const isUpdate = existingObj !== null;

		// Validate conditional requests
		const ifMatch = request.headers.get('If-Match');
		const ifNoneMatch = request.headers.get('If-None-Match');

		const matchResult = await validateIfMatch(ifMatch, existingObj);
		if (!matchResult.valid) {
			return createResponse('Precondition Failed', { status: matchResult.status! }, request);
		}

		const noneMatchResult = await validateIfNoneMatch(ifNoneMatch, existingObj);
		if (!noneMatchResult.valid) {
			return createResponse('Precondition Failed', { status: noneMatchResult.status! }, request);
		}

		// Check whether the parent path exists for new files only
		if (!isUpdate) {
			const parentExists = await checkParentExists(path, this.env.BUCKET);
			if (!parentExists) {
				return createResponse('Conflict: Parent does not exist', { status: 409 }, request);
			}
		}

		// Prepare log details
		const writeInfo = [
			`PUT Operation Details:`,
			`- Target path: ${path}`,
			`- Content-Type: ${contentType}`,
			`- Content-Length: ${body.byteLength} bytes`,
			`- Is update: ${isUpdate}`,
			`- Timestamp: ${new Date().toISOString()}`
		];

		console.log('PUT operation:', writeInfo.join('\n'));

		try {
			await this.env.BUCKET.put(path, body, {
				httpMetadata: { contentType }
			});

			const etag = await generateETag(body);
			const statusCode = isUpdate ? 204 : 201;

			logWriteOperation('PUT', path, { operation: 'PUT', path, result: 'SUCCESS' });

			const response = createResponse(null, {
				status: statusCode,
				headers: { 'ETag': etag }
			}, request);
			logHttpInteraction(request, response, writeInfo.join('\n') + '\n- Result: SUCCESS');
			return response;
		} catch (error) {
			console.error('PUT operation failed:', error);
			const response = createResponse('Internal Server Error', { status: 500 }, request);
			logHttpInteraction(request, response, `FAILED: ${error}`);
			return response;
		}
	}

	async onDelete(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);

		// Check whether the file exists first
		const existingObj = await this.env.BUCKET.get(path);
		if (!existingObj) {
			return createResponse('Not Found', { status: 404 }, request);
		}

		// Validate the If-Match condition
		const ifMatch = request.headers.get('If-Match');
		if (ifMatch) {
			const matchResult = await validateIfMatch(ifMatch, existingObj);
			if (!matchResult.valid) {
				return createResponse('Precondition Failed', { status: matchResult.status! }, request);
			}
		}

		console.log(`DELETE operation: ${path}`);

		try {
			await this.env.BUCKET.delete(path);
			logWriteOperation('DELETE', path, { operation: 'DELETE', path, result: 'SUCCESS' });
			const response = createResponse(null, { status: 204 }, request);
			logHttpInteraction(request, response, 'DELETE SUCCESS');
			return response;
		} catch (error) {
			console.error('DELETE operation failed:', error);
			const response = createResponse('Internal Server Error', { status: 500 }, request);
			return response;
		}
	}

	async onMkcol(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);
		if (!path.endsWith('/')) path += '/';

		// Check whether it already exists
		const existing = await this.env.BUCKET.get(path);
		if (existing) {
			return createResponse('Method Not Allowed: Resource already exists', { status: 405 }, request);
		}

		// Check whether a file with the same name exists
		const filePath = path.slice(0, -1); // Remove the trailing slash
		const existingFile = await this.env.BUCKET.get(filePath);
		if (existingFile) {
			return createResponse('Method Not Allowed: File with same name exists', { status: 405 }, request);
		}

		// Check whether the parent path exists
		const parentExists = await checkParentExists(path, this.env.BUCKET);
		if (!parentExists) {
			return createResponse('Conflict: Parent does not exist', { status: 409 }, request);
		}

		console.log(`MKCOL operation: ${path}`);

		try {
			await this.env.BUCKET.put(path, '', { httpMetadata: { contentType: 'text/directory' } });
			logWriteOperation('MKCOL', path, { operation: 'MKCOL', path, result: 'SUCCESS' });
			const response = createResponse(null, { status: 201 }, request);
			logHttpInteraction(request, response, 'MKCOL SUCCESS');
			return response;
		} catch (error) {
			console.error('MKCOL operation failed:', error);
			const response = createResponse('Internal Server Error', { status: 500 }, request);
			return response;
		}
	}

	async onPropfind(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);
		const depth = request.headers.get('Depth') || '1';
		const list = await this.env.BUCKET.list({ prefix: path, delimiter: '/' });
		const xml = await buildPropfindResponse(path, new URL(request.url), this.env, list);

		return createResponse(xml, {
			status: 207,
			headers: { 'Content-Type': 'application/xml; charset="utf-8"' }
		}, request);
	}

	async onOptions(request: Request): Promise<Response> {
		const response = new Response(null, {
			status: 200,
			headers: {
				'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY',
				'DAV': '1, 2'
			}
		});
		addMacOSCompatibilityHeaders(response.headers);
		return response;
	}
}

async function buildPropfindResponse(
	path: string,
	url: URL,
	env: Env,
	list: R2Objects
): Promise<string> {
	const responses: string[] = [];

	// Get metadata for the object itself
	let selfMeta: ObjectMetadata | null = null;
	try {
		const selfObj = await env.BUCKET.get(path);
		if (selfObj) {
			selfMeta = {
				size: selfObj.size,
				httpMetadata: {
					updated: selfObj.uploaded,
					contentType: selfObj.httpMetadata?.contentType
				}
			};
		}
	} catch (e) {
		// Ignore errors here
	}

	if (!selfMeta) {
		selfMeta = { size: 0, httpMetadata: { updated: new Date() } };
	}

	responses.push(renderResponse(url.pathname, selfMeta));

	// Render child files
	for (const obj of list.objects || []) {
		let relativePath = obj.key;
		if (path && obj.key.startsWith(path)) {
			relativePath = obj.key.slice(path.length);
		}
		if (!relativePath.includes('/') || relativePath === '') {
			const href = url.pathname + (relativePath ? relativePath : obj.key);
			const objMeta: ObjectMetadata = {
				size: obj.size,
				httpMetadata: {
					updated: obj.uploaded,
					contentType: obj.httpMetadata?.contentType
				}
			};
			responses.push(renderResponse(href, objMeta));
		}
	}

	// Render child directories
	for (const prefix of list.delimitedPrefixes || []) {
		let relativePath = prefix;
		if (path && prefix.startsWith(path)) {
			relativePath = prefix.slice(path.length);
		}
		const href = url.pathname + relativePath;
		const dirMeta: ObjectMetadata = { size: 0, httpMetadata: { updated: new Date() } };
		responses.push(renderResponse(href, dirMeta));
	}

	return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  ${responses.join('\n')}
</D:multistatus>`;
}

function renderResponse(href: string, obj: ObjectMetadata): string {
	const lastmod = obj.httpMetadata.updated.toUTCString();
	const size = obj.size || 0;
	return `<D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:getlastmodified>${lastmod}</D:getlastmodified>
        <D:getcontentlength>${size}</D:getcontentlength>
        <D:resourcetype>${href.endsWith('/') ? '<D:collection/>' : ''}</D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}
