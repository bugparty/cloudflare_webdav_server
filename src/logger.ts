import type { Env } from './types';

// HTTP调试日志 - 保留内存缓存作为备份，主要使用 Durable Object
let httpLogBuffer: string[] = [];
let writeOperationLog: string[] = [];
export const MAX_LOG_ENTRIES = 100;
export const MAX_WRITE_LOG_ENTRIES = 50;

// Global environment reference for Durable Object access
let globalEnv: Env | null = null;

// Initialize the logger with environment
export function initLogger(env: Env): void {
	globalEnv = env;
}

// Get Durable Object instance
async function getLogStorageInstance(): Promise<DurableObjectStub | null> {
	if (!globalEnv?.LOG_STORAGE) {
		console.warn('LOG_STORAGE Durable Object not available, falling back to in-memory logging');
		return null;
	}

	// Use a fixed ID for the log storage to ensure all logs go to the same instance
	const id = globalEnv.LOG_STORAGE.idFromName('global-log-storage');
	return globalEnv.LOG_STORAGE.get(id);
}

// 获取日志状态
export async function getLogStatus(): Promise<any> {
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			return await (logStorage as any).getLogStatus();
		}
	} catch (error) {
		console.warn('Failed to get log status from Durable Object:', error);
	}

	// Fallback to in-memory stats
	return {
		httpLogEntries: httpLogBuffer.length,
		writeOperationLogEntries: writeOperationLog.length,
		maxHttpLogEntries: MAX_LOG_ENTRIES,
		maxWriteLogEntries: MAX_WRITE_LOG_ENTRIES
	};
}

// 记录写入操作的详细日志
export async function logWriteOperation(operation: string, path: string, details: any): Promise<void> {
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			await (logStorage as any).addWriteOperationLog({
				operation,
				path,
				details
			});
			console.log(`Write operation logged to Durable Object: ${operation} on ${path}`);
			return;
		}
	} catch (error) {
		console.warn('Failed to log to Durable Object, falling back to in-memory:', error);
	}

	// Fallback to in-memory logging
	const timestamp = new Date().toISOString();
	const textLogEntry = `=== ${timestamp} - ${operation} ===\n` +
		`Path: ${path}\n` +
		`Details: ${JSON.stringify(details, null, 2)}\n` +
		'---\n\n';

	writeOperationLog.push(textLogEntry);

	// 保持缓冲区大小
	if (writeOperationLog.length > MAX_WRITE_LOG_ENTRIES) {
		writeOperationLog = writeOperationLog.slice(-MAX_WRITE_LOG_ENTRIES);
	}

	console.log(`Write operation logged: ${operation} on ${path}`);
}

// 获取写入操作日志
export async function getWriteOperationLog(): Promise<string> {
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			const result = await (logStorage as any).getWriteOperationLogs('text');
			return result as string;
		}
	} catch (error) {
		console.warn('Failed to get logs from Durable Object, falling back to in-memory:', error);
	}

	// Fallback to in-memory logs
	return writeOperationLog.join('');
}

// 清空写入操作日志
export async function clearWriteOperationLog(): Promise<void> {
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			await (logStorage as any).clearWriteOperationLogs();
			return;
		}
	} catch (error) {
		console.warn('Failed to clear logs in Durable Object, falling back to in-memory:', error);
	}

	// Fallback to in-memory clear
	writeOperationLog = [];
}

// 格式化HTTP请求日志
function formatHttpRequest(request: Request, bodyInfo?: string): string {
	const url = new URL(request.url);
	const lines: string[] = [];

	// 请求行
	lines.push(`${request.method} ${url.pathname}${url.search} HTTP/1.1`);

	// Headers
	lines.push(`Host: ${url.host}`);
	request.headers.forEach((value, name) => {
		if (name.toLowerCase() !== 'host') {
			lines.push(`${name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`);
		}
	});

	// 如果有body信息，添加到请求日志中
	if (bodyInfo) {
		lines.push('');
		lines.push(bodyInfo);
	}

	return lines.join('\n') + '\n\n';
}

// 格式化HTTP响应日志
function formatHttpResponse(response: Response): string {
	const lines: string[] = [];

	// 状态行
	lines.push(`HTTP/1.1 ${response.status} ${response.statusText}`);

	// Headers
	response.headers.forEach((value, name) => {
		lines.push(`${name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`);
	});

	return lines.join('\n') + '\n\n';
}

// 记录HTTP交互到缓冲区
export async function logHttpInteraction(request: Request, response: Response, additionalInfo?: string): Promise<void> {
	const timestamp = new Date().toISOString();
	const url = new URL(request.url);

	// Try to log to Durable Object first
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			const httpLogEntry = {
				method: request.method,
				url: url.toString(),
				status: response.status,
				requestHeaders: (() => {
					const headers: Record<string, string> = {};
					request.headers.forEach((value, key) => { headers[key] = value; });
					return headers;
				})(),
				responseHeaders: (() => {
					const headers: Record<string, string> = {};
					response.headers.forEach((value, key) => { headers[key] = value; });
					return headers;
				})(),
				additionalInfo
			};

			await (logStorage as any).addHttpLog(httpLogEntry);
			console.log(`HTTP ${request.method} ${url.pathname} → ${response.status} (logged to Durable Object)`);
			return;
		}
	} catch (error) {
		console.warn('Failed to log HTTP interaction to Durable Object, falling back to in-memory:', error);
	}

	// Fallback to in-memory logging
	const logEntry = `=== ${timestamp} ===\n` +
		formatHttpRequest(request, additionalInfo) +
		formatHttpResponse(response) +
		'---\n\n';

	httpLogBuffer.push(logEntry);

	// 保持缓冲区大小
	if (httpLogBuffer.length > MAX_LOG_ENTRIES) {
		httpLogBuffer = httpLogBuffer.slice(-MAX_LOG_ENTRIES);
	}

	// 输出到控制台用于实时调试
	console.log(`HTTP ${request.method} ${url.pathname} → ${response.status}`);
	if (additionalInfo) {
		console.log('Additional info:', additionalInfo);
	}
}

// 获取完整的HTTP日志
export async function getHttpLog(): Promise<string> {
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			const result = await (logStorage as any).getHttpLogs('text');
			return result as string;
		}
	} catch (error) {
		console.warn('Failed to get HTTP logs from Durable Object, falling back to in-memory:', error);
	}

	// Fallback to in-memory logs
	return httpLogBuffer.join('');
}

// 清空HTTP日志
export async function clearHttpLog(): Promise<void> {
	try {
		const logStorage = await getLogStorageInstance();
		if (logStorage) {
			await (logStorage as any).clearHttpLogs();
			return;
		}
	} catch (error) {
		console.warn('Failed to clear HTTP logs in Durable Object, falling back to in-memory:', error);
	}

	// Fallback to in-memory clear
	httpLogBuffer = [];
}
// 处理调试路由
export async function handleDebugRoutes(request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const method = request.method;

	// 调试面板（提供所有调试功能的链接）
	if (method === 'GET' && pathname === '/_debug') {
		const logStatus = await getLogStatus();
		const debugPanel = `
WebDAV Debug Panel
==================

Current Time: ${new Date().toISOString()}

Available Debug Endpoints:
==========================

View Logs:
- HTTP Logs: /_debug/http-log
- Write Operation Logs: /_debug/write-log
- All Logs: /_debug/all-logs

Clear Logs (via GET - click in browser):
- Clear HTTP Logs: /_debug/clear-http-log
- Clear Write Logs: /_debug/clear-write-log
- Clear All Logs: /_debug/clear-all-logs

Clear Logs (via DELETE - use with curl):
- DELETE /_debug/http-log
- DELETE /_debug/write-log
- DELETE /_debug/all-logs

Usage Examples:
===============

1. View logs in browser:
   http://localhost:8787/_debug/http-log

2. Clear logs in browser:
   http://localhost:8787/_debug/clear-all-logs

3. Clear logs with curl:
   curl -X DELETE http://localhost:8787/_debug/all-logs

Log Status:
===========
- HTTP Log Entries: ${logStatus.httpLogEntries}
- Write Operation Log Entries: ${logStatus.writeOperationLogEntries}
- Max HTTP Log Entries: ${logStatus.maxHttpLogEntries}
- Max Write Log Entries: ${logStatus.maxWriteLogEntries}
		`;

		return new Response(debugPanel, {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	// HTTP日志相关路由
	if (pathname === '/_debug/http-log') {
		if (method === 'GET') {
			const httpLog = await getHttpLog();
			return new Response(httpLog, {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			await clearHttpLog();
			return new Response('HTTP log cleared', {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// 写入操作日志相关路由
	if (pathname === '/_debug/write-log') {
		if (method === 'GET') {
			const writeLog = await getWriteOperationLog();
			return new Response(writeLog, {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			await clearWriteOperationLog();
			return new Response('Write operation log cleared', {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// 所有日志相关路由
	if (pathname === '/_debug/all-logs') {
		if (method === 'GET') {
			const httpLog = await getHttpLog();
			const writeLog = await getWriteOperationLog();
			const allLogs = '=== HTTP LOGS ===\n\n' + httpLog +
				'\n\n=== WRITE OPERATION LOGS ===\n\n' + writeLog;
			return new Response(allLogs, {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			await clearHttpLog();
			await clearWriteOperationLog();
			return new Response('All logs cleared', {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// 通过GET请求清空日志（方便在浏览器中操作）
	if (method === 'GET' && pathname === '/_debug/clear-http-log') {
		await clearHttpLog();
		return new Response('HTTP log cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	if (method === 'GET' && pathname === '/_debug/clear-write-log') {
		await clearWriteOperationLog();
		return new Response('Write operation log cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	if (method === 'GET' && pathname === '/_debug/clear-all-logs') {
		await clearHttpLog();
		await clearWriteOperationLog();
		console.log('All logs cleared via GET request');
		return new Response('All logs cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	// 如果没有匹配的调试路由，返回null
	return null;
}
