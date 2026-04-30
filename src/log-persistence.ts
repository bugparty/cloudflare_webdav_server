/**
 * Persistent logging using D1 database with real-time streaming support.
 */

export interface LogEntry {
	id?: number;
	timestamp: string;
	method: string;
	path: string;
	status: number;
	user_agent?: string;
	ip?: string;
	request_headers?: string;
	response_headers?: string;
	body_info?: string;
	created_at?: string;
}

/**
 * Initialize the log table in D1
 */
export async function initializeLogTable(db: D1Database): Promise<void> {
	await db.exec(`
		CREATE TABLE IF NOT EXISTS http_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp TEXT NOT NULL,
			method TEXT NOT NULL,
			path TEXT NOT NULL,
			status INTEGER NOT NULL,
			user_agent TEXT,
			ip TEXT,
			request_headers TEXT,
			response_headers TEXT,
			body_info TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE INDEX IF NOT EXISTS idx_timestamp ON http_logs(timestamp DESC);
		CREATE INDEX IF NOT EXISTS idx_method ON http_logs(method);
		CREATE INDEX IF NOT EXISTS idx_path ON http_logs(path);
		CREATE INDEX IF NOT EXISTS idx_status ON http_logs(status);
	`);
}

/**
 * Log an HTTP interaction to D1
 */
export async function logToD1(
	db: D1Database,
	request: Request,
	response: Response,
	additionalInfo?: string
): Promise<void> {
	const timestamp = new Date().toISOString();
	const url = new URL(request.url);

	// Extract request headers
	const requestHeaders: Record<string, string> = {};
	request.headers.forEach((value, name) => {
		requestHeaders[name] = value;
	});

	// Extract response headers
	const responseHeaders: Record<string, string> = {};
	response.headers.forEach((value, name) => {
		responseHeaders[name] = value;
	});

	await db.prepare(`
		INSERT INTO http_logs (
			timestamp, method, path, status,
			user_agent, ip, request_headers, response_headers, body_info
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`).bind(
		timestamp,
		request.method,
		url.pathname,
		response.status,
		request.headers.get('user-agent') || undefined,
		request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || undefined,
		JSON.stringify(requestHeaders),
		JSON.stringify(responseHeaders),
		additionalInfo || undefined
	).run();
}

/**
 * Get recent logs from D1
 */
export async function getRecentLogs(
	db: D1Database,
	limit: number = 100
): Promise<LogEntry[]> {
	const result = await db.prepare(`
		SELECT * FROM http_logs
		ORDER BY timestamp DESC
		LIMIT ?
	`).bind(limit).all<LogEntry>();

	return result.results;
}

/**
 * Get logs by path pattern
 */
export async function getLogsByPath(
	db: D1Database,
	pathPattern: string,
	limit: number = 100
): Promise<LogEntry[]> {
	const result = await db.prepare(`
		SELECT * FROM http_logs
		WHERE path LIKE ?
		ORDER BY timestamp DESC
		LIMIT ?
	`).bind(`%${pathPattern}%`, limit).all<LogEntry>();

	return result.results;
}

/**
 * Get logs by method
 */
export async function getLogsByMethod(
	db: D1Database,
	method: string,
	limit: number = 100
): Promise<LogEntry[]> {
	const result = await db.prepare(`
		SELECT * FROM http_logs
		WHERE method = ?
		ORDER BY timestamp DESC
		LIMIT ?
	`).bind(method, limit).all<LogEntry>();

	return result.results;
}

/**
 * Clear old logs (keep last N days)
 */
export async function clearOldLogs(
	db: D1Database,
	daysToKeep: number = 7
): Promise<number> {
	const cutoffDate = new Date();
	cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

	const result = await db.prepare(`
		DELETE FROM http_logs
		WHERE created_at < ?
	`).bind(cutoffDate.toISOString()).run();

	return result.meta.changes;
}

/**
 * Clear all logs
 */
export async function clearAllLogs(db: D1Database): Promise<number> {
	const result = await db.prepare('DELETE FROM http_logs').run();
	return result.meta.changes;
}

/**
 * Get log statistics
 */
export async function getLogStats(db: D1Database): Promise<{
	total: number;
	byMethod: Record<string, number>;
	byStatus: Record<string, number>;
}> {
	const totalResult = await db.prepare('SELECT COUNT(*) as count FROM http_logs').first<{ count: number }>();
	const total = totalResult?.count || 0;

	const methodResult = await db.prepare(`
		SELECT method, COUNT(*) as count
		FROM http_logs
		GROUP BY method
	`).all<{ method: string; count: number }>();

	const byMethod: Record<string, number> = {};
	methodResult.results.forEach(row => {
		byMethod[row.method] = row.count;
	});

	const statusResult = await db.prepare(`
		SELECT status, COUNT(*) as count
		FROM http_logs
		GROUP BY status
	`).all<{ status: number; count: number }>();

	const byStatus: Record<string, number> = {};
	statusResult.results.forEach(row => {
		byStatus[row.status.toString()] = row.count;
	});

	return { total, byMethod, byStatus };
}

/**
 * Format log entry for display
 */
export function formatLogEntry(entry: LogEntry): string {
	let output = `=== ${entry.timestamp} ===\n`;
	output += `${entry.method} ${entry.path} → ${entry.status}\n`;

	if (entry.user_agent) {
		output += `User-Agent: ${entry.user_agent}\n`;
	}

	if (entry.ip) {
		output += `IP: ${entry.ip}\n`;
	}

	if (entry.request_headers) {
		try {
			const headers = JSON.parse(entry.request_headers);
			output += '\nRequest Headers:\n';
			Object.entries(headers).forEach(([key, value]) => {
				output += `  ${key}: ${value}\n`;
			});
		} catch (e) {
			// Ignore parsing errors
		}
	}

	if (entry.body_info) {
		output += `\n${entry.body_info}\n`;
	}

	output += '---\n\n';
	return output;
}
