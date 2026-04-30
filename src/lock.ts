/**
 * WebDAV Lock implementation using Cloudflare KV.
 *
 * Based on RFC 4918 Section 7: Locking
 * https://tools.ietf.org/html/rfc4918#section-7
 */

import { Env } from './types';

/**
 * Lock information stored in KV.
 */
export interface LockInfo {
	token: string;           // opaquelocktoken:xxx
	path: string;            // Locked path
	owner: string;           // Lock owner (from XML)
	created: number;         // Creation timestamp (ms)
	timeout: number;         // Timeout in seconds
	depth: '0' | 'infinity'; // Lock depth
	scope: 'exclusive' | 'shared'; // Lock scope
}

/**
 * Generate a unique lock token.
 */
export function generateLockToken(): string {
	// Generate UUID v4
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);

	// Set version (4) and variant bits
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex = Array.from(bytes)
		.map(b => b.toString(16).padStart(2, '0'))
		.join('');

	return `opaquelocktoken:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Parse lock request XML body.
 */
export function parseLockRequest(body: string): {
	scope?: 'exclusive' | 'shared';
	depth?: '0' | 'infinity';
	owner?: string;
	timeout?: number;
} {
	const result: any = {};

	// Parse scope
	if (body.includes('<D:exclusive')) {
		result.scope = 'exclusive';
	} else if (body.includes('<D:shared')) {
		result.scope = 'shared';
	}

	// Parse depth (default to infinity for collections)
	const depthMatch = body.match(/<D:depth>(.*?)<\/D:depth>/);
	if (depthMatch) {
		result.depth = depthMatch[1] === '0' ? '0' : 'infinity';
	}

	// Parse owner
	const ownerMatch = body.match(/<D:owner>([\s\S]*?)<\/D:owner>/);
	if (ownerMatch) {
		result.owner = ownerMatch[1].trim();
	}

	return result;
}

/**
 * Get lock for a path from KV.
 */
export async function getLock(path: string, env: Env): Promise<LockInfo | null> {
	const key = `lock:${path}`;
	const data = await env.LOCKS.get(key);
	if (!data) return null;

	try {
		const lock = JSON.parse(data) as LockInfo;

		// Check if lock has expired
		const now = Date.now();
		const expiresAt = lock.created + (lock.timeout * 1000);
		if (now > expiresAt) {
			// Lock expired, delete it
			await env.LOCKS.delete(key);
			return null;
		}

		return lock;
	} catch (e) {
		return null;
	}
}

/**
 * Create a lock in KV.
 */
export async function createLock(
	path: string,
	env: Env,
	options: {
		scope?: 'exclusive' | 'shared';
		depth?: '0' | 'infinity';
		owner?: string;
		timeout?: number;
	} = {}
): Promise<LockInfo> {
	const token = generateLockToken();
	const lock: LockInfo = {
		token,
		path,
		owner: options.owner || '',
		created: Date.now(),
		timeout: options.timeout || 3600, // Default 1 hour
		depth: options.depth || 'infinity',
		scope: options.scope || 'exclusive'
	};

	const key = `lock:${path}`;
	await env.LOCKS.put(key, JSON.stringify(lock), {
		expirationTtl: lock.timeout
	});

	return lock;
}

/**
 * Delete a lock from KV.
 */
export async function deleteLock(path: string, env: Env): Promise<void> {
	const key = `lock:${path}`;
	await env.LOCKS.delete(key);
}

/**
 * Validate If header with lock tokens.
 *
 * The If header can contain lock tokens that must be validated.
 * Returns true if the request is allowed, false otherwise.
 */
export async function validateLockToken(
	path: string,
	ifHeader: string | null,
	env: Env
): Promise<{ valid: boolean; status?: number }> {
	const lock = await getLock(path, env);

	// No lock exists, allow the request
	if (!lock) {
		return { valid: true };
	}

	// No If header provided but resource is locked
	if (!ifHeader) {
		return { valid: false, status: 423 }; // Locked
	}

	// Parse the If header for lock tokens
	// Format: (<opaquelocktoken:xxx>) or <uri> (<opaquelocktoken:xxx>)
	const tokenMatch = ifHeader.match(/opaquelocktoken:[a-f0-9-]+/gi);
	if (!tokenMatch) {
		return { valid: false, status: 423 };
	}

	// Check if any of the tokens match
	const lockToken = lock.token.replace('opaquelocktoken:', '');
	for (const token of tokenMatch) {
		const tokenValue = token.replace('opaquelocktoken:', '');
		if (tokenValue === lockToken) {
			return { valid: true };
		}
	}

	return { valid: false, status: 423 };
}

/**
 * Generate LOCK response XML.
 */
export function generateLockResponse(lock: LockInfo, href: string): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:${lock.scope}/></D:locktype>
      <D:lockscope><D:${lock.scope}/></D:lockscope>
      <D:depth>${lock.depth}</D:depth>
      <D:owner>${lock.owner}</D:owner>
      <D:timeout>Second-${lock.timeout}</D:timeout>
      <D:locktoken><D:href>${lock.token}</D:href></D:locktoken>
      <D:lockroot><D:href>${href}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
}

/**
 * Check if a path or its parent is locked.
 * Used for write operations (PUT, DELETE, MOVE, etc.)
 */
export async function checkPathLocked(
	path: string,
	env: Env,
	ifHeader: string | null
): Promise<{ locked: boolean; status?: number }> {
	// Check if the path itself is locked
	const directLock = await getLock(path, env);
	if (directLock) {
		const validation = await validateLockToken(path, ifHeader, env);
		if (!validation.valid) {
			return { locked: true, status: validation.status };
		}
	}

	// Check if any parent path is locked with depth infinity
	// This is required for inherited locks
	const parts = path.split('/');
	for (let i = parts.length - 1; i > 0; i--) {
		const parentPath = parts.slice(0, i).join('/');
		const parentLock = await getLock(parentPath, env);
		if (parentLock && parentLock.depth === 'infinity') {
			const validation = await validateLockToken(parentPath, ifHeader, env);
			if (!validation.valid) {
				return { locked: true, status: validation.status };
			}
		}
	}

	return { locked: false };
}
