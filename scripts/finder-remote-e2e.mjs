#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const remoteUrl = process.env.WEBDAV_REMOTE_URL;
const username = process.env.WEBDAV_REMOTE_USER || process.env.WEBDAV_USERNAME;
const password = process.env.WEBDAV_REMOTE_PASS || process.env.WEBDAV_PASSWORD;
const keepRemoteFiles = process.env.WEBDAV_REMOTE_KEEP === '1';
const requireAuth = process.env.WEBDAV_REMOTE_REQUIRE_AUTH !== '0';
const testPrefix = process.env.WEBDAV_REMOTE_PREFIX || '_finder-e2e';

if (!remoteUrl || !username || !password) {
	console.error(`Missing remote test configuration.

Required:
  WEBDAV_REMOTE_URL=https://your-worker.example.com/
  WEBDAV_REMOTE_USER=...
  WEBDAV_REMOTE_PASS=...

Optional:
  WEBDAV_REMOTE_PREFIX=_finder-e2e
  WEBDAV_REMOTE_KEEP=1
  WEBDAV_REMOTE_REQUIRE_AUTH=0
`);
	process.exit(2);
}

const userAgent = 'WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)';
const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const rootPath = `/${testPrefix}-${runId}`;
const createdPaths = [];
let activeLocks = [];

const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
<D:prop>
<D:getlastmodified/>
<D:getcontentlength/>
<D:creationdate/>
<D:resourcetype/>
</D:prop>
</D:propfind>`;

const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:">
<D:lockscope><D:exclusive/></D:lockscope>
<D:locktype><D:write/></D:locktype>
<D:owner>
<D:href>http://www.apple.com/webdav_fs/</D:href>
</D:owner>
</D:lockinfo>`;

function remotePath(path) {
	const url = new URL(remoteUrl);
	const basePath = url.pathname.replace(/\/+$/, '');
	const requestPath = path.startsWith('/') ? path : `/${path}`;
	url.pathname = `${basePath}${requestPath}`.replace(/\/{2,}/g, '/');
	return url;
}

function statusList(expected) {
	return Array.isArray(expected) ? expected : [expected];
}

async function dav(method, path, options = {}) {
	const expected = statusList(options.expected ?? 200);
	const headers = {
		'Accept': '*/*',
		'User-Agent': userAgent,
		...options.headers
	};

	if (options.auth !== false) {
		headers.Authorization = authHeader;
	}

	const response = await fetch(remotePath(path), {
		method,
		headers,
		body: options.body
	});

	if (!expected.includes(response.status)) {
		const body = await response.text().catch(() => '');
		throw new Error(`${options.label || `${method} ${path}`} expected ${expected.join(' or ')}, got ${response.status}\n${body.slice(0, 1200)}`);
	}

	console.log(`ok ${method} ${path} -> ${response.status}`);
	return response;
}

function assertHeaderContains(response, name, value, label) {
	const actual = response.headers.get(name);
	if (!actual || !actual.includes(value)) {
		throw new Error(`${label}: expected ${name} to contain ${value}, got ${actual}`);
	}
}

function assertHeaderPresent(response, name, label) {
	const actual = response.headers.get(name);
	if (!actual) {
		throw new Error(`${label}: expected ${name} header`);
	}
	return actual;
}

async function propfind(path, depth, expected = 207) {
	return dav('PROPFIND', path, {
		expected,
		headers: {
			'Content-Type': 'text/xml',
			'Depth': String(depth)
		},
		body: propfindBody
	});
}

async function lock(path) {
	const response = await dav('LOCK', path, {
		expected: [200, 201],
		headers: {
			'Content-Type': 'text/xml; charset="utf-8"',
			'Depth': '0',
			'Timeout': 'Second-600'
		},
		body: lockBody
	});
	const token = assertHeaderPresent(response, 'Lock-Token', `LOCK ${path}`);
	activeLocks.push({ path, token });
	return token;
}

async function unlock(path, token) {
	await dav('UNLOCK', path, {
		expected: 204,
		headers: {
			'Lock-Token': token
		}
	});
	activeLocks = activeLocks.filter(lockInfo => lockInfo.path !== path || lockInfo.token !== token);
}

async function cleanup() {
	for (const { path, token } of [...activeLocks].reverse()) {
		try {
			await dav('UNLOCK', path, {
				expected: [204, 400, 403, 404],
				headers: { 'Lock-Token': token },
				label: `cleanup UNLOCK ${path}`
			});
		} catch (error) {
			console.warn(`warn cleanup unlock failed for ${path}: ${error.message}`);
		}
	}
	activeLocks = [];

	if (keepRemoteFiles) {
		console.log(`keeping remote test files under ${rootPath}`);
		return;
	}

	for (const path of [...createdPaths].reverse()) {
		try {
			await dav('DELETE', path, {
				expected: [204, 404],
				label: `cleanup DELETE ${path}`
			});
		} catch (error) {
			console.warn(`warn cleanup delete failed for ${path}: ${error.message}`);
		}
	}
}

async function run() {
	console.log(`running Finder remote e2e against ${remoteUrl}`);
	console.log(`test root: ${rootPath}`);

	const optionsResponse = await dav('OPTIONS', '/', { expected: 200, auth: false });
	assertHeaderPresent(optionsResponse, 'DAV', 'OPTIONS /');
	assertHeaderContains(optionsResponse, 'Allow', 'PROPFIND', 'OPTIONS /');
	assertHeaderContains(optionsResponse, 'Allow', 'LOCK', 'OPTIONS /');
	assertHeaderContains(optionsResponse, 'Allow', 'UNLOCK', 'OPTIONS /');

	if (requireAuth) {
		await dav('PROPFIND', '/', {
			expected: 401,
			auth: false,
			headers: {
				'Content-Type': 'text/xml',
				'Depth': '0'
			},
			body: propfindBody
		});
	}

	await dav('MKCOL', rootPath, { expected: 201 });
	createdPaths.push(`${rootPath}/`);

	await propfind(rootPath, 0);
	await propfind(`${rootPath}/`, 1);

	await propfind(`${rootPath}/.DS_Store`, 0, 404);

	const dsStorePath = `${rootPath}/.DS_Store`;
	const dsStorePut = await dav('PUT', dsStorePath, {
		expected: 201,
		body: ''
	});
	assertHeaderPresent(dsStorePut, 'ETag', `PUT ${dsStorePath}`);
	createdPaths.push(dsStorePath);

	const dsStoreToken = await lock(dsStorePath);
	await unlock(dsStorePath, dsStoreToken);

	await propfind(`${rootPath}/._Document.docx`, 0, 404);
	await propfind(`${rootPath}/._.DS_Store`, 0, 404);

	const sidecarPath = `${rootPath}/._.DS_Store`;
	await dav('PUT', sidecarPath, {
		expected: 201,
		body: ''
	});
	createdPaths.push(sidecarPath);

	const sidecarToken = await lock(sidecarPath);
	await unlock(sidecarPath, sidecarToken);

	const documentPath = `${rootPath}/Document.docx`;
	const documentBody = Buffer.from('fake-docx-body-for-finder-e2e');
	await dav('PUT', documentPath, {
		expected: 201,
		headers: {
			'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'Content-Length': String(documentBody.byteLength)
		},
		body: documentBody
	});
	createdPaths.push(documentPath);

	const documentResponse = await dav('GET', documentPath, { expected: 200 });
	assertHeaderContains(
		documentResponse,
		'Content-Type',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		`GET ${documentPath}`
	);
	const downloaded = Buffer.from(await documentResponse.arrayBuffer());
	if (!downloaded.equals(documentBody)) {
		throw new Error(`GET ${documentPath}: downloaded body did not match uploaded body`);
	}

	const attachmentsPath = `${rootPath}/Attachments`;
	await dav('MKCOL', attachmentsPath, { expected: 201 });
	createdPaths.push(`${attachmentsPath}/`);

	await propfind(`${attachmentsPath}/`, 1);
	await propfind(`${attachmentsPath}/`, 0);

	console.log('Finder remote e2e completed successfully');
}

try {
	await run();
} finally {
	await cleanup();
}
