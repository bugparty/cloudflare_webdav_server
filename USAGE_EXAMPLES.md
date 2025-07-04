# WebDAV Basic Auth 使用示例

## 配置步骤

### 1. 配置生产环境认证（推荐）

```bash
# 设置用户名
wrangler secret put WEBDAV_USERNAME
# 输入: myusername

# 设置密码
wrangler secret put WEBDAV_PASSWORD
# 输入: mysecurepassword
```

### 2. 配置开发环境认证

在 `wrangler.jsonc` 文件中：

```jsonc
{
  // ... 其他配置
  "vars": {
    "WEBDAV_USERNAME": "testuser",
    "WEBDAV_PASSWORD": "testpass"
  }
}
```

## 客户端连接示例

### macOS Finder

1. 打开 Finder
2. 按 `Cmd + K` 或选择 "前往" > "连接服务器"
3. 输入服务器地址：`https://your-worker.your-subdomain.workers.dev`
4. 输入用户名和密码

### Windows 资源管理器

1. 打开资源管理器
2. 右键点击 "此电脑" > "映射网络驱动器"
3. 选择驱动器号
4. 输入文件夹路径：`https://your-worker.your-subdomain.workers.dev`
5. 勾选 "使用其他凭据连接"
6. 输入用户名和密码

### curl 命令行

```bash
# 列出根目录
curl -u myusername:mysecurepassword -X PROPFIND https://your-worker.your-subdomain.workers.dev/

# 上传文件
curl -u myusername:mysecurepassword -T local-file.txt https://your-worker.your-subdomain.workers.dev/remote-file.txt

# 下载文件
curl -u myusername:mysecurepassword https://your-worker.your-subdomain.workers.dev/remote-file.txt -o downloaded-file.txt

# 创建目录
curl -u myusername:mysecurepassword -X MKCOL https://your-worker.your-subdomain.workers.dev/new-folder/

# 删除文件
curl -u myusername:mysecurepassword -X DELETE https://your-worker.your-subdomain.workers.dev/file-to-delete.txt
```

### Python 示例

```python
import requests
from requests.auth import HTTPBasicAuth

# 配置
webdav_url = "https://your-worker.your-subdomain.workers.dev"
username = "myusername"
password = "mysecurepassword"
auth = HTTPBasicAuth(username, password)

# 上传文件
with open('local-file.txt', 'rb') as f:
    response = requests.put(f"{webdav_url}/remote-file.txt", data=f, auth=auth)
    print(f"Upload status: {response.status_code}")

# 下载文件
response = requests.get(f"{webdav_url}/remote-file.txt", auth=auth)
if response.status_code == 200:
    with open('downloaded-file.txt', 'wb') as f:
        f.write(response.content)
```

## 测试部署

```bash
# 部署到开发环境
npm run deploy

# 测试连接
curl -u testuser:testpass -X OPTIONS https://your-worker.your-subdomain.workers.dev/
```

## 安全提示

1. 始终使用HTTPS连接
2. 使用强密码
3. 定期更换密码
4. 不要在代码中硬编码密码
5. 在生产环境中使用 Cloudflare Workers secrets
