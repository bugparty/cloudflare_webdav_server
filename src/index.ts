import { WebDAVDelegate, Env, ObjectMetadata} from './types';
import { logWriteOperation, logHttpInteraction, handleDebugRoutes } from './logger';
import {
	isMacOSWebDAVClient,
	authenticateRequest,
	unauthorizedResponse,
	createResponse,
	handleMacOSOptionsRequest
} from './macos';
import { WebDAVDelegateImpl } from './webdav-delegate';
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
	const optionsResponse = handleMacOSOptionsRequest(request);
	if (optionsResponse) {
		return optionsResponse;
	}

	// 验证身份 - 现在严格要求认证
	if (!authenticateRequest(request, env)) {
		return unauthorizedResponse(request);
	}

	const url = new URL(request.url);
	// 去掉前缀 route，不同部署时可能要 trim
	let path = url.pathname.replace(/^\/?/, '');

	switch (request.method) {
		case 'OPTIONS':
			return createResponse(null, {
				status: 200,
				headers: {
					'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY',
					'DAV': '1,2'
				}
			}, request);
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
			return await davDelegate.onPropfind(request);
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

