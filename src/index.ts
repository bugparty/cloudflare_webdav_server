import { WebDAVDelegate, Env, ObjectMetadata } from './types';
import { logWriteOperation, logHttpInteraction, handleDebugRoutes, initLogger } from './logger';
import { isMacOSWebDAVClient, authenticateRequest, unauthorizedResponse, createResponse, handleMacOSOptionsRequest } from './macos';
import { WebDAVDelegateImpl } from './webdav-delegate';
import { LogStorage } from './log-storage';

// 主要的请求处理函数
async function handleWebDAVRequest(request: Request, env: Env): Promise<Response> {
	// Initialize logger with environment for Durable Object access
	initLogger(env);

	const userAgent = request.headers.get('user-agent') || '';
	const isMacOS = isMacOSWebDAVClient(userAgent);
	let davDelegate = new WebDAVDelegateImpl();
	davDelegate.init(env);

	// 处理调试路由
	const debugResponse = await handleDebugRoutes(request);
	if (debugResponse) {
		return debugResponse;
	}
	// macOS兼容性：对于OPTIONS请求，先处理再进行认证
	if (isMacOS && request.method === 'OPTIONS') {
		const optionsResponse = handleMacOSOptionsRequest(request, davDelegate);
		if (optionsResponse) {
			return optionsResponse;
		}
	}

	// 验证身份 - 现在严格要求认证
	if (!authenticateRequest(request, env)) {
		return unauthorizedResponse(request);
	}

	const url = new URL(request.url);
	// 去掉前缀 route，不同部署时可能要 trim
	let path = url.pathname.replace(/^\/?/, '');

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
		case 'COPY':
			// 从 Destination 头解析目标路径 - 添加详细日志
			const destination = request.headers.get('Destination');
			if (!destination) {
				const errorInfo = `${request.method} Operation Details:\n- Error: Missing Destination header`;
				const response = createResponse('Bad Request: Missing Destination header', { status: 400 }, request);
                                await logHttpInteraction(request, response, errorInfo);
				return response;
			}

			const dest = new URL(destination).pathname.replace(/^\//, '');

			const moveInfo = [
				`${request.method} Operation Details:`,
				`- Source path: ${path}`,
				`- Destination path: ${dest}`,
				`- Operation: ${request.method === 'MOVE' ? 'Move file' : 'Copy file'}`,
				`- Timestamp: ${new Date().toISOString()}`,
			];

			const moveOperationDetails: any = {
				operation: request.method,
				sourcePath: path,
				destinationPath: dest,
				timestamp: new Date().toISOString(),
			};

			try {
				// COPY: 先读后写；MOVE: 写完再删
				const sourceObj = await env.BUCKET.get(path);
				if (!sourceObj) {
					moveOperationDetails.result = 'FAILED';
					moveOperationDetails.error = 'Source file not found';
					await logWriteOperation(request.method, path, moveOperationDetails);

					const notFoundInfo = moveInfo.join('\n') + '\n- Result: FAILED - Source file not found';
					const response = createResponse('Not Found', { status: 404 }, request);
                                        await logHttpInteraction(request, response, notFoundInfo);
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
				await logWriteOperation(request.method, path, moveOperationDetails);

				const successInfo = moveInfo.join('\n') + '\n- Result: SUCCESS - File operation completed';
				console.log(`${request.method} operation:`, successInfo);
				const response = createResponse(null, { status: 201 }, request);
				// 记录成功的移动/复制操作
                                await logHttpInteraction(request, response, successInfo);
				return response;
			} catch (error) {
				moveOperationDetails.result = 'FAILED';
				moveOperationDetails.error = String(error);
				await logWriteOperation(request.method, path, moveOperationDetails);

				const errorInfo = moveInfo.join('\n') + `\n- Result: FAILED - ${error}`;
				console.error(`${request.method} operation failed:`, error);
				const response = createResponse('Internal Server Error', { status: 500 }, request);
				// 记录失败的移动/复制操作
                                await logHttpInteraction(request, response, errorInfo);
				return response;
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

		// 记录HTTP交互日志 - 但要避免重复记录
		// 因为PUT/DELETE等操作已经在内部记录了，这里只记录其他操作
		const method = request.method;
		const url = new URL(request.url);
		const isDebugRoute = url.pathname === '/_debug/http-log';
		const isModifyOperation = ['PUT', 'DELETE', 'MKCOL', 'MOVE', 'COPY'].includes(method);

		if (!isDebugRoute && !isModifyOperation) {
                        await logHttpInteraction(request, response, additionalInfo);
		}

		return response;
	},
} as ExportedHandler<Env>;

// Export the Durable Object class
export { LogStorage };
