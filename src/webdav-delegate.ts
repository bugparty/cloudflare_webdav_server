import { WebDAVDelegate, Env, ObjectMetadata } from './types';
import { createResponse } from './macos';

export class WebDAVDelegateImpl implements WebDAVDelegate {
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
		const depth = request.headers.get('Depth') || '1';
		const list = await this.env.BUCKET.list({ prefix: path, delimiter: '/' });
		const xml = await buildPropfindResponse(path, new URL(request.url), this.env, list);
		return createResponse(xml, {
			status: 207,
			headers: { 'Content-Type': 'application/xml; charset="utf-8"' }
		}, request);
	}
}

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
