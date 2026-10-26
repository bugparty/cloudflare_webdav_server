import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/d1-storage.spec.ts'] },
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.d1.jsonc' },
    miniflare: { bindings: {
      TEST_MIGRATIONS: await readD1Migrations('./migrations-d1'),
      WEBDAV_USERNAME: 'test-user',
      WEBDAV_PASSWORD: 'local-test-only'
    } }
  })]
});
