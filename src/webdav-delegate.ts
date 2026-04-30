import { WebDAVDelegate, Env, ObjectMetadata } from './types';
import { createResponse, addMacOSCompatibilityHeaders } from './macos';
import { logWriteOperation, logHttpInteraction } from './logger';
import {
	getLock,
	createLock,
	deleteLock,
	parseLockRequest,
	generateLockResponse,
	checkPathLocked
} from './lock';
import { getMimeType, detectMimeTypeFromContent } from './mime';

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
	// Remove trailing slash if present
	const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path;

	const lastSlash = normalizedPath.lastIndexOf('/');
	if (lastSlash <= 0) return true; // The root directory always exists.

	const parentPath = normalizedPath.substring(0, lastSlash);
	if (!parentPath) return true;

	// Check whether the parent path is a directory
	const parentDir = await bucket.get(parentPath + '/');
	if (parentDir) return true;

	// Check whether the parent path is a file, which should not happen
	const parentFile = await bucket.get(parentPath);
	if (parentFile) return false; // The parent path is a file, not a directory

	return false; // The parent path does not exist
}

async function handleMoveOrCopy(
	request: Request,
	env: Env,
	isMove: boolean
): Promise<Response> {
	const url = new URL(request.url);
	const sourcePath = normalizePath(url.pathname);

	// Parse the target path from the Destination header.
	const destination = request.headers.get('Destination');
	if (!destination) {
		return createResponse('Bad Request: Missing Destination header', { status: 400 }, request);
	}

	const destinationPath = normalizePath(new URL(destination).pathname);

	// Reject moves/copies to the same path.
	if (
		sourcePath === destinationPath ||
		sourcePath + '/' === destinationPath ||
		sourcePath === destinationPath + '/'
	) {
		return createResponse('Forbidden: Cannot move/copy to self', { status: 403 }, request);
	}

	// Check whether the source and destination are locked.
	const ifHeader = request.headers.get('If');
	const sourceLockCheck = await checkPathLocked(sourcePath, env, ifHeader);
	if (sourceLockCheck.locked) {
		return createResponse('Locked', { status: sourceLockCheck.status! }, request);
	}

	const destinationLockCheck = await checkPathLocked(destinationPath, env, ifHeader);
	if (destinationLockCheck.locked) {
		return createResponse('Locked', { status: destinationLockCheck.status! }, request);
	}

	const overwrite = request.headers.get('Overwrite');

	try {
		const sourceObj = await env.BUCKET.get(sourcePath);
		if (!sourceObj) {
			return createResponse('Not Found', { status: 404 }, request);
		}

		const destinationExists = await env.BUCKET.get(destinationPath);
		if (destinationExists && overwrite === 'F') {
			return createResponse('Precondition Failed: Destination exists and Overwrite is F', { status: 412 }, request);
		}

		const parentExists = await checkParentExists(destinationPath, env.BUCKET);
		if (!parentExists) {
			return createResponse('Conflict: Destination parent does not exist', { status: 409 }, request);
		}

		await env.BUCKET.put(destinationPath, sourceObj.body, { httpMetadata: sourceObj.httpMetadata });

		if (isMove) {
			await env.BUCKET.delete(sourcePath);
		}

		console.log(`${request.method}: ${sourcePath} -> ${destinationPath}`);
		logWriteOperation(request.method, sourcePath, {
			sourcePath,
			destPath: destinationPath,
			result: 'SUCCESS'
		});

		const statusCode = destinationExists ? 204 : 201;
		const response = createResponse(null, { status: statusCode }, request);
		logHttpInteraction(request, response, `${request.method} SUCCESS: ${sourcePath} -> ${destinationPath}`);
		return response;
	} catch (error) {
		console.error(`${request.method} operation failed:`, error);
		const response = createResponse('Internal Server Error', { status: 500 }, request);
		logHttpInteraction(request, response, `${request.method} FAILED: ${error}`);
		return response;
	}
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

		// Check if resource is locked
		const ifHeader = request.headers.get('If');
		const lockCheck = await checkPathLocked(path, this.env, ifHeader);
		if (lockCheck.locked) {
			return createResponse('Locked', { status: lockCheck.status! }, request);
		}

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

		const contentType = request.headers.get('Content-Type') || getMimeType(path);

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

		// Check if resource is locked
		const ifHeader = request.headers.get('If');
		const lockCheck = await checkPathLocked(path, this.env, ifHeader);
		if (lockCheck.locked) {
			return createResponse('Locked', { status: lockCheck.status! }, request);
		}

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

		// For root-level directories, skip parent check
		const pathWithoutSlash = path.slice(0, -1);
		if (pathWithoutSlash.includes('/')) {
			// Check whether the parent path exists
			const parentExists = await checkParentExists(path, this.env.BUCKET);
			if (!parentExists) {
				return createResponse('Conflict: Parent does not exist', { status: 409 }, request);
			}
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

	async onMove(request: Request): Promise<Response> {
		return handleMoveOrCopy(request, this.env, true);
	}

	async onCopy(request: Request): Promise<Response> {
		return handleMoveOrCopy(request, this.env, false);
	}

	/**
	 * Handle WebDAV PROPFIND requests to retrieve resource properties.
	 * 
	 * PROPFIND is used by WebDAV clients (e.g., macOS Finder) to query metadata
	 * about files and directories, such as size, modification date, and resource type.
	 * This implementation lists the target resource and its immediate children,
	 * then formats the response as XML according to the WebDAV multistatus format.
	 * 
	 * @param request - The incoming WebDAV PROPFIND request
	 * @returns A 207 Multi-Status response containing XML-formatted resource metadata
	 */
	async onPropfind(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);
		const list = await this.env.BUCKET.list({ prefix: path, delimiter: '/' });
		const xml = await buildPropfindResponse(path, new URL(request.url), this.env, list);

		return createResponse(xml, {
			status: 207,
			headers: { 'Content-Type': 'application/xml; charset=utf-8' }
		}, request);
	}

	async onOptions(_request: Request): Promise<Response> {
		const response = new Response(null, {
			status: 200,
			headers: {
				'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK',
				'DAV': '1, 2'
			}
		});
		addMacOSCompatibilityHeaders(response.headers);
		return response;
	}

	async onLock(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);

		// Check if resource exists
		const existingObj = await this.env.BUCKET.get(path);

		// Parse lock request body
		const body = await request.text();
		const lockOptions = parseLockRequest(body);

		// Check Depth header (default to 0 for existing resources, infinity for collections)
		const depthHeader = request.headers.get('Depth');
		if (depthHeader) {
			lockOptions.depth = depthHeader === '0' ? '0' : 'infinity';
		}

		// Check for existing lock
		const existingLock = await getLock(path, this.env);
		if (existingLock) {
			// Resource is already locked
			// Return 423 Locked if the lock token doesn't match
			const ifHeader = request.headers.get('If');
			if (ifHeader && !ifHeader.includes(existingLock.token)) {
				return createResponse('Locked', { status: 423 }, request);
			}
			// Lock refresh - return existing lock
			return createResponse(generateLockResponse(existingLock, url.pathname), {
				status: 200,
				headers: {
					'Content-Type': 'application/xml; charset=utf-8',
					'Lock-Token': `<${existingLock.token}>`
				}
			}, request);
		}

		// Create new lock
		const lock = await createLock(path, this.env, lockOptions);

		console.log(`LOCK operation: ${path} (token: ${lock.token})`);
		logWriteOperation('LOCK', path, { operation: 'LOCK', path, token: lock.token, result: 'SUCCESS' });

		const response = createResponse(generateLockResponse(lock, url.pathname), {
			status: existingObj ? 200 : 201,
			headers: {
				'Content-Type': 'application/xml; charset=utf-8',
				'Lock-Token': `<${lock.token}>`
			}
		}, request);

		logHttpInteraction(request, response, `LOCK SUCCESS: ${lock.token}`);
		return response;
	}

	async onUnlock(request: Request): Promise<Response> {
		const url = new URL(request.url);
		let path = normalizePath(url.pathname);

		// Parse Lock-Token header
		const lockTokenHeader = request.headers.get('Lock-Token');
		if (!lockTokenHeader) {
			return createResponse('Bad Request: Missing Lock-Token header', { status: 400 }, request);
		}

		// Extract token from header: <opaquelocktoken:xxx>
		const tokenMatch = lockTokenHeader.match(/<(opaquelocktoken:[a-f0-9-]+)>/i);
		if (!tokenMatch) {
			return createResponse('Bad Request: Invalid Lock-Token format', { status: 400 }, request);
		}
		const token = tokenMatch[1];

		// Check if lock exists
		const existingLock = await getLock(path, this.env);
		if (!existingLock) {
			// No lock exists - return 409 Conflict or 204?
			// RFC 4918 says UNLOCK on unlocked resource should return 204
			return createResponse(null, { status: 204 }, request);
		}

		// Verify token matches
		if (existingLock.token !== token) {
			// Token doesn't match - return 403 Forbidden
			return createResponse('Forbidden: Lock token does not match', { status: 403 }, request);
		}

		// Delete the lock
		await deleteLock(path, this.env);

		console.log(`UNLOCK operation: ${path} (token: ${token})`);
		logWriteOperation('UNLOCK', path, { operation: 'UNLOCK', path, token, result: 'SUCCESS' });

		const response = createResponse(null, { status: 204 }, request);
		logHttpInteraction(request, response, 'UNLOCK SUCCESS');
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
		// Skip the directory itself (it's already added above)
		if (obj.key === path || obj.key === path + '/') {
			continue;
		}

		let relativePath = obj.key;
		if (path && obj.key.startsWith(path)) {
			relativePath = obj.key.slice(path.length);
		}
		// Only include immediate children (no nested slashes)
		if (!relativePath.includes('/')) {
			const href = url.pathname + relativePath;
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
