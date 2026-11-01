import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF, applyD1Migrations, createExecutionContext } from 'cloudflare:test';
import { D1LockStore } from '../src/d1-lock-store';
import worker from '../src/index-d1';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
const call = (method: string, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Basic ' + btoa('test-user:local-test-only'));
  return SELF.fetch('https://webdav.test' + path, { ...init, method, headers });
};
describe('D1 deployment with real R2 and D1 bindings', () => {
  it('uploads, lists, locks, unlocks, moves and deletes files', async () => {
    expect((await call('MKCOL','/smoke/')).status).toBe(201);
    expect((await call('PUT','/smoke/file.txt',{body:'Sites WebDAV test',headers:{'Content-Type':'text/plain'}})).status).toBe(201);
    const get = await call('GET','/smoke/file.txt');
    expect(get.status).toBe(200); expect(await get.text()).toBe('Sites WebDAV test');
    const listing = await call('PROPFIND','/smoke/',{headers:{Depth:'1'}});
    expect(listing.status).toBe(207); expect(await listing.text()).toContain('file.txt');
    const lock = await call('LOCK','/smoke/file.txt',{body:'<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',headers:{Depth:'0','Content-Type':'application/xml'}});
    expect(lock.status).toBe(200);
    const token = lock.headers.get('Lock-Token'); expect(token).toBeTruthy();
    expect((await call('PUT','/smoke/file.txt',{body:'blocked'})).status).toBe(423);
    expect((await call('UNLOCK','/smoke/file.txt',{headers:{'Lock-Token':token!}})).status).toBe(204);
    expect((await call('MOVE','/smoke/file.txt',{headers:{Destination:'https://webdav.test/smoke/moved.txt'}})).status).toBe(201);
    expect(await (await call('GET','/smoke/moved.txt')).text()).toBe('Sites WebDAV test');
    expect((await call('DELETE','/smoke/')).status).toBe(204);
    expect((await call('GET','/smoke/moved.txt')).status).toBe(404);
  });
  it('rejects missing and incorrect credentials', async () => {
    expect((await SELF.fetch('https://webdav.test/')).status).toBe(401);
    expect((await SELF.fetch('https://webdav.test/', {headers:{Authorization:'Basic '+btoa('wrong:wrong')}})).status).toBe(401);
  });
  it('fails closed if either credential is missing', async () => {
    const ctx = createExecutionContext();
    for (const credentials of [
      { WEBDAV_USERNAME: '', WEBDAV_PASSWORD: 'password' },
      { WEBDAV_USERNAME: 'user', WEBDAV_PASSWORD: '' }
    ]) {
      const response = await worker.fetch(new Request('https://webdav.test/') as Parameters<typeof worker.fetch>[0], { ...env, ...credentials }, ctx);
      expect(response.status).toBe(503);
    }
  });
  it('persists lock updates and deletions across adapter instances', async () => {
    const first = new D1LockStore(env.DB);
    const second = new D1LockStore(env.DB);
    await first.put('persistent', 'first');
    expect(await second.get('persistent')).toBe('first');
    await second.put('persistent', 'updated');
    expect(await first.get('persistent')).toBe('updated');
    await second.delete('persistent');
    expect(await first.get('persistent')).toBeNull();
  });
  it('expires persisted locks', async () => {
    const store = new D1LockStore(env.DB);
    await store.put('expired','{}',{expirationTtl:-1});
    expect(await store.get('expired')).toBeNull();
  });
});
