#!/usr/bin/env node
import { randomUUID } from 'node:crypto';

const remoteUrl = process.env.WEBDAV_REMOTE_URL;
const username = process.env.WEBDAV_REMOTE_USER || process.env.WEBDAV_USERNAME;
const password = process.env.WEBDAV_REMOTE_PASS || process.env.WEBDAV_PASSWORD;
const keepRemoteFiles = process.env.WEBDAV_REMOTE_KEEP === '1';
const testPrefix = process.env.WEBDAV_REMOTE_PREFIX || '_folder-move-e2e';

if (!remoteUrl || !username || !password) {
	console.error(`Missing remote test configuration.

Required:
  WEBDAV_REMOTE_URL=https://your-worker.example.com/
  WEBDAV_REMOTE_USER=...
  WEBDAV_REMOTE_PASS=...

Optional:
  WEBDAV_REMOTE_PREFIX=_folder-move-e2e
  WEBDAV_REMOTE_KEEP=1
`);
	process.exit(2);
}

const userAgent = 'WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)';
const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const rootPath = `/${testPrefix}-${runId}`;
const cleanupPaths = new Set();

const propfindBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
<D:prop>
<D:getlastmodified/>
<D:getcontentlength/>
<D:creationdate/>
<D:resourcetype/>
</D:prop>
</D:propfind>`;

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
		'Authorization': authHeader,
		...options.headers
	};

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

async function mkcol(path) {
	await dav('MKCOL', path, { expected: 201 });
	trackDir(path);
}

async function putFile(path, body, contentType = 'text/plain') {
	const payload = Buffer.from(body);
	await dav('PUT', path, {
		expected: 201,
		headers: {
			'Content-Type': contentType,
			'Content-Length': String(payload.byteLength)
		},
		body: payload
	});
	trackFile(path);
}

async function moveCollection(fromPath, toPath) {
	await dav('MOVE', fromPath, {
		expected: [201, 204],
		headers: {
			'Destination': remotePath(toPath).href,
			'Depth': 'infinity',
			'Overwrite': 'F'
		}
	});
	trackDir(toPath);
}

async function assertFile(path, expectedBody) {
	const response = await dav('GET', path, { expected: 200 });
	const actual = await response.text();
	if (actual !== expectedBody) {
		throw new Error(`GET ${path}: expected body ${JSON.stringify(expectedBody)}, got ${JSON.stringify(actual)}`);
	}
}

function trackFile(path) {
	cleanupPaths.add(path);
}

function trackDir(path) {
	cleanupPaths.add(path.endsWith('/') ? path : `${path}/`);
}

function cleanupOrder(paths) {
	return [...paths].sort((a, b) => {
		const depthDiff = b.split('/').length - a.split('/').length;
		if (depthDiff !== 0) return depthDiff;
		if (a.endsWith('/') && !b.endsWith('/')) return 1;
		if (!a.endsWith('/') && b.endsWith('/')) return -1;
		return b.length - a.length;
	});
}

async function cleanup() {
	if (keepRemoteFiles) {
		console.log(`keeping remote test files under ${rootPath}`);
		return;
	}

	for (const path of cleanupOrder(cleanupPaths)) {
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
	console.log(`running remote folder MOVE e2e against ${remoteUrl}`);
	console.log(`test root: ${rootPath}`);

	await mkcol(rootPath);

	const sourcePath = `${rootPath}/source`;
	const nestedPath = `${sourcePath}/nested`;
	const rootFile = `${sourcePath}/root-file.txt`;
	const nestedFile = `${nestedPath}/child.txt`;

	await mkcol(sourcePath);
	await mkcol(nestedPath);
	await putFile(rootFile, 'root file before move');
	await putFile(nestedFile, 'nested child before move');

	await propfind(`${sourcePath}/`, 1);
	await assertFile(rootFile, 'root file before move');
	await assertFile(nestedFile, 'nested child before move');

	const renamedPath = `${rootPath}/renamed-source`;
	const renamedRootFile = `${renamedPath}/root-file.txt`;
	const renamedNestedPath = `${renamedPath}/nested`;
	const renamedNestedFile = `${renamedNestedPath}/child.txt`;

	await moveCollection(sourcePath, renamedPath);
	trackFile(renamedRootFile);
	trackDir(renamedNestedPath);
	trackFile(renamedNestedFile);

	await propfind(sourcePath, 0, 404);
	await propfind(`${renamedPath}/`, 1);
	await assertFile(renamedRootFile, 'root file before move');
	await assertFile(renamedNestedFile, 'nested child before move');

	const destinationParent = `${rootPath}/destination-parent`;
	const movedInsidePath = `${destinationParent}/moved-inside`;
	const movedInsideRootFile = `${movedInsidePath}/root-file.txt`;
	const movedInsideNestedPath = `${movedInsidePath}/nested`;
	const movedInsideNestedFile = `${movedInsideNestedPath}/child.txt`;

	await mkcol(destinationParent);
	await moveCollection(renamedPath, movedInsidePath);
	trackFile(movedInsideRootFile);
	trackDir(movedInsideNestedPath);
	trackFile(movedInsideNestedFile);

	await propfind(renamedPath, 0, 404);
	await propfind(`${destinationParent}/`, 1);
	await propfind(`${movedInsidePath}/`, 1);
	await assertFile(movedInsideRootFile, 'root file before move');
	await assertFile(movedInsideNestedFile, 'nested child before move');

	console.log('remote folder MOVE e2e completed successfully');
}

try {
	await run();
} finally {
	await cleanup();
}
