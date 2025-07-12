# macOS WebDAV 客户端问题及解决方案

## 问题描述

macOS的WebDAV客户端（WebDAVFS）存在一个已知问题：在某些情况下，它会发送无效的默认凭据而不是用户提供的真实凭据。

## 观察到的行为

从日志中可以看到：

### 正常请求（成功）
```
Authorization: Basic Ym93bWFuOnBhc3N3b3Jk
解码后: bowman:password
```

### 异常请求（失败）
```
Authorization: Basic Tm8gdXNlciBhY2NvdW46
解码后: No user accoun:
```

## 问题原因

这是macOS WebDAV客户端的一个缺陷，它可能在以下情况下发送无效凭据：
1. 在初始OPTIONS请求之后
2. 当服务器返回特定的HTTP状态码时
3. 在连接重新协商期间
4. 当遇到某些网络延迟或错误时

## 解决方案

### 1. 服务器端检测和处理

我们的代码已经添加了特殊处理：

```typescript
// 检查是否是macOS发送的无效默认凭据
if (credentials.startsWith('No user accoun')) {
    console.log('Detected macOS invalid default credentials, rejecting');
    return false;
}
```

### 2. 改进的401响应

返回更标准的WebDAV 401响应：

```typescript
function unauthorizedResponse(): Response {
    return new Response('Unauthorized', {
        status: 401,
        headers: {
            'WWW-Authenticate': 'Basic realm="WebDAV Server"',
            'Content-Type': 'text/plain',
            'DAV': '1,2',
            'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY'
        }
    });
}
```

### 3. 客户端解决方案

#### 方案A：使用第三方WebDAV客户端
- **Cyberduck** (免费): https://cyberduck.io/
- **ForkLift** (付费): https://binarynights.com/
- **Transmit** (付费): https://panic.com/transmit/

#### 方案B：命令行工具
```bash
# 使用curl进行WebDAV操作
curl -u username:password -X PROPFIND http://localhost:8787/

# 使用davfs2 (需要安装)
brew install davfs2
```

#### 方案C：重新连接
如果遇到认证问题：
1. 断开WebDAV连接
2. 清除保存的密码（钥匙串访问）
3. 重新连接并输入凭据

### 4. 调试技巧

启用详细日志查看实际发送的凭据：
```bash
# 查看WebDAV流量
sudo tcpdump -i lo0 -A port 8787

# 或使用Charles Proxy进行调试
```

## 预防措施

1. **服务器端**：
   - 始终检查和验证凭据格式
   - 记录详细的认证日志
   - 对无效凭据返回明确的错误信息

2. **客户端端**：
   - 使用可靠的第三方WebDAV客户端
   - 定期清理保存的凭据
   - 在生产环境中测试连接稳定性

## 相关资源

- [macOS WebDAV Issues on Apple Developer Forums](https://developer.apple.com/forums/)
- [RFC 4918 - WebDAV Specification](https://tools.ietf.org/html/rfc4918)
- [HTTP Authentication: Basic and Digest Access Authentication](https://tools.ietf.org/html/rfc2617)
