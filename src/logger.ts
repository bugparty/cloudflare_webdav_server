// HTTP debug log
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
	request.headers.forEach((value, name) => {
		if (name.toLowerCase() !== 'host') {
			lines.push(`${name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`);
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
	response.headers.forEach((value, name) => {
		lines.push(`${name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`);
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
// Handle debug routes
export function handleDebugRoutes(request: Request): Response | null {
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
		clearHttpLog();
		clearWriteOperationLog();
		console.log('All logs cleared via GET request');
		return new Response('All logs cleared successfully!\n\nYou can now go back to view the logs.', {
			headers: { 'Content-Type': 'text/plain' }
		});
	}

	// Return null if no debug route matches
	return null;
}
