import { Env } from './types';
import { logHttpInteraction, handleDebugRoutes } from './logger';
import { LogDurableObject } from './log-do';
import { logToD1 } from './log-persistence';
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

	// Handle debug routes only after authentication because logs may contain
	// request paths, client metadata, and operational state.
	const debugResponse = await handleDebugRoutes(request, env);
	if (debugResponse) {
		return debugResponse;
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
		case 'PROPPATCH':
			return await davDelegate.onProppatch(request);

		default:
			return createResponse('Method Not Allowed', { status: 405 }, request);
	}
}

async function logPersistentTargets(
	request: Request,
	response: Response,
	env: Env,
	additionalInfo?: string
): Promise<void> {
	const url = new URL(request.url);
	const path = `${url.pathname}${url.search}`;

	if (env.DB) {
		try {
			await logToD1(env.DB, request, response, additionalInfo);
		} catch (e) {
			console.error('Failed to log to D1:', e);
		}
	}

	if (env.LOG_DO) {
		try {
			const id = env.LOG_DO.idFromName('global');
			const stub = env.LOG_DO.get(id);
			const timestamp = new Date().toISOString();
			const logEntry = `${timestamp} - ${request.method} ${path} -> ${response.status}`;
			const logResponse = await stub.fetch('http://internal/', {
				method: 'POST',
				body: logEntry
			});
			await logResponse.text();
		} catch (e) {
			console.error('Failed to log to Durable Object:', e);
		}
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		let response: Response;
		let additionalInfo: string | undefined;

		try {
			response = await handleWebDAVRequest(request, env);
		} catch (error) {
			console.error('Error handling request:', error);
			response = new Response('Internal Server Error', { status: 500 });
			additionalInfo = `Server Error: ${error}`;
		}

		// Record HTTP interaction logs
		const url = new URL(request.url);
		const isDebugRoute = url.pathname.startsWith('/_debug');

		// Log to memory (for immediate viewing)
		if (!isDebugRoute) {
			logHttpInteraction(request, response, additionalInfo);
			ctx.waitUntil(logPersistentTargets(request, response, env, additionalInfo));
		}

		return response;
	}
} as ExportedHandler<Env>;

// Export Durable Object
export { LogDurableObject };
