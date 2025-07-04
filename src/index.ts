import { WebDAVDelegate, Env, ObjectMetadata} from './types';
import { logWriteOperation, logHttpInteraction, handleDebugRoutes } from './logger';

// macOS WebDAV客户端兼容性处理 (基于rclone的实现)
const macOSSessionCache = new Map<string, number>();
const SESSION_TIMEOUT = 300000; // 5分钟

// 检测是否是macOS WebDAV客户端
function isMacOSWebDAVClient(userAgent: string): boolean {
	return /WebDAVFS|Darwin.*WebDAV|WebDAVLib/i.test(userAgent || '');
}

// 获取macOS会话标识
function getMacOSSessionKey(request: Request): string {
	const ip = request.headers.get('cf-connecting-ip') ||
	          request.headers.get('x-forwarded-for') ||
	          'unknown';
	const userAgent = (request.headers.get('user-agent') || '').slice(0, 50);
	return `${ip}:${userAgent}`;
}

// 检查macOS会话缓存
function checkMacOSSession(sessionKey: string): boolean {
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
function setMacOSSession(sessionKey: string): void {
	macOSSessionCache.set(sessionKey, Date.now());
}

// Basic Auth验证函数 (安全的macOS兼容性处理)
function authenticateRequest(request: Request, env: Env): boolean {
	// 如果环境变量中没有设置用户名和密码，则允许所有请求（向后兼容）
	if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
		return true;
	}

	const userAgent = request.headers.get('user-agent') || '';
	const isMacOS = isMacOSWebDAVClient(userAgent);
	const sessionKey = getMacOSSessionKey(request);

	console.log('Request method:', request.method, 'URL:', new URL(request.url).pathname);
	console.log('User-Agent:', userAgent);
	console.log('Is macOS client:', isMacOS);

	// macOS兼容性：检查会话缓存 - 只有成功认证过的才能使用缓存
	if (isMacOS && checkMacOSSession(sessionKey)) {
		console.log('macOS session cache hit, allowing request');
		return true;
	}

	const authHeader = request.headers.get('Authorization');
	console.log('Authorization header:', authHeader);

	if (!authHeader || !authHeader.startsWith('Basic ')) {
		console.log('Missing or invalid Authorization header');
		return false;
	}

	const base64Credentials = authHeader.slice(6);
	let credentials: string;

	try {
		credentials = atob(base64Credentials);
		console.log('Decoded credentials:', credentials);
	} catch (e) {
		console.log('Failed to decode base64 credentials:', e);
		return false;
	}

	const [username, password] = credentials.split(':');

	// 检查是否是macOS发送的无效默认凭据
	if (credentials.startsWith('No user accoun')) {
		console.log('Detected macOS invalid default credentials, rejecting');
		return false;
	}

	const isValid = username === env.WEBDAV_USERNAME && password === env.WEBDAV_PASSWORD;
	console.log('Auth result:', isValid ? 'SUCCESS' : 'FAILED',
		'- Expected:', env.WEBDAV_USERNAME, '- Got:', username);

	// 如果认证成功且是macOS客户端，缓存会话
	if (isValid && isMacOS) {
		setMacOSSession(sessionKey);
		console.log('Cached macOS session for:', sessionKey);
	}

	return isValid;
}

// 返回401未授权响应
function unauthorizedResponse(): Response {
	return new Response('Unauthorized', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="WebDAV Server"',
			'Content-Type': 'text/plain',
			'DAV': '1,2',
			'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY'
		}
	});
}

// 为macOS客户端添加兼容性响应头 (参考rclone实现)
function addMacOSCompatibilityHeaders(headers: Headers): void {
	headers.set('Ms-Author-Via', 'DAV');
	headers.set('DAV', '1, 2');
	headers.set('Server', 'WebDAV Server/1.0');
}

// 创建兼容macOS的响应
function createResponse(body: BodyInit | null, init: ResponseInit, request: Request): Response {
	const response = new Response(body, init);
	const userAgent = request.headers.get('user-agent') || '';

	if (isMacOSWebDAVClient(userAgent)) {
		addMacOSCompatibilityHeaders(response.headers);
	}

	return response;
}

// 主要的请求处理函数
async function handleWebDAVRequest(request: Request, env: Env): Promise<Response> {
	const userAgent = request.headers.get('user-agent') || '';
	const isMacOS = isMacOSWebDAVClient(userAgent);
	let davDelegate = new WebDAVDelegateImpl();
	davDelegate.init(env);
	// 处理调试路由
	const debugResponse = handleDebugRoutes(request);
	if (debugResponse) {
		return debugResponse;
	}

	// macOS兼容性：对于OPTIONS请求，先处理再进行认证
	if (request.method === 'OPTIONS' && isMacOS) {
		const response = new Response(null, {
			status: 200,
			headers: {
				'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY',
				'DAV': '1,2,3'
			}
		});
		addMacOSCompatibilityHeaders(response.headers);
		return response;
	}
	if (request.method === "PROPFIND") {
		return await davDelegate.onPropfind(request);
	}

	// 验证身份 - 现在严格要求认证
	if (!authenticateRequest(request, env)) {
		const response = unauthorizedResponse();
		// 为macOS客户端添加兼容性头部
		if (isMacOS) {
			addMacOSCompatibilityHeaders(response.headers);
		}
		return response;
	}

	const url = new URL(request.url);
	// 去掉前缀 route，不同部署时可能要 trim
	let path = url.pathname.replace(/^\/?/, '');

	switch (request.method) {
		case 'GET':
		case 'HEAD':
			// GET/HEAD 下载或获取元信息
			const obj = await env.BUCKET.get(path);
			if (!obj) return createResponse('Not Found', { status: 404 }, request);
			return createResponse(request.method === 'HEAD' ? null : obj.body, {
				status: 200,
				headers: {
					'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
					'Content-Length': obj.size.toString(),
					'Last-Modified': obj.uploaded.toUTCString()
				}
			}, request);		case 'PUT':
			// 上传／覆盖 - 添加详细的写入日志
			const body = await request.arrayBuffer();
			const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
			const contentLength = body.byteLength;

			// 准备写入日志信息
			const writeInfo = [
				`PUT Operation Details:`,
				`- Target path: ${path}`,
				`- Content-Type: ${contentType}`,
				`- Content-Length: ${contentLength} bytes`,
				`- Body size: ${contentLength} bytes`,
				`- Timestamp: ${new Date().toISOString()}`
			];

			// 对于小文件，记录更多信息
			let contentPreview = '';
			if (contentLength < 1024) {
				try {
					const textContent = new TextDecoder().decode(body.slice(0, 200));
					contentPreview = textContent.substring(0, 100) + (textContent.length > 100 ? '...' : '');
					writeInfo.push(`- Content preview: "${contentPreview}"`);
				} catch {
					writeInfo.push(`- Content: [Binary data, ${contentLength} bytes]`);
				}
			} else {
				writeInfo.push(`- Content: [Large file, ${contentLength} bytes]`);
			}

			const writeLogInfo = writeInfo.join('\n');
			console.log('PUT operation:', writeLogInfo);

			// 记录到写入操作日志
			const writeOperationDetails: any = {
				operation: 'PUT',
				path: path,
				contentType: contentType,
				contentLength: contentLength,
				contentPreview: contentPreview,
				timestamp: new Date().toISOString()
			};

			try {
				await env.BUCKET.put(path, body, {
					httpMetadata: { contentType }
				});

				writeOperationDetails.result = 'SUCCESS';
				writeOperationDetails.message = 'File written to R2';
				logWriteOperation('PUT', path, writeOperationDetails);

				const successInfo = writeLogInfo + '\n- Result: SUCCESS - File written to R2';
				const response = createResponse(null, { status: 201 }, request);
				// 记录成功的写入操作
				logHttpInteraction(request, response, successInfo);
				return response;
			} catch (error) {
				writeOperationDetails.result = 'FAILED';
				writeOperationDetails.error = String(error);
				logWriteOperation('PUT', path, writeOperationDetails);

				const errorInfo = writeLogInfo + `\n- Result: FAILED - ${error}`;
				console.error('PUT operation failed:', error);
				const response = createResponse('Internal Server Error', { status: 500 }, request);
				// 记录失败的写入操作
				logHttpInteraction(request, response, errorInfo);
				return response;
			}		case 'DELETE':
			// 删除 - 添加详细的删除日志
			const deleteInfo = [
				`DELETE Operation Details:`,
				`- Target path: ${path}`,
				`- Timestamp: ${new Date().toISOString()}`
			];

			const deleteOperationDetails: any = {
				operation: 'DELETE',
				path: path,
				timestamp: new Date().toISOString()
			};

			try {
				// 先检查文件是否存在
				const existingObj = await env.BUCKET.get(path);
				if (existingObj) {
					deleteInfo.push(`- File exists: YES (${existingObj.size} bytes)`);
					deleteInfo.push(`- Content-Type: ${existingObj.httpMetadata?.contentType || 'unknown'}`);
					deleteOperationDetails.fileExists = true;
					deleteOperationDetails.fileSize = existingObj.size;
					deleteOperationDetails.contentType = existingObj.httpMetadata?.contentType || 'unknown';
				} else {
					deleteInfo.push(`- File exists: NO`);
					deleteOperationDetails.fileExists = false;
				}

				await env.BUCKET.delete(path);

				deleteOperationDetails.result = 'SUCCESS';
				deleteOperationDetails.message = 'File deleted from R2';
				logWriteOperation('DELETE', path, deleteOperationDetails);

				const successInfo = deleteInfo.join('\n') + '\n- Result: SUCCESS - File deleted from R2';
				console.log('DELETE operation:', successInfo);
				const response = createResponse(null, { status: 204 }, request);
				// 记录成功的删除操作
				logHttpInteraction(request, response, successInfo);
				return response;
			} catch (error) {
				deleteOperationDetails.result = 'FAILED';
				deleteOperationDetails.error = String(error);
				logWriteOperation('DELETE', path, deleteOperationDetails);

				const errorInfo = deleteInfo.join('\n') + `\n- Result: FAILED - ${error}`;
				console.error('DELETE operation failed:', error);
				const response = createResponse('Internal Server Error', { status: 500 }, request);
				// 记录失败的删除操作
				logHttpInteraction(request, response, errorInfo);
				return response;
			}		case 'MKCOL':
			// 创建"目录"：上传一个空对象，比如 key="foo/bar/" - 添加详细日志
			if (!path.endsWith('/')) path += '/';

			const mkcolInfo = [
				`MKCOL Operation Details:`,
				`- Target path: ${path}`,
				`- Operation: Create directory`,
				`- Timestamp: ${new Date().toISOString()}`
			];

			const mkcolOperationDetails: any = {
				operation: 'MKCOL',
				path: path,
				timestamp: new Date().toISOString()
			};

			try {
				await env.BUCKET.put(path, '');

				mkcolOperationDetails.result = 'SUCCESS';
				mkcolOperationDetails.message = 'Directory created in R2';
				logWriteOperation('MKCOL', path, mkcolOperationDetails);

				const successInfo = mkcolInfo.join('\n') + '\n- Result: SUCCESS - Directory created in R2';
				console.log('MKCOL operation:', successInfo);
				const response = createResponse(null, { status: 201 }, request);
				// 记录成功的目录创建操作
				logHttpInteraction(request, response, successInfo);
				return response;
			} catch (error) {
				mkcolOperationDetails.result = 'FAILED';
				mkcolOperationDetails.error = String(error);
				logWriteOperation('MKCOL', path, mkcolOperationDetails);

				const errorInfo = mkcolInfo.join('\n') + `\n- Result: FAILED - ${error}`;
				console.error('MKCOL operation failed:', error);
				const response = createResponse('Internal Server Error', { status: 500 }, request);
				// 记录失败的目录创建操作
				logHttpInteraction(request, response, errorInfo);
				return response;
			}

		case 'PROPFIND':
			const depth = request.headers.get('Depth') || '1';
			const list = await env.BUCKET.list({ prefix: path, delimiter: '/' });
			const xml = await buildPropfindResponse(path, new URL(request.url), env, list);
			return createResponse(xml, {
				status: 207,
				headers: { 'Content-Type': 'application/xml; charset="utf-8"' }
			}, request);
		case 'MOVE':
		case 'COPY':
			// 从 Destination 头解析目标路径 - 添加详细日志
			const destination = request.headers.get('Destination');
			if (!destination) {
				const errorInfo = `${request.method} Operation Details:\n- Error: Missing Destination header`;
				const response = createResponse('Bad Request: Missing Destination header', { status: 400 }, request);
				logHttpInteraction(request, response, errorInfo);
				return response;
			}

			const dest = new URL(destination).pathname.replace(/^\//, '');

			const moveInfo = [
				`${request.method} Operation Details:`,
				`- Source path: ${path}`,
				`- Destination path: ${dest}`,
				`- Operation: ${request.method === 'MOVE' ? 'Move file' : 'Copy file'}`,
				`- Timestamp: ${new Date().toISOString()}`
			];

			const moveOperationDetails: any = {
				operation: request.method,
				sourcePath: path,
				destinationPath: dest,
				timestamp: new Date().toISOString()
			};

			try {
				// COPY: 先读后写；MOVE: 写完再删
				const sourceObj = await env.BUCKET.get(path);
				if (!sourceObj) {
					moveOperationDetails.result = 'FAILED';
					moveOperationDetails.error = 'Source file not found';
					logWriteOperation(request.method, path, moveOperationDetails);

					const notFoundInfo = moveInfo.join('\n') + '\n- Result: FAILED - Source file not found';
					const response = createResponse('Not Found', { status: 404 }, request);
					logHttpInteraction(request, response, notFoundInfo);
					return response;
				}

				moveInfo.push(`- Source file size: ${sourceObj.size} bytes`);
				moveInfo.push(`- Source content-type: ${sourceObj.httpMetadata?.contentType || 'unknown'}`);
				moveOperationDetails.sourceSize = sourceObj.size;
				moveOperationDetails.sourceContentType = sourceObj.httpMetadata?.contentType || 'unknown';

				await env.BUCKET.put(dest, sourceObj.body, { httpMetadata: sourceObj.httpMetadata });

				if (request.method === 'MOVE') {
					await env.BUCKET.delete(path);
					moveInfo.push('- Source file deleted after move');
					moveOperationDetails.sourceDeleted = true;
				}

				moveOperationDetails.result = 'SUCCESS';
				moveOperationDetails.message = 'File operation completed';
				logWriteOperation(request.method, path, moveOperationDetails);

				const successInfo = moveInfo.join('\n') + '\n- Result: SUCCESS - File operation completed';
				console.log(`${request.method} operation:`, successInfo);
				const response = createResponse(null, { status: 201 }, request);
				// 记录成功的移动/复制操作
				logHttpInteraction(request, response, successInfo);
				return response;
			} catch (error) {
				moveOperationDetails.result = 'FAILED';
				moveOperationDetails.error = String(error);
				logWriteOperation(request.method, path, moveOperationDetails);

				const errorInfo = moveInfo.join('\n') + `\n- Result: FAILED - ${error}`;
				console.error(`${request.method} operation failed:`, error);
				const response = createResponse('Internal Server Error', { status: 500 }, request);
				// 记录失败的移动/复制操作
				logHttpInteraction(request, response, errorInfo);
				return response;
			}

		default:
			return createResponse('Method Not Allowed', { status: 405 }, request);
	}
}
class WebDAVDelegateImpl implements WebDAVDelegate {
	// 这里可以实现WebDAVDelegate接口的方法
	// 例如：处理PROPFIND请求、处理锁定等
	env: Env;
	constructor(){
		this.env = {} as Env; // 初始化env为一个空对象，实际使用时会通过init方法设置
	}
	init(env: Env) {
		this.env = env;
	}
	async onPropfind(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// 去掉前缀 route，不同部署时可能要 trim
		let path = url.pathname.replace(/^\/?/, '');
		const userAgent = request.headers.get('user-agent') || '';
		const isMacOS = isMacOSWebDAVClient(userAgent);
		const depth = request.headers.get('Depth') || '1';
		const list = await this.env.BUCKET.list({ prefix: path, delimiter: '/' });
		const xml = await buildPropfindResponse(path, new URL(request.url), this.env, list);
		return createResponse(xml, {
			status: 207,
			headers: { 'Content-Type': 'application/xml; charset="utf-8"' }
		}, request);
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

		// 记录HTTP交互日志 - 但要避免重复记录
		// 因为PUT/DELETE等操作已经在内部记录了，这里只记录其他操作
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

async function buildPropfindResponse(
	path: string,
	url: URL,
	env: Env,
	list: R2Objects
): Promise<string> {
	const responses: string[] = [];
	// —— 先获取"自身"对象的元数据 ——
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
		// 如果根本不是文件（比如目录），就跳过或用默认值
	}
	// 如果取不到，就用一个默认"目录"元数据
	if (!selfMeta) {
		selfMeta = { size: 0, httpMetadata: { updated: new Date() } };
	}
	// 渲染自身
	responses.push(renderResponse(url.pathname, selfMeta));

	// —— 再渲染子文件 ——
	for (const obj of list.objects || []) {
		// 计算相对路径
		let relativePath = obj.key;
		if (path && obj.key.startsWith(path)) {
			relativePath = obj.key.slice(path.length);
		}
		// 如果是当前路径的文件（不是子目录中的文件）
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

	// —— 渲染子目录 ——
	for (const prefix of list.delimitedPrefixes || []) {
		let relativePath = prefix;
		if (path && prefix.startsWith(path)) {
			relativePath = prefix.slice(path.length);
		}
		const href = url.pathname + relativePath;
		// 目录也给个默认的"更新时间"
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


