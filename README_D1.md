# D1-backed WebDAV deployment

This variant replaces the required KV lock namespace with a D1-backed adapter.
Files still live in R2. `src/index-d1.ts` uses the existing WebDAV handlers,
requires both Basic Auth credentials, and disables the optional Durable Object
log stream. D1 request logging and the authenticated debug routes remain available.
The existing KV deployment and `npm run deploy` are unchanged.

## Deploy to your Cloudflare account

1. Install dependencies with `npm ci` and sign in with `npx wrangler login`.
2. Create resources:

   ```sh
   npx wrangler d1 create webdav-d1
   npx wrangler r2 bucket create webdav-d1-files
   ```

3. Set the returned `database_id` in `wrangler.d1.jsonc`. Adjust the database and
   bucket names there if you chose different names. This configuration deliberately
   contains no existing account resource IDs or production credentials.
4. Apply the lock schema before deployment:

   ```sh
   npm run db:migrate:d1 -- --remote
   ```

5. Set credentials securely:

   ```sh
   npx wrangler secret put WEBDAV_USERNAME --config wrangler.d1.jsonc
   npx wrangler secret put WEBDAV_PASSWORD --config wrangler.d1.jsonc
   ```

6. Run `npm run deploy:d1` and connect your WebDAV client to the returned URL.

For local development, apply migrations with `npm run db:migrate:d1 -- --local`,
put test credentials in an untracked `.dev.vars`, and run `npm run dev:d1`.
Requests return 503 if either credential is missing and 401 if authentication fails.

## Sites

For Sites hosting, select `src/index-d1.ts` as the Worker entrypoint, bundle it to
`dist/server/index.js`, and declare logical bindings `d1: "DB"` and `r2: "BUCKET"`
in `.openai/hosting.json`. Sites provisions new storage; the Wrangler resource
names above are not used for Sites hosting. The Sites project ID must be supplied
by Sites, not copied from a different deployment.

The `webdav_locks` schema must be applied as a deployment migration. Sites expects
its migration metadata and SQL in the project's `drizzle/` directory; use the
Sites workflow to generate/package that migration. Set both credentials as Sites
runtime secrets before publishing. For Finder or other ordinary WebDAV clients,
make the hosting audience public and keep Basic Auth enabled: private Sites
require an additional ChatGPT sign-in or service-access header.

## Tests and storage behavior

Run `npm run test:d1` for real local R2/D1 integration checks covering file upload,
download, listing, lock enforcement, unlock, move, delete, authentication, missing
credentials, expiry, and persistence across adapter instances. The existing
`npm test -- --run` suite continues to target the original KV entrypoint.

D1 stores the same lock JSON used by KV. Expiry is enforced on reads; D1 does not
automatically delete expired rows. Periodically delete expired rows if many unique
paths are locked. The adapter preserves the existing get/put locking algorithm;
it does not add atomic lock acquisition for competing requests. Native Finder
mounting is not part of the automated tests.
