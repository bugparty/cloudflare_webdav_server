import type { LockStorage } from './types';

/** D1-backed subset of KV used by the WebDAV locking implementation. */
export class D1LockStore implements LockStorage {
  constructor(private db: D1Database) {}
  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare('SELECT value FROM webdav_locks WHERE key = ? AND expires_at > ?').bind(key, Date.now()).first<{value: string}>();
    return row?.value ?? null;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expires = Date.now() + (options?.expirationTtl ?? 3600) * 1000;
    await this.db.prepare('INSERT INTO webdav_locks (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at').bind(key, value, expires).run();
  }
  async delete(key: string): Promise<void> {
    await this.db.prepare('DELETE FROM webdav_locks WHERE key = ?').bind(key).run();
  }
}
