// HTTP调试日志
let httpLogBuffer: string[] = [];
let writeOperationLog: string[] = [];
export const MAX_LOG_ENTRIES = 100;
export const MAX_WRITE_LOG_ENTRIES = 50;

// 获取日志状态
export function getLogStatus() {
	return {
		httpLogEntries: httpLogBuffer.length,
		writeOperationLogEntries: writeOperationLog.length,
		maxHttpLogEntries: MAX_LOG_ENTRIES,
		maxWriteLogEntries: MAX_WRITE_LOG_ENTRIES
	};
}

// 记录写入操作的详细日志
export function logWriteOperation(operation: string, path: string, details: any): void {
	const timestamp = new Date().toISOString();
	const logEntry = `=== ${timestamp} - ${operation} ===\n` +
		`Path: ${path}\n` +
		`Details: ${JSON.stringify(details, null, 2)}\n` +
		'---\n\n';

	writeOperationLog.push(logEntry);

	// 保持缓冲区大小
	if (writeOperationLog.length > MAX_WRITE_LOG_ENTRIES) {
		writeOperationLog = writeOperationLog.slice(-MAX_WRITE_LOG_ENTRIES);
	}

	console.log(`Write operation logged: ${operation} on ${path}`);
}

// 获取写入操作日志
export function getWriteOperationLog(): string {
	return writeOperationLog.join('');
}

// 清空写入操作日志
export function clearWriteOperationLog(): void {
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
	const logEntry = `=== ${timestamp} ===\n` +
		formatHttpRequest(request, additionalInfo) +
		formatHttpResponse(response) +
		'---\n\n';

        httpLogBuffer.push(logEntry);

        // 如果在本地调试环境并设置了日志文件路径，额外写入文件
        if (typeof process !== 'undefined' && process.env.DEBUG_HTTP_LOG_FILE) {
                try {
                        const { appendFile } = await import('node:fs/promises');
                        await appendFile(process.env.DEBUG_HTTP_LOG_FILE, logEntry);
                } catch (e) {
                        console.warn('Failed to write http log to file:', e);
                }
        }

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
export function getHttpLog(): string {
	return httpLogBuffer.join('');
}

// 清空HTTP日志
export function clearHttpLog(): void {
	httpLogBuffer = [];
}
// 处理调试路由
export function handleDebugRoutes(request: Request): Response | null {
	const url = new URL(request.url);
	const pathname = url.pathname;
	const method = request.method;

	// 调试面板（提供所有调试功能的链接）
	if (method === 'GET' && pathname === '/_debug') {
		const logStatus = getLogStatus();
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
- HTTP Log Entries:${logStatus.httpLogEntries}
- Write Operation Log Entries: ${logStatus.writeOperationLogEntries}
- Max HTTP Log Entries:${logStatus.maxHttpLogEntries}
- Max Write Log Entries: ${logStatus.maxWriteLogEntries}
		`;

		return new Response(debugPanel, {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	// HTTP日志相关路由
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

	// 写入操作日志相关路由
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

	// 所有日志相关路由
	if (pathname === '/_debug/all-logs') {
		if (method === 'GET') {
			const allLogs = '=== HTTP LOGS ===\n\n' + getHttpLog() +
				'\n\n=== WRITE OPERATION LOGS ===\n\n' + getWriteOperationLog();
			return new Response(allLogs, {
				headers: { 'Content-Type': 'text/plain' }
			});
		} else if (method === 'DELETE') {
			clearHttpLog();
			clearWriteOperationLog();
			return new Response('All logs cleared', {
				headers: { 'Content-Type': 'text/plain' }
			});
		}
	}

	// 通过GET请求清空日志（方便在浏览器中操作）
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
		clearHttpLog();
		clearWriteOperationLog();
		console.log('All logs cleared via GET request');
		return new Response('All logs cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	// 如果没有匹配的调试路由，返回null
	return null;
}
