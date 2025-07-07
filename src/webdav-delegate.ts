import { WebDAVDelegate, Env, ObjectMetadata } from './types';
import { createResponse, addMacOSCompatibilityHeaders } from './macos';
import { logWriteOperation, logHttpInteraction, handleDebugRoutes } from './logger';
export class WebDAVDelegateImpl implements WebDAVDelegate {
	// 这里可以实现WebDAVDelegate接口的方法
	// 例如：处理PROPFIND请求、处理锁定等
	env: Env;
	constructor() {
		this.env = {} as Env; // 初始化env为一个空对象，实际使用时会通过init方法设置
	}
	init(env: Env) {
		this.env = env;
	}
	async onGet(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// 去掉前缀 route，不同部署时可能要 trim
		let path = url.pathname.replace(/^\/?/, '');
		// GET/HEAD 下载或获取元信息
		const obj = await this.env.BUCKET.get(path);
		if (!obj) return createResponse('Not Found', { status: 404 }, request);
		return createResponse(
			request.method === 'HEAD' ? null : obj.body,
			{
				status: 200,
				headers: {
					'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
					'Content-Length': obj.size.toString(),
					'Last-Modified': obj.uploaded.toUTCString(),
				},
			},
			request,
		);
	}
	async onPut(request: Request): Promise<Response> {
		// 上传／覆盖 - 添加详细的写入日志
		const body = await request.arrayBuffer();
		const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
		const contentLength = body.byteLength;
		const url = new URL(request.url);
		// 去掉前缀 route，不同部署时可能要 trim
		let path = url.pathname.replace(/^\/?/, '');

		// 准备写入日志信息
		const writeInfo = [
			`PUT Operation Details:`,
			`- Target path: ${path}`,
			`- Content-Type:${contentType}`,
			`- Content-Length: ${contentLength} bytes`,
			`- Body size:${contentLength} bytes`,
			`- Timestamp: ${new Date().toISOString()}`,
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
			writeInfo.push(`- Content: [Large file,${contentLength} bytes]`);
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
			timestamp: new Date().toISOString(),
		};

		try {
			await this.env.BUCKET.put(path, body, {
				httpMetadata: { contentType },
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
		}
	}
	async onDelete(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// 去掉前缀 route，不同部署时可能要 trim
		let path = url.pathname.replace(/^\/?/, '');
		// 删除 - 添加详细的删除日志
		const deleteInfo = [`DELETE Operation Details:`, `- Target path:${path}`, `- Timestamp:${new Date().toISOString()}`];

		const deleteOperationDetails: any = {
			operation: 'DELETE',
			path: path,
			timestamp: new Date().toISOString(),
		};

		try {
			// 先检查文件是否存在
			const existingObj = await this.env.BUCKET.get(path);
			if (existingObj) {
				deleteInfo.push(`- File exists: YES (${existingObj.size} bytes)`);
				deleteInfo.push(`- Content-Type:${existingObj.httpMetadata?.contentType || 'unknown'}`);
				deleteOperationDetails.fileExists = true;
				deleteOperationDetails.fileSize = existingObj.size;
				deleteOperationDetails.contentType = existingObj.httpMetadata?.contentType || 'unknown';
			} else {
				deleteInfo.push(`- File exists: NO`);
				deleteOperationDetails.fileExists = false;
			}

			await this.env.BUCKET.delete(path);

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

			const errorInfo = deleteInfo.join('\n') + `\n- Result: FAILED -${error}`;
			console.error('DELETE operation failed:', error);
			const response = createResponse('Internal Server Error', { status: 500 }, request);
			// 记录失败的删除操作
			logHttpInteraction(request, response, errorInfo);
			return response;
		}
	}
	async onMkcol(request: Request): Promise<Response> {
		const url = new URL(request.url);
		// 去掉前缀 route，不同部署时可能要 trim
		let path = url.pathname.replace(/^\/?/, '');
		// 创建"目录"：上传一个空对象，比如 key="foo/bar/" - 添加详细日志
		if (!path.endsWith('/')) path += '/';

		const mkcolInfo = [
			`MKCOL Operation Details:`,
			`- Target path:${path}`,
			`- Operation: Create directory`,
			`- Timestamp:${new Date().toISOString()}`,
		];

		const mkcolOperationDetails: any = {
			operation: 'MKCOL',
			path: path,
			timestamp: new Date().toISOString(),
		};

		try {
			await this.env.BUCKET.put(path, '');

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

			const errorInfo = mkcolInfo.join('\n') + `\n- Result: FAILED -${error}`;
			console.error('MKCOL operation failed:', error);
			const response = createResponse('Internal Server Error', { status: 500 }, request);
			// 记录失败的目录创建操作
			logHttpInteraction(request, response, errorInfo);
			return response;
		}
	}
	async onLock(request: Request): Promise<Response> {
		const lockToken = Math.random().toString(36).slice(2);
		const xml =
			`<?xml version="1.0" encoding="utf-8"?>\n` +
			`<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>` +
			`<D:locktype><D:write/></D:locktype>` +
			`<D:lockscope><D:exclusive/></D:lockscope>` +
			`<D:depth>0</D:depth>` +
			`<D:owner><D:href>${new URL(request.url).pathname}</D:href></D:owner>` +
			`<D:timeout>Second-600</D:timeout>` +
			`<D:locktoken><D:href>${lockToken}</D:href></D:locktoken>` +
			`<D:lockroot><D:href>${new URL(request.url).pathname}</D:href></D:lockroot>` +
			`</D:activelock></D:lockdiscovery></D:prop>`;

		const response = new Response(xml, {
			status: 200,
			headers: {
				'Content-Type': 'application/xml; charset="utf-8"',
				'Lock-Token': `<${lockToken}>`,
			},
		});
		addMacOSCompatibilityHeaders(response.headers);
		return response;
	}
	async onUnlock(request: Request): Promise<Response> {
		return new Response(null, { status: 204 });
	}
        async onPropfind(request: Request): Promise<Response> {
                const url = new URL(request.url);
                // 去掉前缀 route，不同部署时可能要 trim
                let path = url.pathname.replace(/^\/?/, '');
                const depth = request.headers.get('Depth') || '1';
                const list = await this.env.BUCKET.list({ prefix: path, delimiter: '/' });
                const selfObj = await this.env.BUCKET.get(path);

                // 当目标对象和其前缀列表都不存在时，返回404
                const exists = selfObj || (list.objects && list.objects.length > 0) ||
                        (list.delimitedPrefixes && list.delimitedPrefixes.length > 0);
                if (!exists) {
                        return createResponse('Not Found', { status: 404 }, request);
                }

                const xml = await buildPropfindResponse(path, new URL(request.url), this.env, list);

                return createResponse(
                        xml,
                        {
                                status: 207,
                                headers: { 'Content-Type': 'application/xml; charset="utf-8"' },
                        },
                        request,
                );
        }
	async onOptions(request: Request): Promise<Response> {
		const response = new Response(null, {
			status: 200,
			headers: {
				Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY, LOCK, UNLOCK',
				DAV: '1, 2',
			},
		});
		addMacOSCompatibilityHeaders(response.headers);
		return response;
	}
}

async function buildPropfindResponse(path: string, url: URL, env: Env, list: R2Objects): Promise<string> {
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
					contentType: selfObj.httpMetadata?.contentType,
				},
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
					contentType: obj.httpMetadata?.contentType,
				},
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
