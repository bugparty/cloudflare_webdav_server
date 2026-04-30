export interface Env {
	BUCKET: R2Bucket;
	DB: D1Database;
	LOCKS: KVNamespace;
	WEBDAV_USERNAME?: string;
	WEBDAV_PASSWORD?: string;
}

export interface ObjectMetadata {
	size: number;
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
	onTrace?: (request: Request) => Promise<Response>;
	onSearch?: (request: Request) => Promise<Response>;
	onAcl?: (request: Request) => Promise<Response>;
	onReport?: (request: Request) => Promise<Response>;
}
