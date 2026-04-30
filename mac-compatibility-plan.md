# macOS Finder Compatibility Plan

This document tracks the work needed to make the WebDAV server behave well with macOS Finder, also known by its WebDAV user agent family `WebDAVFS`.

## Goals

- Connect from Finder using `Go` -> `Connect to Server`.
- Support Finder file upload, download, rename, copy, delete, and folder creation.
- Avoid Finder silently switching to read-only mode.
- Keep compatibility with GNOME Files and Windows Explorer while preserving macOS-specific behavior.
- Handle Finder's metadata traffic without corrupting user files or producing confusing UI failures.

## Known macOS Finder Behaviors

Finder is a stable WebDAV client, but it is strict about locking and chatty about metadata.

- Finder needs working WebDAV locking for write support. If locking is missing or advertised incorrectly, Finder can treat the share as read-only.
- Finder may send `Transfer-Encoding: chunked` for `PUT` bodies. The Worker should stream request bodies into R2 and must not require `Content-Length`.
- Finder probes and writes metadata files such as `.DS_Store`, `._filename`, `.metadata_never_index`, `.metadata_never_index_unless_rootfs`, `.metadata_direct_scope_only`, `.hidden`, and `.Spotlight-V100`.
- Finder uses `X-Expected-Entity-Length` on some `PUT` requests. If present, validate it against `Content-Length` when available, or against the buffered body only as a fallback.
- Finder may issue many `PROPFIND Depth: 0` checks for missing sidecar metadata files. Missing resources should return HTTP `404`.
- Finder expects collection hrefs to end with `/`.
- Finder can perform many small metadata requests before and after a real file upload, so logs should make the actual file operation easy to identify.

## Current Repository Observations

The repository already has macOS-specific pieces:

- `src/macos.ts` detects `WebDAVFS`, `Darwin.*WebDAV`, and `WebDAVLib` user agents.
- macOS `OPTIONS` can be answered before authentication.
- macOS compatibility headers include `MS-Author-Via`, `DAV`, `Server`, and `Accept-Ranges`.
- `src/webdav-delegate.ts` handles `X-Expected-Entity-Length`.
- `src/lock.ts` implements `LOCK` and `UNLOCK`.
- `misc/finder_handshake_dump.txt` shows Finder requesting `.DS_Store`, `._*`, metadata marker files, and lock operations.

Several areas still need cleanup:

- `test/macos.spec.ts` still expects `PROPFIND /.DS_Store` for a missing resource to return `207`; that should be updated to `404`.
- `PROPFIND` should return requested lock metadata such as `supportedlock` and `lockdiscovery`.
- `PROPPATCH` is currently not implemented, but Finder-compatible behavior is useful for broader client compatibility.
- Recursive collection `COPY`, `MOVE`, and `DELETE` should be completed for folder workflows.

## Implementation Priorities

### 1. Keep LOCK and UNLOCK Fully Compatible

Finder write support depends on locking.

Required behavior:

- `OPTIONS` should advertise `LOCK` and `UNLOCK`.
- `LOCK` on an existing file should return `200 OK`.
- `LOCK` on a missing resource should return `201 Created` and create a lock-null resource state.
- `LOCK` refresh should work when the client provides a matching token in the `If` header.
- `UNLOCK` should remove the lock and return `204 No Content`.
- Write operations should reject locked resources without a matching token using `423 Locked`.
- Lock response XML should use `<D:locktype><D:write/></D:locktype>`.
- `Lock-Token` response headers should match the token value accepted later in `If` and `Lock-Token` request headers.

### 2. Make PROPFIND Accurate for Finder Probes

Finder repeatedly checks whether sidecar files exist. Incorrect `207` responses for missing files can break copy and rename flows.

Required behavior:

- Missing resources return HTTP `404`.
- Existing files return `207 Multi-Status`.
- Existing collections return `207 Multi-Status` with collection hrefs ending in `/`.
- `Depth: 0` returns only the target resource.
- `Depth: 1` returns the target collection and immediate children.
- Root `/` is always a collection.
- Implicit R2 prefixes should be treated as collections.

Recommended properties:

- `displayname`
- `resourcetype`
- `getcontentlength`
- `getlastmodified`
- `creationdate`
- `getetag`
- `getcontenttype`
- `supportedlock`
- `lockdiscovery`

### 3. Stream PUT Bodies

Finder can use chunked uploads, so the server should not rely on `Content-Length`.

Implementation rules:

- Pass `request.body` directly to `env.BUCKET.put()` when possible.
- Do not read the full body into memory for normal uploads.
- Validate `X-Expected-Entity-Length` with `Content-Length` when `Content-Length` is present.
- Only buffer the body when `X-Expected-Entity-Length` exists but `Content-Length` does not.
- Return `201 Created` for new resources and `204 No Content` for overwrites.
- Return an `ETag` header after successful upload.

### 4. Tolerate macOS Metadata Files

Finder creates metadata files as part of normal operation. The server should either store them normally or intentionally ignore them with predictable responses.

Default recommendation:

- Store `.DS_Store` and `._*` files normally at first.
- Return `404` for missing metadata files.
- Allow empty-body `PUT` requests for metadata files.
- Allow `DELETE` of metadata files even if cleanup requests are noisy.

Optional optimization after core compatibility is stable:

- Add a configurable policy to ignore or suppress selected macOS metadata files.
- If ignored, return a response Finder accepts without surfacing an error.
- Do not enable this by default until real Finder copy, rename, and folder workflows are verified.

### 5. Add PROPPATCH Compatibility

Finder itself is less dependent on `PROPPATCH` than Windows Explorer, but supporting it improves cross-client behavior and avoids failures from tools that use Finder-adjacent WebDAV stacks.

Recommended first implementation:

- Accept common dead properties as a no-op.
- Return `207 Multi-Status`.
- Return `404` for missing resources.
- Reject protected live properties at the property level when possible.

### 6. Complete Recursive Collection Operations

Finder folder workflows can trigger collection-level operations.

Needed behavior:

- `MKCOL` creates explicit directory marker objects.
- `DELETE` on a collection deletes all child objects.
- `COPY` on a collection with `Depth: infinity` copies all child objects.
- `MOVE` on a collection moves all child objects and removes the old prefix.
- Destination parent checks should treat implicit prefixes as existing collections.

### 7. Improve macOS Debugging Visibility

Finder often hides the exact WebDAV error in the UI. Server-side logs should help identify the failing request.

Useful debug fields:

- Method
- Path
- Status
- User agent
- `Depth`
- `Destination`
- `Overwrite`
- `If`
- `Lock-Token`
- `Content-Length`
- `X-Expected-Entity-Length`

Avoid logging credentials or full Authorization headers.

## Test Plan

### Local Curl Tests

Use curl to verify the server behavior before testing Finder:

```bash
curl -i -u USER:PASS -X OPTIONS https://example.com/
curl -i -u USER:PASS -X PROPFIND https://example.com/ -H 'Depth: 0'
curl -i -u USER:PASS -X PROPFIND https://example.com/.DS_Store -H 'Depth: 0'
curl -i -u USER:PASS -T ./sample.txt https://example.com/sample.txt
curl -i -u USER:PASS -X LOCK https://example.com/sample.txt \
  -H 'Depth: 0' \
  -H 'Timeout: Second-600' \
  -H 'Content-Type: text/xml; charset=utf-8' \
  --data-binary @lock.xml
```

Expected results:

- `OPTIONS` returns `DAV`, `MS-Author-Via`, `LOCK`, and `UNLOCK`.
- Missing `.DS_Store` returns `404`.
- Upload returns `201` or `204`.
- `LOCK` returns a `Lock-Token` header.

### Finder Tests

Manual checks on macOS:

- Open Finder.
- Use `Go` -> `Connect to Server`.
- Connect to `https://example.com/`.
- Authenticate with Basic Auth.
- Browse the root directory.
- Copy a small text file into the root.
- Copy a larger file into the root.
- Copy a folder containing at least one child file.
- Rename a file.
- Delete a file.
- Create and delete a folder.
- Reconnect after ejecting the mounted server.

Useful local diagnostics:

```bash
log stream --predicate 'process CONTAINS "Finder" OR process CONTAINS "webdavfs"' --info
```

Server-side debug routes should be checked immediately after a failed Finder operation.

### Remote Protocol E2E

The repository includes a remote protocol-level Finder smoke test:

```bash
WEBDAV_REMOTE_URL=https://example.com/ \
WEBDAV_REMOTE_USER=USER \
WEBDAV_REMOTE_PASS=PASS \
npm run test:remote:finder
```

The script creates a unique `_finder-e2e-*` directory on the remote server, runs the key Finder-style request sequence, and then deletes the files and directories it created.

Set `WEBDAV_REMOTE_KEEP=1` to keep the remote test directory for manual inspection.

## Acceptance Criteria

- Finder can mount the WebDAV server over HTTPS.
- Finder does not mount the server as read-only.
- Uploading a new file succeeds.
- Uploading a large file succeeds without buffering the entire request in Worker memory.
- Missing Finder sidecar files return `404` without breaking real uploads.
- `.DS_Store` and `._*` metadata traffic does not surface errors in Finder.
- File rename, delete, and folder creation work.
- Simple folder copy works after recursive collection support is implemented.
- Existing GNOME Files and Windows Explorer compatibility behavior remains intact.
- Wrangler dry-run build passes.

## References

- SabreDAV Finder client notes: https://sabre.io/dav/clients/finder/
- rclone WebDAV documentation: https://rclone.org/webdav/
- rclone WebDAV server notes on macOS case and Unicode normalization: https://rclone.org/commands/rclone_serve_webdav/
