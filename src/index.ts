import { WebDAVDelegate, Env, ObjectMetadata } from './types';
import { logWriteOperation, logHttpInteraction, handleDebugRoutes } from './logger';
import {
	isMacOSWebDAVClient,
	authenticateRequest,
	unauthorizedResponse,
	createResponse,
	handleMacOSOptionsRequest
} from './macos';
import { WebDAVDelegateImpl } from './webdav-delegate';

/**
 * Normalize a path by collapsing duplicate slashes and removing the leading slash.
 */
function normalizePath(pathname: string): string {
	return pathname.replace(/\/+/g, '/').replace(/^\//, '');
}

/**
 * Check whether the parent path exists.
 */
async function checkParentExists(path: string, bucket: R2Bucket): Promise<boolean> {
	const lastSlash = path.lastIndexOf('/');
	if (lastSlash <= 0) return true;
	const parentPath = path.substring(0, lastSlash);
	if (!parentPath) return true;
	const parentDir = await bucket.get(parentPath + '/');
	if (parentDir) return true;
	const parentFile = await bucket.get(parentPath);
	if (parentFile) return false;
	return false;
}

	// Main request handler
async function handleWebDAVRequest(request: Request, env: Env): Promise<Response> {
	const userAgent = request.headers.get('user-agent') || '';
	const isMacOS = isMacOSWebDAVClient(userAgent);
	let davDelegate = new WebDAVDelegateImpl();
	davDelegate.init(env);

	// Handle debug routes
	const debugResponse = handleDebugRoutes(request);
	if (debugResponse) {
		return debugResponse;
	}

	// macOS compatibility: handle OPTIONS requests before authentication
	if (isMacOS && request.method === 'OPTIONS') {
		const optionsResponse = await handleMacOSOptionsRequest(request, davDelegate);
		if (optionsResponse) {
			return optionsResponse;
		}
	}

	// Authenticate the request
	if (!authenticateRequest(request, env)) {
		return unauthorizedResponse(request);
	}

	const url = new URL(request.url);
	let path = normalizePath(url.pathname);

	switch (request.method) {
		case 'GET':
		case 'HEAD':
			return await davDelegate.onGet(request);
		case 'OPTIONS':
			return await davDelegate.onOptions(request);
		case 'PROPFIND':
			return await davDelegate.onPropfind(request);
		case 'PUT':
			return await davDelegate.onPut(request);
		case 'DELETE':
			return await davDelegate.onDelete(request);
		case 'MKCOL':
			return await davDelegate.onMkcol(request);
		case 'MOVE':
		case 'COPY':
			// Parse the target path from the Destination header
			const destination = request.headers.get('Destination');
			if (!destination) {
				return createResponse('Bad Request: Missing Destination header', { status: 400 }, request);
			}

			// Normalize the destination path
			let dest = normalizePath(new URL(destination).pathname);

			// Reject moves/copies to the same path
			if (path === dest || path + '/' === dest || path === dest + '/') {
				return createResponse('Forbidden: Cannot move/copy to self', { status: 403 }, request);
			}

			// Read the Overwrite header
			const overwrite = request.headers.get('Overwrite');

			try {
				// Fetch the source object
				const sourceObj = await env.BUCKET.get(path);
				if (!sourceObj) {
					return createResponse('Not Found', { status: 404 }, request);
				}

				// Check whether the destination already exists
				const destExists = await env.BUCKET.get(dest);
				if (destExists) {
					if (overwrite === 'F') {
						return createResponse('Precondition Failed: Destination exists and Overwrite is F', { status: 412 }, request);
					}
					// Overwrite: T or default, allow replacement
				}

				// Check whether the destination parent path exists
				const parentExists = await checkParentExists(dest, env.BUCKET);
				if (!parentExists) {
					return createResponse('Conflict: Destination parent does not exist', { status: 409 }, request);
				}

				// Perform the copy
				await env.BUCKET.put(dest, sourceObj.body, { httpMetadata: sourceObj.httpMetadata });

				// Delete the source object for MOVE
				if (request.method === 'MOVE') {
					await env.BUCKET.delete(path);
				}

				console.log(`${request.method}: ${path} -> ${dest}`);
				logWriteOperation(request.method, path, { sourcePath: path, destPath: dest, result: 'SUCCESS' });

				// Return 204 for overwrite, 201 for a new resource
				const statusCode = destExists ? 204 : 201;
				return createResponse(null, { status: statusCode }, request);
			} catch (error) {
				console.error(`${request.method} operation failed:`, error);
				return createResponse('Internal Server Error', { status: 500 }, request);
			}

		default:
			return createResponse('Method Not Allowed', { status: 405 }, request);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		let response: Response;
		let additionalInfo: string | undefined;

		try {
			response = await handleWebDAVRequest(request, env);
		} catch (error) {
			console.error('Error handling request:', error);
			response = new Response('Internal Server Error', { status: 500 });
			additionalInfo = `Server Error: ${error}`;
		}

		// Record HTTP interaction logs, but avoid duplicate entries
		const method = request.method;
		const url = new URL(request.url);
		const isDebugRoute = url.pathname === '/_debug/http-log';
		const isModifyOperation = ['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'].includes(method);

		if (!isDebugRoute && !isModifyOperation) {
			logHttpInteraction(request, response, additionalInfo);
		}

		return response;
	}
} as ExportedHandler<Env>;
