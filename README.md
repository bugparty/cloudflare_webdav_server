# Cloudflare WebDAV Server

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bugparty/cloudflare_webdav_server)

A complete WebDAV server implementation for Cloudflare Workers and R2. It is built to work with everyday GUI WebDAV clients on Windows, macOS, and Linux, so you can mount your own private cloud drive without running a server.

Repository: https://github.com/bugparty/cloudflare_webdav_server/tree/master

For small personal workloads, this can run within Cloudflare Workers and R2 free allowances where available. R2 is S3-compatible object storage, and Workers provides the HTTP/WebDAV layer at the edge.

## Highlights

- Full WebDAV request handling for common desktop clients.
- Compatible with macOS Finder, Windows File Explorer, and Linux GUI file managers such as GNOME Files, KDE Dolphin, and Thunar.
- Uses Cloudflare R2 as the backing object store.
- Uses Workers KV for WebDAV lock state.
- Supports Basic Auth with Cloudflare Workers secrets.
- Supports `GET`, `HEAD`, `PUT`, `DELETE`, `PROPFIND`, `PROPPATCH`, `MKCOL`, `MOVE`, `COPY`, `LOCK`, `UNLOCK`, and `OPTIONS`.
- Handles macOS Finder metadata behavior, including `.DS_Store`, AppleDouble `._*` files, lock/unlock flows, and replace workflows.
- Supports Windows Explorer WebDAV behavior, including lock-aware upload flows.
- Provides optional debug logs through D1 and Durable Objects, protected by Basic Auth.
- Includes local and remote compatibility tests.

## Architecture

```text
WebDAV client
    |
    v
Cloudflare Worker
    |
    +-- R2 bucket: file contents and directory marker objects
    +-- KV namespace: WebDAV lock tokens
    +-- D1 database: optional persistent request logs
    +-- Durable Object: optional live/recent log stream
```

This project maps WebDAV resources to R2 object keys. Directories are represented as key prefixes, with optional directory marker objects ending in `/`.

## Quick Deploy

Click the Deploy to Cloudflare button above and follow the Cloudflare setup flow. Cloudflare can provision required Worker resources from the repository configuration during deployment.

After deployment, configure credentials before exposing the server:

```bash
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD
```

Then connect to:

```text
https://your-worker.your-subdomain.workers.dev/
```

## Manual Deploy

Install dependencies:

```bash
npm install
```

Log in to Cloudflare:

```bash
npx wrangler login
```

Create or choose the Cloudflare resources used by the Worker:

- R2 bucket bound as `BUCKET`
- KV namespace bound as `LOCKS`
- Optional D1 database bound as `DB`
- Optional Durable Object binding named `LOG_DO`

Update `wrangler.jsonc` with your own resource names and IDs, then set production credentials:

```bash
npx wrangler secret put WEBDAV_USERNAME
npx wrangler secret put WEBDAV_PASSWORD
```

Deploy:

```bash
npm run deploy
```

## Client Setup

### macOS Finder

1. Open Finder.
2. Press `Cmd + K`.
3. Enter `https://your-worker.your-subdomain.workers.dev/`.
4. Sign in with your WebDAV username and password.

### Windows File Explorer

1. Open File Explorer.
2. Right-click "This PC" and choose "Map network drive".
3. Enter `https://your-worker.your-subdomain.workers.dev/`.
4. Enable alternate credentials if prompted.
5. Sign in with your WebDAV username and password.

### Linux GUI File Managers

Most Linux desktop file managers support WebDAV through GVfs, KIO, or similar backends.

Use one of these URL forms depending on the client:

```text
davs://your-worker.your-subdomain.workers.dev/
https://your-worker.your-subdomain.workers.dev/
```

## Command Line Examples

List the root directory:

```bash
curl -u username:password -X PROPFIND https://your-worker.your-subdomain.workers.dev/
```

Upload a file:

```bash
curl -u username:password -T local-file.txt https://your-worker.your-subdomain.workers.dev/remote-file.txt
```

Download a file:

```bash
curl -u username:password https://your-worker.your-subdomain.workers.dev/remote-file.txt -o downloaded-file.txt
```

Create a directory:

```bash
curl -u username:password -X MKCOL https://your-worker.your-subdomain.workers.dev/new-folder/
```

Delete a file:

```bash
curl -u username:password -X DELETE https://your-worker.your-subdomain.workers.dev/file-to-delete.txt
```

## Configuration

Required bindings:

- `BUCKET`: Cloudflare R2 bucket used for WebDAV file storage.
- `LOCKS`: Cloudflare KV namespace used for WebDAV locks.

Optional bindings:

- `DB`: Cloudflare D1 database for persistent request logs.
- `LOG_DO`: Durable Object namespace for recent and live logs.

Environment variables:

- `WEBDAV_USERNAME`: Basic Auth username.
- `WEBDAV_PASSWORD`: Basic Auth password.

Security note: if `WEBDAV_USERNAME` or `WEBDAV_PASSWORD` is not configured, the server allows requests for backward compatibility. Do not run a public deployment without credentials.

## Debug Logs

Authenticated debug endpoints are available under `/_debug`, including:

- `/_debug`
- `/_debug/http-log`
- `/_debug/write-log`
- `/_debug/d1-logs`
- `/_debug/do-logs`
- `/_debug/all-logs`
- `/_debug/live-log`

These routes can expose request paths and operational metadata, so they are protected by the same Basic Auth credentials as the WebDAV server.

## Development

Run locally:

```bash
npm run dev
```

Run tests:

```bash
npm test -- --run
```

Run remote compatibility checks after deploying:

```bash
WEBDAV_REMOTE_URL=https://your-worker.your-subdomain.workers.dev/ \
WEBDAV_REMOTE_USER=username \
WEBDAV_REMOTE_PASS=password \
npm run test:remote:finder
```

```bash
WEBDAV_REMOTE_URL=https://your-worker.your-subdomain.workers.dev/ \
WEBDAV_REMOTE_USER=username \
WEBDAV_REMOTE_PASS=password \
npm run test:remote:folder-move
```

## Notes And Limits

Cloudflare R2 is object storage, not a traditional filesystem. Directory operations are implemented with object prefixes and listing calls.

This means:

- Single-file uploads and downloads are straightforward.
- Large directory listings depend on R2 `list` performance.
- Folder `MOVE`, `COPY`, and `DELETE` operations are recursive object operations.
- Very large flat directories may feel slower in GUI clients than a local filesystem.

For personal WebDAV storage, backups, document sync, and small team workflows, this tradeoff keeps the deployment simple and serverless.

## Related Docs

- [Authentication setup](./README_AUTH.md)
- [Usage examples](./USAGE_EXAMPLES.md)
- [macOS compatibility plan](./mac-compatibility-plan.md)
- [Windows compatibility plan](./window-compatibility-plan.md)
