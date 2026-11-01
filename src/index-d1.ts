import worker from './index';
import { D1LockStore } from './d1-lock-store';
import type { Env } from './types';

export type D1Env = Omit<Env, 'LOCKS' | 'DB' | 'LOG_DO'> & { DB: D1Database };

// Alternate entrypoint for deployments with R2 and D1, without KV or Durable Objects.
export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (!env.WEBDAV_USERNAME || !env.WEBDAV_PASSWORD) {
      return new Response('WebDAV credentials are not configured', { status: 503 });
    }
    return worker.fetch!(request, {
      ...env,
      LOCKS: new D1LockStore(env.DB),
      LOG_DO: undefined
    }, ctx);
  }
} satisfies ExportedHandler<D1Env>;
