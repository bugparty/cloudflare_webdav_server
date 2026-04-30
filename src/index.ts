import { Env } from './types';
import { logHttpInteraction, handleDebugRoutes } from './logger';
import {
	isMacOSWebDAVClient,
	authenticateRequest,
	unauthorizedResponse,
	createResponse,
	handleMacOSOptionsRequest
} from './macos';
import { WebDAVDelegateImpl } from './webdav-delegate';

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
		case 'LOCK':
			return await davDelegate.onLock(request);
		case 'UNLOCK':
			return await davDelegate.onUnlock(request);
		case 'MOVE':
			return await davDelegate.onMove(request);
		case 'COPY':
			return await davDelegate.onCopy(request);

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
