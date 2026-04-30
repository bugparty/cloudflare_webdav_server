// HTTP debug log
import { formatHeaderName, headersToLogObject } from './log-sanitize';

let httpLogBuffer: string[] = [];
let writeOperationLog: string[] = [];
export const MAX_LOG_ENTRIES = 100;
export const MAX_WRITE_LOG_ENTRIES = 50;

// Get log status
export function getLogStatus() {
	return {
		httpLogEntries: httpLogBuffer.length,
		writeOperationLogEntries: writeOperationLog.length,
		maxHttpLogEntries: MAX_LOG_ENTRIES,
		maxWriteLogEntries: MAX_WRITE_LOG_ENTRIES
	};
}

// Record detailed logs for write operations
export function logWriteOperation(operation: string, path: string, details: any): void {
	const timestamp = new Date().toISOString();
	const logEntry = `=== ${timestamp} - ${operation} ===\n` +
		`Path: ${path}\n` +
		`Details: ${JSON.stringify(details, null, 2)}\n` +
		'---\n\n';

	writeOperationLog.push(logEntry);

	// Keep the buffer size under control
	if (writeOperationLog.length > MAX_WRITE_LOG_ENTRIES) {
		writeOperationLog = writeOperationLog.slice(-MAX_WRITE_LOG_ENTRIES);
	}

	console.log(`Write operation logged: ${operation} on ${path}`);
}

// Get the write operation log
export function getWriteOperationLog(): string {
	return writeOperationLog.join('');
}

// Clear the write operation log
export function clearWriteOperationLog(): void {
	writeOperationLog = [];
}

// Format HTTP request logs
function formatHttpRequest(request: Request, bodyInfo?: string): string {
	const url = new URL(request.url);
	const lines: string[] = [];

	// Request line
	lines.push(`${request.method} ${url.pathname}${url.search} HTTP/1.1`);

	// Headers
	lines.push(`Host: ${url.host}`);
	const headers = headersToLogObject(request.headers);
	Object.entries(headers).forEach(([name, value]) => {
		if (name.toLowerCase() !== 'host') {
			lines.push(`${formatHeaderName(name)}: ${value}`);
		}
	});

	// Append body information when present
	if (bodyInfo) {
		lines.push('');
		lines.push(bodyInfo);
	}

	return lines.join('\n') + '\n\n';
}

// Format HTTP response logs
function formatHttpResponse(response: Response): string {
	const lines: string[] = [];

	// Status line
	lines.push(`HTTP/1.1 ${response.status} ${response.statusText}`);

	// Headers
	const headers = headersToLogObject(response.headers);
	Object.entries(headers).forEach(([name, value]) => {
		lines.push(`${formatHeaderName(name)}: ${value}`);
	});

	return lines.join('\n') + '\n\n';
}

// Record HTTP interactions in the buffer
export function logHttpInteraction(request: Request, response: Response, additionalInfo?: string): void {
	const timestamp = new Date().toISOString();
	const url = new URL(request.url);
	const logEntry = `=== ${timestamp} ===\n` +
		formatHttpRequest(request, additionalInfo) +
		formatHttpResponse(response) +
		'---\n\n';

	httpLogBuffer.push(logEntry);

	// Keep the buffer size under control
	if (httpLogBuffer.length > MAX_LOG_ENTRIES) {
		httpLogBuffer = httpLogBuffer.slice(-MAX_LOG_ENTRIES);
	}

	// Print to the console for live debugging
	console.log(`HTTP ${request.method} ${url.pathname} → ${response.status}`);
	if (additionalInfo) {
		console.log('Additional info:', additionalInfo);
	}
}

// Get the full HTTP log
export function getHttpLog(): string {
	return httpLogBuffer.join('');
}

// Clear the HTTP log
export function clearHttpLog(): void {
	httpLogBuffer = [];
}

function parseLimit(url: URL, defaultLimit = 100): number {
	const parsed = Number.parseInt(url.searchParams.get('limit') || `${defaultLimit}`, 10);
	if (Number.isNaN(parsed)) {
		return defaultLimit;
	}

	return Math.min(Math.max(parsed, 1), 1000);
}

async function getD1LogText(env: any, limit: number): Promise<string> {
	if (!env?.DB) {
		return 'D1 database not configured';
	}

	const { getRecentLogs, formatLogEntry } = await import('./log-persistence');
	const logs = await getRecentLogs(env.DB, limit);
	return logs.map(formatLogEntry).join('') || 'No logs found';
}

async function clearD1Logs(env: any): Promise<string> {
	if (!env?.DB) {
		return 'D1 database not configured';
	}

	const { clearAllLogs } = await import('./log-persistence');
	const count = await clearAllLogs(env.DB);
	return `Cleared ${count} D1 log entries`;
}

function getLogDurableObject(env: any): DurableObjectStub | null {
	if (!env?.LOG_DO) {
		return null;
	}

	const id = env.LOG_DO.idFromName('global');
	return env.LOG_DO.get(id);
}

async function fetchLogDurableObject(env: any, pathOrRequest: string | Request, init?: RequestInit): Promise<Response> {
	const stub = getLogDurableObject(env);
	if (!stub) {
		return new Response('Log Durable Object not configured', { status: 500 });
	}

	if (typeof pathOrRequest === 'string') {
		return stub.fetch(`http://log-do${pathOrRequest}`, init);
	}

	return stub.fetch(pathOrRequest);
}

async function clearAllLogStores(env: any): Promise<string[]> {
	const messages = ['Cleared memory HTTP and write logs'];

	clearHttpLog();
	clearWriteOperationLog();

	if (env?.DB) {
		try {
			messages.push(await clearD1Logs(env));
		} catch (e) {
			messages.push(`Error clearing D1 logs: ${e}`);
		}
	}

	if (env?.LOG_DO) {
		try {
			const response = await fetchLogDurableObject(env, '/clear', { method: 'DELETE' });
			messages.push(await response.text());
		} catch (e) {
			messages.push(`Error clearing Durable Object logs: ${e}`);
		}
	}

	return messages;
}

function getLiveLogPage(): string {
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>WebDAV Live Logs</title>
	<style>
		body { margin: 0; font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #101418; color: #e6edf3; }
		header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; background: #182028; border-bottom: 1px solid #303943; }
		button { border: 1px solid #56616d; background: #25313c; color: #e6edf3; border-radius: 4px; padding: 6px 10px; cursor: pointer; }
		button:hover { background: #30404e; }
		#status { color: #9fb0c0; }
		#logs { white-space: pre-wrap; padding: 16px; margin: 0; }
	</style>
</head>
<body>
	<header>
		<span id="status">connecting</span>
		<button type="button" id="clear">Clear</button>
	</header>
	<pre id="logs"></pre>
	<script>
		const logs = document.getElementById('logs');
		const status = document.getElementById('status');
		const wsUrl = new URL(location.href);
		wsUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(wsUrl);

		socket.addEventListener('open', () => {
			status.textContent = 'connected';
		});

		socket.addEventListener('message', event => {
			logs.textContent += event.data + '\\n';
			scrollTo(0, document.body.scrollHeight);
		});

		socket.addEventListener('close', () => {
			status.textContent = 'closed';
		});

		socket.addEventListener('error', () => {
			status.textContent = 'error';
		});

		document.getElementById('clear').addEventListener('click', () => {
			socket.send('clear');
			logs.textContent = '';
		});
	</script>
</body>
</html>`;
}

// Handle debug routes
export async function handleDebugRoutes(request: Request, env?: any): Promise<Response | null> {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const method = request.method;

	// Debug panel with links to all debug features
	if (method === 'GET' && pathname === '/_debug') {
		const logStatus = getLogStatus();
		const debugPanel = `
WebDAV Debug Panel
==================

Current Time: ${new Date().toISOString()}

Available Debug Endpoints:
==========================

View Logs:
- D1 Request Logs (Persistent): /_debug/d1-logs?limit=100
- Durable Object Logs: /_debug/do-logs?limit=100
- Live Durable Object Log WebSocket: /_debug/live-log
- HTTP Logs (Current Isolate Memory): /_debug/http-log
- Write Operation Logs: /_debug/write-log
- All Logs: /_debug/all-logs
- D1 Log Stats: /_debug/d1-stats
- Durable Object Stats: /_debug/do-stats

Clear Logs (via GET - click in browser):
- Clear HTTP Logs: /_debug/clear-http-log
- Clear Write Logs: /_debug/clear-write-log
- Clear All Logs: /_debug/clear-all-logs
- Clear D1 Logs: /_debug/clear-d1-logs
- Clear Durable Object Logs: /_debug/clear-do-logs

Clear Logs (via DELETE - use with curl):
- DELETE /_debug/http-log
- DELETE /_debug/write-log
- DELETE /_debug/all-logs
- DELETE /_debug/d1-logs
- DELETE /_debug/do-logs

Usage Examples:
===============

1. View logs in browser:
   https://s32webdav.0xff.workers.dev/_debug/d1-logs
   https://s32webdav.0xff.workers.dev/_debug/do-logs

2. Clear logs in browser:
   https://s32webdav.0xff.workers.dev/_debug/clear-all-logs

3. Clear logs with curl:
   curl -X DELETE -u bowman:password https://s32webdav.0xff.workers.dev/_debug/d1-logs

Log Status:
===========
- HTTP Log Entries (Memory): ${logStatus.httpLogEntries}
- Write Operation Log Entries: ${logStatus.writeOperationLogEntries}
- Max HTTP Log Entries: ${logStatus.maxHttpLogEntries}
- Max Write Log Entries: ${logStatus.maxWriteLogEntries}
		`;

		return new Response(debugPanel, {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	// D1 persistent logs
	if (pathname === '/_debug/d1-logs') {
		if (method === 'GET') {
			if (!env?.DB) {
				return new Response('D1 database not configured', { status: 500 });
			}

			try {
				const formatted = await getD1LogText(env, parseLimit(url));
				return new Response(formatted, {
					headers: { 'Content-Type': 'text/plain' }
				});
			} catch (e) {
				return new Response(`Error loading D1 logs: ${e}`, { status: 500 });
			}
		} else if (method === 'DELETE') {
			if (!env?.DB) {
				return new Response('D1 database not configured', { status: 500 });
			}

			try {
				return new Response(await clearD1Logs(env), {
					headers: { 'Content-Type': 'text/plain' }
				});
			} catch (e) {
				return new Response(`Error clearing D1 logs: ${e}`, { status: 500 });
			}
		}
	}

	// Durable Object logs
	if (pathname === '/_debug/do-logs') {
		if (method === 'GET') {
			const limit = parseLimit(url);
			return fetchLogDurableObject(env, `/recent?limit=${limit}`);
		} else if (method === 'DELETE') {
			return fetchLogDurableObject(env, '/clear', { method: 'DELETE' });
		}
	}

	if (pathname === '/_debug/do-stats' && method === 'GET') {
		return fetchLogDurableObject(env, '/stats');
	}

	if (pathname === '/_debug/live-log') {
		if (request.headers.get('Upgrade') !== 'websocket') {
			return new Response(getLiveLogPage(), {
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		}

		return fetchLogDurableObject(env, request);
	}

	// D1 log statistics
	if (pathname === '/_debug/d1-stats') {
		if (method === 'GET') {
			if (!env?.DB) {
				return new Response('D1 database not configured', { status: 500 });
			}

			try {
				const { getLogStats } = await import('./log-persistence');
				const stats = await getLogStats(env.DB);
				return new Response(JSON.stringify(stats, null, 2), {
					headers: { 'Content-Type': 'application/json' }
				});
			} catch (e) {
				return new Response(`Error loading D1 stats: ${e}`, { status: 500 });
			}
		}
	}

	// Clear D1 logs via GET
	if (method === 'GET' && pathname === '/_debug/clear-d1-logs') {
		if (!env?.DB) {
			return new Response('D1 database not configured', { status: 500 });
		}

		try {
			return new Response(await clearD1Logs(env), {
				headers: { 'Content-Type': 'text/plain' }
			});
		} catch (e) {
			return new Response(`Error clearing D1 logs: ${e}`, { status: 500 });
		}
	}

	// HTTP log routes
	if (pathname === '/_debug/http-log') {
		if (method === 'GET') {
			return new Response(getHttpLog(), {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			clearHttpLog();
			return new Response('HTTP log cleared', {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// Write operation log routes
	if (pathname === '/_debug/write-log') {
		if (method === 'GET') {
			return new Response(getWriteOperationLog(), {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			clearWriteOperationLog();
			return new Response('Write operation log cleared', {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// All log routes
	if (pathname === '/_debug/all-logs') {
		if (method === 'GET') {
			const sections = [
				'=== HTTP LOGS (CURRENT ISOLATE MEMORY) ===\n\n' + (getHttpLog() || 'No memory HTTP logs'),
				'=== WRITE OPERATION LOGS (CURRENT ISOLATE MEMORY) ===\n\n' + (getWriteOperationLog() || 'No memory write operation logs')
			];

			if (env?.DB) {
				try {
					sections.push('=== D1 REQUEST LOGS ===\n\n' + await getD1LogText(env, parseLimit(url)));
				} catch (e) {
					sections.push(`=== D1 REQUEST LOGS ===\n\nError loading D1 logs: ${e}`);
				}
			}

			if (env?.LOG_DO) {
				try {
					const doResponse = await fetchLogDurableObject(env, `/recent?limit=${parseLimit(url)}`);
					sections.push('=== DURABLE OBJECT LOGS ===\n\n' + await doResponse.text());
				} catch (e) {
					sections.push(`=== DURABLE OBJECT LOGS ===\n\nError loading Durable Object logs: ${e}`);
				}
			}

			return new Response(sections.join('\n\n'), {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			const messages = await clearAllLogStores(env);
			return new Response(messages.join('\n'), {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// Clear logs via GET for convenience in the browser
	if (method === 'GET' && pathname === '/_debug/clear-http-log') {
		clearHttpLog();
		return new Response('HTTP log cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	if (method === 'GET' && pathname === '/_debug/clear-write-log') {
		clearWriteOperationLog();
		return new Response('Write operation log cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	if (method === 'GET' && pathname === '/_debug/clear-all-logs') {
		const messages = await clearAllLogStores(env);
		console.log('All logs cleared via GET request');
		return new Response(messages.join('\n'), {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	if (method === 'GET' && pathname === '/_debug/clear-do-logs') {
		return fetchLogDurableObject(env, '/clear', { method: 'DELETE' });
	}

	// Return null if no debug route matches
	return null;
}
