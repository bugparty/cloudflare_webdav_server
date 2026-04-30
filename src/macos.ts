import { Env,WebDAVDelegate } from './types';
// macOS WebDAV client compatibility handling (based on rclone)
const macOSSessionCache = new Map<string, number>();
const SESSION_TIMEOUT = 300000; // 5 minutes

// Detect whether this is a macOS WebDAV client
export function isMacOSWebDAVClient(userAgent: string): boolean {
	return /WebDAVFS|Darwin.*WebDAV|WebDAVLib/i.test(userAgent || '');
}

// Get the macOS session key
export function getMacOSSessionKey(request: Request): string {
	const ip = request.headers.get('cf-connecting-ip') ||
	          request.headers.get('x-forwarded-for') ||
	          'unknown';
	const userAgent = (request.headers.get('user-agent') || '').slice(0, 50);
	return `${ip}:${userAgent}`;
}

// Check the macOS session cache
export function checkMacOSSession(sessionKey: string): boolean {
	const sessionTime = macOSSessionCache.get(sessionKey);
	const now = Date.now();

	// Remove expired sessions
	for (const [key, time] of macOSSessionCache.entries()) {
		if (now - time > SESSION_TIMEOUT) {
			macOSSessionCache.delete(key);
		}
	}

	if (sessionTime && now - sessionTime < SESSION_TIMEOUT) {
		return true;
	}
	return false;
}

// Set the macOS session
export function setMacOSSession(sessionKey: string): void {
	macOSSessionCache.set(sessionKey, Date.now());
}

// Add compatibility headers for macOS clients (based on rclone)
export function addMacOSCompatibilityHeaders(headers: Headers): void {
	headers.set('Ms-Author-Via', 'DAV');
	headers.set('DAV', '1, 2');
	headers.set('Server', 'rclone/v1.66.0');
	headers.set('Accept-Ranges', 'bytes');
}

// Create a response compatible with macOS clients
export function createResponse(body: BodyInit | null, init: ResponseInit, request: Request): Response {
	const response = new Response(body, init);
	const userAgent = request.headers.get('user-agent') || '';

	if (isMacOSWebDAVClient(userAgent)) {
		addMacOSCompatibilityHeaders(response.headers);
	}

	return response;
}

// Return a 401 unauthorized response
export function unauthorizedResponse(request: Request): Response {
	const now = new Date();
	const formattedNow = now.toISOString();
	const response = new Response('401 Unauthorized', {
		status: 401,
		headers: {
			'WWW-Authenticate': `Basic realm=""`,
			'Content-Type': 'text/plain',
			'DAV': '1,2',
			'Allow': 'OPTIONS, LOCK, DELETE, PROPPATCH, COPY, MOVE, UNLOCK, PROPFIND'
		}
	});

	const userAgent = request.headers.get('user-agent') || '';
	if (isMacOSWebDAVClient(userAgent)) {
		addMacOSCompatibilityHeaders(response.headers);
	}

	return response;
}

// Basic Auth validation function (safe macOS compatibility handling)
export function authenticateRequest(request: Request, env: Env): boolean {
	// If username and password are not set in the environment, allow all requests for backward compatibility
	if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
		return true;
	}

	const userAgent = request.headers.get('user-agent') || '';
	const isMacOS = isMacOSWebDAVClient(userAgent);
	const sessionKey = getMacOSSessionKey(request);

	console.log('Request method:', request.method, 'URL:', new URL(request.url).pathname);
	//console.log('User-Agent:', userAgent);
	//console.log('Is macOS client:', isMacOS);

	const authHeader = request.headers.get('Authorization');
	console.log('Authorization header:', authHeader);

	if (!authHeader || !authHeader.startsWith('Basic ')) {
		console.log('Missing or invalid Authorization header');
		return false;
	}

	const base64Credentials = authHeader.slice(6);
	let credentials: string;

	try {
		//console.log('Base64 credentials:', base64Credentials);
		credentials = atob(base64Credentials);
		//console.log('Decoded credentials:', credentials);
	} catch (e) {
		console.log('Failed to decode base64 credentials:', e);
		return false;
	}

	let [username, password] = credentials.split(':');

	// Check whether these are the invalid default credentials sent by macOS
	if (credentials.startsWith('No user accoun')) {
		console.log('Detected macOS invalid default credentials, rejecting');
		return false;
	}

	if (typeof username === 'undefined' || typeof password === 'undefined') {
		console.log('Invalid credentials format');
		return false;
	}
	//console.log('Parsed credentials - Username:', username, 'Password:', password);
	//console.log('Expected - Username:', env.WEBDAV_USERNAME, 'Password:', env.WEBDAV_PASSWORD);
	username = username.trim();
	password = password.trim();

	const isValid = username === env.WEBDAV_USERNAME && password === env.WEBDAV_PASSWORD;
	//console.log('Auth result:', isValid ? 'SUCCESS' : 'FAILED','- Expected:', env.WEBDAV_USERNAME, '- Got:', username);

	return isValid;
}

// Handle macOS OPTIONS requests
export async function handleMacOSOptionsRequest(request: Request, davDelegate: WebDAVDelegate): Promise<Response | null> {


	if (request.method === 'OPTIONS' ) {
		const response = new Response(null, {
			status: 200,
			headers: {
				'Allow': 'OPTIONS, LOCK, DELETE, PROPPATCH, COPY, MOVE, UNLOCK, PROPFIND',
				'DAV': '1,2',
				'Content-Length': '0',
			}
		});
		addMacOSCompatibilityHeaders(response.headers);
		return response;
	}

	return null;
}
