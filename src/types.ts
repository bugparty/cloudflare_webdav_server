/** Minimal lock storage contract shared by Workers KV and the D1 adapter. */
export interface LockStorage {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
	BUCKET: R2Bucket;
	DB?: D1Database;
	LOCKS: LockStorage;
	LOG_DO?: DurableObjectNamespace;
	WEBDAV_USERNAME?: string;
	WEBDAV_PASSWORD?: string;
}

export interface ObjectMetadata {
	size: number;
	etag?: string;
	httpMetadata: {
		updated: Date;
		contentType?: string;
	};
}
export interface WebDAVDelegate {
	init: (env: Env) => void;
	onDelete?: (request: Request) => Promise<Response>;
	onGet?: (request: Request) => Promise<Response>;
	onHead?: (request: Request) => Promise<Response>;
	onMkcol?: (request: Request) => Promise<Response>;
	onMove?: (request: Request) => Promise<Response>;
	onCopy?: (request: Request) => Promise<Response>;
	onOptions?: (request: Request) => Promise<Response>;
	onPropfind?: (request: Request) => Promise<Response>;
	onPut?: (request: Request) => Promise<Response>;
	onPost?: (request: Request) => Promise<Response>;
	onLock?: (request: Request) => Promise<Response>;
	onUnlock?: (request: Request) => Promise<Response>;
	onProppatch?: (request: Request) => Promise<Response>;
	onTrace?: (request: Request) => Promise<Response>;
	onSearch?: (request: Request) => Promise<Response>;
	onAcl?: (request: Request) => Promise<Response>;
	onReport?: (request: Request) => Promise<Response>;
}
