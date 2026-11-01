import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: { exclude: ['test/d1-storage.spec.ts', '**/node_modules/**', '**/.git/**'] },
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
		}),
	],
});
