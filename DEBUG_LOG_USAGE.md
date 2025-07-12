# 调试日志使用说明

## 新增的调试日志功能

现在WebDAV服务器包含详细的HTTP请求/响应日志和文件操作日志，格式与你提供的示例完全一致。

## 可用的调试端点

### 1. HTTP请求/响应日志
- 获取日志：`GET /_debug/http-log`
- 清空日志：`DELETE /_debug/http-log`

### 2. 文件操作日志
- 获取日志：`GET /_debug/write-log`
- 清空日志：`DELETE /_debug/write-log`

### 3. 所有日志
- 获取所有日志：`GET /_debug/all-logs`

## 日志格式示例

### HTTP请求/响应日志格式
```
=== 2025-07-03T10:30:45.123Z ===
OPTIONS / HTTP/1.1
Host: localhost:8080
Accept: */*
Content-Length: 0
Connection: keep-alive
User-Agent: WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)


HTTP/1.1 200 OK
Accept-Ranges: bytes
Allow: OPTIONS, LOCK, DELETE, PROPPATCH, COPY, MOVE, UNLOCK, PROPFIND
Dav: 1, 2
Ms-Author-Via: DAV
Server: WebDAV Server/1.0
Date: Fri, 04 Jul 2025 02:03:32 GMT
Content-Length: 0

---

=== 2025-07-03T10:30:46.456Z ===
PUT /test.txt HTTP/1.1
Host: localhost:8080
Content-Type: text/plain
Content-Length: 12
Connection: keep-alive
User-Agent: WebDAVFS/3.0.0 (03008000) Darwin/24.5.0 (arm64)

PUT Operation Details:
- Target path: test.txt
- Content-Type: text/plain
- Content-Length: 12 bytes
- Body size: 12 bytes
- Timestamp: 2025-07-03T10:30:46.456Z
- Content preview: "Hello World!"
- Result: SUCCESS - File written to R2

HTTP/1.1 201 Created
Ms-Author-Via: DAV
Dav: 1,2,3
Server: WebDAV Server/1.0
Content-Length: 0

---
```

### 文件操作日志格式
```
=== 2025-07-03T10:30:46.456Z - PUT ===
Path: test.txt
Details: {
  "operation": "PUT",
  "path": "test.txt",
  "contentType": "text/plain",
  "contentLength": 12,
  "contentPreview": "Hello World!",
  "timestamp": "2025-07-03T10:30:46.456Z",
  "result": "SUCCESS",
  "message": "File written to R2"
}
---

=== 2025-07-03T10:30:47.789Z - DELETE ===
Path: test.txt
Details: {
  "operation": "DELETE",
  "path": "test.txt",
  "timestamp": "2025-07-03T10:30:47.789Z",
  "fileExists": true,
  "fileSize": 12,
  "contentType": "text/plain",
  "result": "SUCCESS",
  "message": "File deleted from R2"
}
---
```

## 记录的操作类型

### 1. PUT操作
- 文件路径
- 内容类型
- 文件大小
- 内容预览（小文件）
- 写入结果

### 2. DELETE操作
- 文件路径
- 文件是否存在
- 文件大小和类型（如果存在）
- 删除结果

### 3. MKCOL操作
- 目录路径
- 创建结果

### 4. MOVE/COPY操作
- 源路径和目标路径
- 文件大小和类型
- 操作结果

## 特性

1. **完整的HTTP日志**：记录所有HTTP请求和响应，包括方法、路径、头部和状态码
2. **详细的文件操作日志**：专门记录文件写入、删除、移动等操作的详细信息
3. **内容预览**：对于小文件（<1KB），会记录文件内容预览
4. **错误处理**：记录操作失败时的错误信息
5. **时间戳**：所有日志都包含精确的时间戳
6. **macOS兼容性**：专门针对macOS WebDAV客户端的兼容性处理

## 使用方式

1. 在你的WebDAV客户端（如macOS Finder）中进行各种操作
2. 通过浏览器访问 `http://your-worker-domain/_debug/http-log` 查看HTTP日志
3. 访问 `http://your-worker-domain/_debug/write-log` 查看文件操作日志
4. 访问 `http://your-worker-domain/_debug/all-logs` 查看所有日志

## 注意事项

- 日志存储在内存中，Worker重启后会丢失
- HTTP日志最多保存100条记录
- 文件操作日志最多保存50条记录
- 大文件（>1KB）不会记录内容预览，避免内存占用过多
- 日志包含敏感信息，生产环境中应该限制访问权限

## 调试macOS Finder连接问题

当macOS Finder连接有问题时，可以：
1. 在Finder中连接WebDAV服务器
2. 尝试进行文件操作
3. 访问调试日志端点查看详细的交互记录
4. 分析认证、请求头、响应状态等信息
