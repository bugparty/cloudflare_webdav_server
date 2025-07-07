import { Env,WebDAVDelegate } from './types';
// macOS WebDAV客户端兼容性处理 (基于rclone的实现)
const macOSSessionCache = new Map<string, number>();
const SESSION_TIMEOUT = 300000; // 5分钟

// 检测是否是macOS WebDAV客户端
export function isMacOSWebDAVClient(userAgent: string): boolean {
	return /WebDAVFS|Darwin.*WebDAV|WebDAVLib/i.test(userAgent || '');
}

// 获取macOS会话标识
export function getMacOSSessionKey(request: Request): string {
	const ip = request.headers.get('cf-connecting-ip') ||
	          request.headers.get('x-forwarded-for') ||
	          'unknown';
	const userAgent = (request.headers.get('user-agent') || '').slice(0, 50);
	return `${ip}:${userAgent}`;
}

// 检查macOS会话缓存
export function checkMacOSSession(sessionKey: string): boolean {
	const sessionTime = macOSSessionCache.get(sessionKey);
	const now = Date.now();

	// 清理过期的会话
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

// 设置macOS会话
export function setMacOSSession(sessionKey: string): void {
	macOSSessionCache.set(sessionKey, Date.now());
}

// 为macOS客户端添加兼容性响应头 (参考rclone实现)
export function addMacOSCompatibilityHeaders(headers: Headers): void {
	headers.set('Ms-Author-Via', 'DAV');
	headers.set('DAV', '1, 2');
	headers.set('Server', 'rclone/v1.66.0');
	headers.set('Accept-Ranges', 'bytes');
}

// 创建兼容macOS的响应
export function createResponse(body: BodyInit | null, init: ResponseInit, request: Request): Response {
	const response = new Response(body, init);
	const userAgent = request.headers.get('user-agent') || '';

	if (isMacOSWebDAVClient(userAgent)) {
		addMacOSCompatibilityHeaders(response.headers);
	}

	return response;
}

// 返回401未授权响应
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

// Basic Auth验证函数 (安全的macOS兼容性处理)
export function authenticateRequest(request: Request, env: Env): boolean {
	// 如果环境变量中没有设置用户名和密码，则允许所有请求（向后兼容）
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

	// 检查是否是macOS发送的无效默认凭据
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

// 处理macOS OPTIONS请求
export async function handleMacOSOptionsRequest(request: Request, davDelegate: WebDAVDelegate): Response | null {


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
