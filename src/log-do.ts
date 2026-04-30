/**
 * Durable Object for real-time log streaming.
 *
 * This provides a live log viewer with WebSocket support,
 * allowing you to see GNOME file manager requests in real-time.
 */

export class LogDurableObject {
	private state: DurableObjectState;
	private sessions: WebSocket[] = [];
	private logs: string[] = [];
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
			this.addLog(logEntry);
			return new Response('OK', { status: 201 });
		}

		// Get all logs
		if (url.pathname === '/logs' && request.method === 'GET') {
			return new Response(this.logs.join('\n'), {
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		// Get recent logs
		if (url.pathname === '/recent' && request.method === 'GET') {
			const limit = parseInt(url.searchParams.get('limit') || '100');
			const recent = this.logs.slice(-limit);
			return new Response(recent.join('\n'), {
				headers: { 'Content-Type': 'text/plain' }
			});
		}

		// Clear logs
		if (url.pathname === '/clear' && request.method === 'DELETE') {
			this.logs = [];
			return new Response('Logs cleared', { status: 200 });
		}

		// Get stats
		if (url.pathname === '/stats' && request.method === 'GET') {
			return new Response(JSON.stringify({
				total: this.logs.length,
				sessions: this.sessions.length
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

		// Add to sessions list
		this.sessions.push(server);

		// Send recent logs to the new client
		const recentLogs = this.logs.slice(-50);
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
				this.logs = [];
				this.broadcast('Logs cleared');
			}
		}
	}

	// Handle WebSocket close
	async webSocketClose(ws: WebSocket): Promise<void> {
		this.sessions = this.sessions.filter(s => s !== ws);
	}

	// Handle WebSocket error
	async webSocketError(ws: WebSocket): Promise<void> {
		this.sessions = this.sessions.filter(s => s !== ws);
	}

	// Add a log entry
	private addLog(entry: string): void {
		this.logs.push(entry);

		// Keep only the most recent logs
		if (this.logs.length > this.maxLogs) {
			this.logs = this.logs.slice(-this.maxLogs);
		}

		// Broadcast to all connected clients
		this.broadcast(entry);
	}

	// Broadcast message to all WebSocket clients
	private broadcast(message: string): void {
		for (const session of this.sessions) {
			try {
				session.send(message);
			} catch (e) {
				// Remove failed sessions
				this.sessions = this.sessions.filter(s => s !== session);
			}
		}
	}
}
