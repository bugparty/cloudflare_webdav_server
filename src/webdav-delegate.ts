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
 * Normalize a path by:
 * 1. Decoding URL-encoded characters (e.g., %20 -> space)
 * 2. Collapsing duplicate slashes
 * 3. Removing the leading slash
 */
function normalizePath(pathname: string): string {
	try {
		// Decode URL-encoded characters first
		const decoded = decodeURIComponent(pathname);
		return decoded.replace(/\/+/g, '/').replace(/^\//, '');
	} catch {
		// If decoding fails, fall back to original behavior
		return pathname.replace(/\/+/g, '/').replace(/^\//, '');
	}
}

function removeTrailingSlash(path: string): string {
	return path.replace(/\/+$/, '');
}

function ensureTrailingSlash(path: string): string {
	if (!path || path.endsWith('/')) return path;
	return `${path}/`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function getDestinationPath(destination: string, requestUrl: string): string | null {
	try {
		return normalizePath(new URL(destination, requestUrl).pathname);
	} catch {
		return null;
	}
}

type ResourceInfo = {
	path: string;
	isCollection: boolean;
	size: number;
	updated: Date;
	contentType?: string;
};

async function getResourceInfo(path: string, bucket: R2Bucket): Promise<ResourceInfo | null> {
	if (!path) {
		return {
			path: '',
			isCollection: true,
			size: 0,
			updated: new Date(),
			contentType: 'httpd/unix-directory'
		};
	}

	const directObj = await bucket.get(path);
	if (directObj) {
		const contentType = directObj.httpMetadata?.contentType;
		return {
			path,
			isCollection: path.endsWith('/') || contentType === 'text/directory',
			size: directObj.size,
			updated: directObj.uploaded,
			contentType
		};
	}

	const dirPath = ensureTrailingSlash(path);
	const dirObj = await bucket.get(dirPath);
	if (dirObj) {
		return {
			path: dirPath,
			isCollection: true,
			size: dirObj.size,
			updated: dirObj.uploaded,
			contentType: dirObj.httpMetadata?.contentType || 'httpd/unix-directory'
		};
	}

	const listed = await bucket.list({ prefix: dirPath, delimiter: '/', limit: 1 });
	if (listed.objects.length > 0 || listed.delimitedPrefixes.length > 0) {
		return {
			path: dirPath,
			isCollection: true,
			size: 0,
			updated: listed.objects[0]?.uploaded || new Date(),
			contentType: 'httpd/unix-directory'
		};
	}

	return null;
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

	const parentInfo = await getResourceInfo(parentPath, bucket);
	if (parentInfo?.isCollection) return true;

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

	const destinationPath = getDestinationPath(destination, request.url);
	if (destinationPath === null) {
		return createResponse('Bad Request: Invalid Destination header', { status: 400 }, request);
	}

	// Reject moves/copies to the same path.
	if (
		removeTrailingSlash(sourcePath) === removeTrailingSlash(destinationPath)
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
	const depth = request.headers.get('Depth') || 'infinity';

	try {
		const sourceInfo = await getResourceInfo(sourcePath, env.BUCKET);
		if (!sourceInfo) {
			return createResponse('Not Found', { status: 404 }, request);
		}

		const destinationInfo = await getResourceInfo(destinationPath, env.BUCKET);
		const destinationExists = destinationInfo !== null;
		if (destinationExists && overwrite === 'F') {
			return createResponse('Precondition Failed: Destination exists and Overwrite is F', { status: 412 }, request);
		}

		const parentExists = await checkParentExists(destinationPath, env.BUCKET);
		if (!parentExists) {
			return createResponse('Conflict: Destination parent does not exist', { status: 409 }, request);
		}

		// Handle collection (directory)
		if (sourceInfo.isCollection) {
			return await handleMoveOrCopyCollection(
				request, env, isMove, sourcePath, destinationPath,
				destinationExists, depth
			);
		}

		// Handle file
		const sourceObj = await env.BUCKET.get(sourceInfo.path);
		if (!sourceObj) return createResponse('Not Found', { status: 404 }, request);

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

/**
 * Handle MOVE/COPY for collections (directories).
 * Recursively moves or copies all files and subdirectories.
 */
async function handleMoveOrCopyCollection(
	request: Request,
	env: Env,
	isMove: boolean,
	sourcePath: string,
	destinationPath: string,
	destinationExists: boolean,
	depth: string
): Promise<Response> {
	// Ensure paths end with /
	const sourcePrefix = ensureTrailingSlash(sourcePath);
	const destPrefix = ensureTrailingSlash(destinationPath);

	// If destination exists, delete it first
	if (destinationExists) {
		await deleteCollection(destPrefix, env.BUCKET);
	}

	// Create destination directory (by creating a placeholder, R2 doesn't have true directories)
	// We just need to ensure files can be placed under it

	// For Depth: 0, only create the directory itself (do nothing for R2)
	// For Depth: infinity, recursively copy/move all contents
	if (depth === 'infinity' || depth === 'INFINITY') {
		// List all objects under source
		const allObjects: R2Objects[] = [];
		let cursor: string | undefined;
		do {
			const listed = await env.BUCKET.list({ prefix: sourcePrefix, cursor });
			allObjects.push(listed);
			cursor = listed.truncated ? listed.cursor : undefined;
		} while (cursor);

		// Copy each object to destination
		for (const list of allObjects) {
			for (const obj of list.objects) {
				// Skip the directory placeholder itself
				if (obj.key === sourcePrefix || obj.key === sourcePath) continue;

				// Calculate new key: replace source prefix with destination prefix
				const relativePath = obj.key.slice(sourcePrefix.length);
				const newKey = destPrefix + relativePath;

				// Get and put the object
				const sourceObj = await env.BUCKET.get(obj.key);
				if (sourceObj) {
					await env.BUCKET.put(newKey, sourceObj.body, { httpMetadata: sourceObj.httpMetadata });
				}
			}
		}

		// If MOVE, delete all source objects
		if (isMove) {
			for (const list of allObjects) {
				for (const obj of list.objects) {
					await env.BUCKET.delete(obj.key);
				}
			}
			// Delete source directory placeholder if it exists
			await env.BUCKET.delete(sourcePrefix);
			await env.BUCKET.delete(sourcePath);
		}
	}

	console.log(`${request.method} collection: ${sourcePath} -> ${destinationPath}`);
	logWriteOperation(request.method, sourcePath, {
		sourcePath,
		destPath: destinationPath,
		result: 'SUCCESS'
	});

	const statusCode = destinationExists ? 204 : 201;
	const response = createResponse(null, { status: statusCode }, request);
	logHttpInteraction(request, response, `${request.method} collection SUCCESS: ${sourcePath} -> ${destinationPath}`);
	return response;
}

/**
 * Delete a collection and all its contents.
 */
async function deleteCollection(prefix: string, bucket: R2Bucket): Promise<void> {
	const allObjects: R2Objects[] = [];
	let cursor: string | undefined;
	do {
		const listed = await bucket.list({ prefix, cursor });
		allObjects.push(listed);
		cursor = listed.truncated ? listed.cursor : undefined;
	} while (cursor);

	for (const list of allObjects) {
		for (const obj of list.objects) {
			await bucket.delete(obj.key);
		}
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
		const contentLength = request.headers.get('Content-Length');
		let putBody: ReadableStream | ArrayBuffer | string | null = request.body;
		let bodyLengthForLog = contentLength ? parseInt(contentLength, 10) : undefined;

		if (expectedLength) {
			const expectedLengthValue = parseInt(expectedLength, 10);

			if (contentLength) {
				if (bodyLengthForLog !== expectedLengthValue) {
					return createResponse('Content length mismatch', { status: 403 }, request);
				}
			} else {
				const body = await request.arrayBuffer();
				putBody = body;
				bodyLengthForLog = body.byteLength;
				if (body.byteLength !== expectedLengthValue) {
					return createResponse('Content length mismatch', { status: 403 }, request);
				}
			}
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
			`- Content-Length: ${bodyLengthForLog ?? 'stream'} bytes`,
			`- Is update: ${isUpdate}`,
			`- Timestamp: ${new Date().toISOString()}`
		];

		console.log('PUT operation:', writeInfo.join('\n'));

		try {
			const uploaded = await this.env.BUCKET.put(path, putBody ?? '', {
				httpMetadata: { contentType }
			});

			const etag = uploaded.httpEtag || `"${uploaded.etag}"`;
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
		const depth = request.headers.get('Depth') || '1';
		const xml = await buildPropfindResponse(path, url, this.env, depth);

		if (!xml) {
			return createResponse('Not Found', { status: 404 }, request);
		}

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
	depth: string
): Promise<string | null> {
	const responses: string[] = [];
	const resource = await getResourceInfo(path, env.BUCKET);

	if (!resource) {
		return null;
	}

	const requestHref = url.pathname || '/';
	const selfHref = resource.isCollection && !requestHref.endsWith('/') ? `${requestHref}/` : requestHref;
	const selfMeta: ObjectMetadata = {
		size: resource.isCollection ? 0 : resource.size,
		httpMetadata: {
			updated: resource.updated,
			contentType: resource.contentType
		}
	};

	responses.push(renderResponse(selfHref, selfMeta, resource.isCollection));

	if (!resource.isCollection || depth === '0') {
		return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  ${responses.join('\n')}
</D:multistatus>`;
	}

	const collectionPrefix = ensureTrailingSlash(resource.path);
	const list = await env.BUCKET.list({ prefix: collectionPrefix, delimiter: '/' });
	const seenHrefs = new Set<string>([selfHref]);

	// Render child files
	for (const obj of list.objects || []) {
		// Skip the directory itself (it's already added above)
		if (obj.key === resource.path || obj.key === collectionPrefix || obj.key.endsWith('/')) {
			continue;
		}

		const relativePath = obj.key.slice(collectionPrefix.length);
		// Only include immediate children (no nested slashes)
		if (!relativePath.includes('/')) {
			const href = `${selfHref}${relativePath}`;
			if (seenHrefs.has(href)) continue;
			seenHrefs.add(href);
			const objMeta: ObjectMetadata = {
				size: obj.size,
				httpMetadata: {
					updated: obj.uploaded,
					contentType: obj.httpMetadata?.contentType
				}
			};
			responses.push(renderResponse(href, objMeta, false));
		}
	}

	// Render child directories
	for (const childPrefix of list.delimitedPrefixes || []) {
		const relativePath = childPrefix.slice(collectionPrefix.length);
		const href = `${selfHref}${relativePath}`;
		if (seenHrefs.has(href)) continue;
		seenHrefs.add(href);
		const dirMeta: ObjectMetadata = { size: 0, httpMetadata: { updated: new Date() } };
		responses.push(renderResponse(href, dirMeta, true));
	}

	return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  ${responses.join('\n')}
</D:multistatus>`;
}

function renderResponse(href: string, obj: ObjectMetadata, isCollection: boolean): string {
	const lastmod = obj.httpMetadata.updated.toUTCString();
	const size = obj.size || 0;
	const contentType = obj.httpMetadata.contentType || (isCollection ? 'httpd/unix-directory' : getMimeType(href));
	const displayName = href.split('/').filter(p => p).pop() || '/';

	// URL-encode the href path per RFC 4918
	// Split by '/' to preserve path separators, encode each segment
	const encodedHref = href.split('/').map(segment => {
		// Don't encode empty segments (leading/trailing slashes)
		if (!segment) return segment;
		// Use encodeURIComponent for proper URL encoding
		return encodeURIComponent(segment);
	}).join('/');

	return `<D:response>
    <D:href>${escapeXml(encodedHref)}</D:href>
    <D:propstat>
      <D:prop>
        <D:getlastmodified>${lastmod}</D:getlastmodified>
        <D:getcontentlength>${size}</D:getcontentlength>
        <D:resourcetype>${isCollection ? '<D:collection/>' : ''}</D:resourcetype>
        <D:getcontenttype>${escapeXml(contentType)}</D:getcontenttype>
        <D:displayname>${escapeXml(displayName)}</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}
