# WebDAV Basic Auth 配置说明

这个WebDAV服务器现在支持Basic Auth身份验证。

## 配置方法

### 1. 本地开发环境

在 `wrangler.jsonc` 文件中取消注释并配置环境变量：

```jsonc
"vars": {
  "WEBDAV_USERNAME": "your_username",
  "WEBDAV_PASSWORD": "your_password"
}
```

### 2. 生产环境

为了安全起见，建议使用Cloudflare Workers的secrets功能来存储用户名和密码：

```bash
# 设置用户名
wrangler secret put WEBDAV_USERNAME

# 设置密码
wrangler secret put WEBDAV_PASSWORD
```

### 3. 向后兼容

如果没有设置 `WEBDAV_USERNAME` 和 `WEBDAV_PASSWORD` 环境变量，服务器将允许所有请求通过（向后兼容模式）。

## 使用方法

配置完成后，客户端需要使用Basic Auth进行连接：

- **用户名**: 您设置的 WEBDAV_USERNAME
- **密码**: 您设置的 WEBDAV_PASSWORD

### 客户端示例

#### curl
```bash
curl -u username:password https://your-worker.your-subdomain.workers.dev/
```

#### 文件管理器
大多数支持WebDAV的文件管理器（如macOS Finder、Windows资源管理器等）都会提示输入用户名和密码。

## 安全注意事项

1. 始终使用HTTPS连接
2. 在生产环境中使用secrets而不是环境变量来存储凭据
3. 定期更换密码
4. 考虑使用强密码生成器生成复杂密码
