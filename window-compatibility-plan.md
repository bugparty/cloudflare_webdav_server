# Windows Explorer Compatibility Plan

This document tracks the work needed to make the WebDAV server behave well with Windows Explorer, also known as the Windows WebClient service or WebDAV Mini-Redirector.

## Goals

- Mount the Worker URL as a Windows network location or mapped drive.
- Support file upload, download, rename, copy, delete, and directory creation from Windows Explorer.
- Avoid silent Explorer failures caused by incomplete WebDAV metadata responses.
- Keep the server compatible with GNOME Files and macOS Finder while adding Windows-specific behavior.

## Known Windows Client Constraints

Windows Explorer is stricter than many WebDAV clients:

- Basic authentication requires HTTPS by default. Local HTTP testing may require setting `BasicAuthLevel=2` under `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters`.
- The Windows WebClient service must be running.
- The default transfer limit may block larger files. Windows documents `FileSizeLimitInBytes` with a default around 50 MB.
- Large directory listings can fail when the total PROPFIND property payload exceeds `FileAttributesLimitInBytes`, documented with a default around 1 MB.
- Windows may cache a server as non-WebDAV for a short time after failed discovery. Restarting the WebClient service can clear confusing test results.
- Windows UNC-style access may use paths like `\\server@SSL\DavWWWRoot\path`, but `DavWWWRoot` is a client-side keyword and should not appear as a real server path.

## Implementation Priorities

### 1. Always Return WebDAV Discovery Headers

Return WebDAV headers for all clients, not only macOS-style clients:

- `DAV: 1, 2`
- `MS-Author-Via: DAV`
- `Accept-Ranges: bytes`
- `Allow: OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK`

`OPTIONS` should advertise `PROPPATCH` after a compatible handler exists.

### 2. Implement PROPPATCH as a Compatible No-Op

Windows Explorer may send `PROPPATCH` after uploads, copies, renames, or metadata updates.

First implementation should accept common properties and return `207 Multi-Status` even if the server does not persist them yet:

- `Win32CreationTime`
- `Win32LastModifiedTime`
- `Win32LastAccessTime`
- `displayname`
- Unknown dead properties that can safely be ignored

Recommended response behavior:

- Existing resource: return `207 Multi-Status` with `200 OK` for accepted no-op properties.
- Missing resource: return `404 Not Found`.
- Protected live properties such as `resourcetype`: return a property-level failure instead of failing the whole request when possible.

### 3. Improve PROPFIND Property Support

Windows Explorer relies heavily on correct PROPFIND metadata. The server should support these properties:

- `displayname`
- `resourcetype`
- `getcontentlength`
- `getlastmodified`
- `creationdate`
- `getetag`
- `getcontenttype`
- `supportedlock`
- `lockdiscovery`

Important behavior:

- Missing resources must return HTTP `404`.
- Collections should use hrefs ending in `/`.
- `Depth: 0` should return only the target resource.
- `Depth: 1` should return the target collection and its immediate children.
- Directory listings should stay compact to avoid Windows property payload limits.
- If the request body asks for specific properties, prefer returning only those properties.

### 4. Complete Lock Metadata

If the server advertises `DAV: 2`, locking should be complete enough for Windows:

- `LOCK` should return a valid `Lock-Token` header.
- Lock XML should use `<D:locktype><D:write/></D:locktype>`.
- `UNLOCK` should accept the same token format emitted by `LOCK`.
- Write operations should honor lock tokens from the `If` header.
- `PROPFIND lockdiscovery` should return active lock information.
- `PROPFIND supportedlock` should advertise supported exclusive write locks.

### 5. Support Recursive Collection Operations

Windows Explorer can use collection-level operations when copying or moving folders.

Needed behavior:

- `COPY` on a collection with `Depth: infinity` should recursively copy child objects.
- `MOVE` on a collection should recursively copy then delete the original tree.
- `DELETE` on a collection should delete all children.
- `Overwrite: F` should return `412 Precondition Failed` when the destination exists.
- Destination parent checks should treat implicit R2 prefixes as directories.

### 6. Keep PUT Streamed

Large uploads should stream directly into R2 where possible.

Implementation rules:

- Do not read the full request body into memory for normal `PUT`.
- Use `Content-Length` for logging and `X-Expected-Entity-Length` validation when present.
- Only fall back to reading the body when a client sends `X-Expected-Entity-Length` without `Content-Length`.
- Return `201 Created` for new resources and `204 No Content` for overwrites.
- Return an `ETag` header after successful upload.

### 7. Handle Windows Authentication Details

The current Basic Auth parser should be tolerant of common Windows username formats:

- `username`
- `DOMAIN\username`
- `user@example.com`

Decision needed:

- Either require the exact configured username, or normalize `DOMAIN\username` to `username` before comparison.
- Keep HTTPS as the expected production path for Basic Auth.

## Test Plan

### Local Curl Tests

Use curl to verify protocol behavior before testing Windows Explorer:

```bash
curl -i -u USER:PASS -X OPTIONS https://example.com/
curl -i -u USER:PASS -X PROPFIND https://example.com/ -H 'Depth: 0'
curl -i -u USER:PASS -X PROPFIND https://example.com/missing.txt -H 'Depth: 0'
curl -i -u USER:PASS -T ./sample.txt https://example.com/sample.txt
curl -i -u USER:PASS -X PROPPATCH https://example.com/sample.txt \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @proppatch-win32.xml
```

Expected results:

- `OPTIONS` returns `DAV`, `MS-Author-Via`, and complete `Allow`.
- Missing `PROPFIND` returns `404`.
- Upload returns `201` or `204`.
- `PROPPATCH` returns `207 Multi-Status`.

### Windows Explorer Tests

Test from a clean Windows client with WebClient running:

```cmd
net use * https://example.com/ /user:USER PASS
```

Manual checks:

- Open mapped drive in Explorer.
- Copy a small text file into the root.
- Copy a file into an existing directory.
- Rename the uploaded file.
- Delete the file.
- Create a folder.
- Copy a folder with at least one child file.
- Upload a file larger than the old in-memory Worker safety threshold.

If Explorer fails without clear UI feedback:

```cmd
net stop webclient
net start webclient
```

Then retry the operation.

## Acceptance Criteria

- Windows Explorer can map the Worker URL over HTTPS.
- Copying a file into the root succeeds.
- Copying a file into a nested directory succeeds.
- Creating, renaming, copying, moving, and deleting folders work for simple folder trees.
- Windows `PROPPATCH` requests do not break uploads or renames.
- `PROPFIND` on missing targets returns `404`.
- Directory hrefs in `PROPFIND` end with `/`.
- Wrangler dry-run build passes.
- Existing GNOME and macOS compatibility behavior remains intact.

## References

- Microsoft WebDAV Redirector documentation: https://learn.microsoft.com/en-us/iis/publish/using-webdav/using-the-webdav-redirector
- Microsoft WebDAV folder troubleshooting and `FileAttributesLimitInBytes`: https://learn.microsoft.com/en-us/troubleshoot/windows-client/networking/cannot-access-webdav-web-folder
