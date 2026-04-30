/**
 * Durable Object for real-time log streaming.
 *
 * This provides a live log viewer with WebSocket support,
 * allowing you to see GNOME file manager requests in real-time.
 */

export class LogDurableObject {
	private state: DurableObjectState;
	private maxLogs: number = 1000;

	constructor(state: DurableObjectState) {
		this.state = state;
	}

	// Handle HTTP requests
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// WebSocket upgrade for real-time log streaming
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocket(request);
		}

		// Add log entry
		if (request.method === 'POST') {
			const logEntry = await request.text();
			await this.addLog(logEntry);
			return new Response('OK', { status: 201 });
		}

		// Get all logs
		if (url.pathname === '/logs' && request.method === 'GET') {
			const logs = await this.getLogs();
			return new Response(logs.join('\n'), {
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		// Get recent logs
		if (url.pathname === '/recent' && request.method === 'GET') {
			const limit = parseInt(url.searchParams.get('limit') || '100');
			const logs = await this.getLogs();
			const recent = logs.slice(-limit);
			return new Response(recent.join('\n'), {
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		// Clear logs
		if (url.pathname === '/clear' && request.method === 'DELETE') {
			await this.state.storage.delete('logs');
			return new Response('Logs cleared', { status: 200 });
		}

		// Get stats
		if (url.pathname === '/stats' && request.method === 'GET') {
			const logs = await this.getLogs();
			return new Response(JSON.stringify({
				total: logs.length,
				sessions: this.state.getWebSockets().length
			}), {
				headers: { 'Content-Type': 'application/json' }
			});
		}

		return new Response('Not Found', { status: 404 });
	}

	// Handle WebSocket connections
	private async handleWebSocket(request: Request): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// Accept the WebSocket connection
		this.state.acceptWebSocket(server);

		// Send recent logs to the new client
		const logs = await this.getLogs();
		const recentLogs = logs.slice(-50);
		if (recentLogs.length > 0) {
			server.send(recentLogs.join('\n'));
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	// Handle WebSocket messages
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		// Client can request specific actions
		if (typeof message === 'string') {
			if (message === 'clear') {
				await this.state.storage.delete('logs');
				this.broadcast('Logs cleared');
			}
		}
	}

	// Add a log entry
	private async addLog(entry: string): Promise<void> {
		const logs = await this.getLogs();
		logs.push(entry);

		// Keep only the most recent logs
		const recent = logs.length > this.maxLogs ? logs.slice(-this.maxLogs) : logs;
		await this.state.storage.put('logs', recent);

		// Broadcast to all connected clients
		this.broadcast(entry);
	}

	private async getLogs(): Promise<string[]> {
		return await this.state.storage.get<string[]>('logs') || [];
	}

	// Broadcast message to all WebSocket clients
	private broadcast(message: string): void {
		for (const session of this.state.getWebSockets()) {
			try {
				session.send(message);
			} catch (e) {
				session.close(1011, 'Log broadcast failed');
			}
		}
	}
}
