# Cloudflare WebDAV Server

[English](./README.md) | **简体中文**

**把你自己的 Cloudflare R2 存储桶挂载成网络盘，直接在 macOS 访达、Windows 资源管理器和 Linux 文件管理器里用。不用自己维护服务器，整个服务就是一个 Cloudflare Worker。**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bugparty/cloudflare_webdav_server)

<!--
  这里放演示 GIF：访达“连接服务器”，拖进一个文件夹，重命名一个文件，再打开它。
  保存为 docs/demo.gif，然后把这段注释换成：
  <p align="center"><img src="docs/demo.gif" alt="在 macOS 访达中挂载并复制文件" width="720"></p>
-->

Cloudflare 上的 WebDAV 服务大多用 `curl`、`litmus` 或手机 App 测试，但桌面文件管理器要挑剔得多。服务器不支持锁，访达就只读挂载；访达上传用分块传输，还到处写 `._*` 附属文件。Windows 资源管理器写文件前要先加锁，上传后还会发 `PROPPATCH`。这个项目专门处理了这些流程，测试里也逐个请求地重放了它们。

## 为什么选它

下表对比了几个开源的 Cloudflare R2 WebDAV 项目，依据是 2026-11-18 阅读各项目源码的结果（括号里是对应提交）。“否”表示在该提交里没找到相应代码，“—”表示没有核查。如有出入，欢迎指正。

| | 本项目 | [r2-webdav](https://github.com/abersheeran/r2-webdav) (`6ce5bfe`) | [Davflare](https://github.com/fanchenggang/Davflare) (`79d16fd`) | [FlareDrive](https://github.com/longern/FlareDrive) (`17e74e5`) | [CFr2-webdav](https://github.com/aigem/CFr2-webdav) (`226f150`) |
|---|---|---|---|---|---|
| 运行平台 | Workers | Workers | Pages | Pages | Workers |
| `LOCK` / `UNLOCK`（访达读写挂载必需） | 是，存在 KV 或 D1 | 是，存在 R2 元数据 | 是，存在 R2 元数据 | 否，声明 `DAV: 1` | 否，声明 `DAV: 1, 2`，但 `LOCK` 返回 405 |
| `PROPPATCH`（资源管理器会发） | 是 | 是 | 是 | 否 | 否 |
| 访达带 `X-Expected-Entity-Length` 的分块上传 | 是 | 否 | 否 | 否 | 否 |
| 访达删除不存在的 `._*` 附属文件 | 返回 `204`，“替换”能成功 | `404` | `404` | — | — |
| `PUT` 流式写入 R2，不在 Worker 内存里整体缓存 | 是（有 `Content-Length` 时） | 否 | 否 | 是 | 否 |
| 自动化测试 | 269 个测试，含访达和资源管理器的请求序列，另有远程端到端脚本 | CI 跑 litmus（basic、copymove、props、locks） | CI 跑 litmus（basic、copymove、props） | 没有 WebDAV 测试 | 无 |

**什么时候别的项目更合适：** 想在浏览器里管理文件，FlareDrive 和 Davflare 自带网页文件管理器，本项目没有。需要现成的 litmus CI 结果，r2-webdav 和 Davflare 都公开了。

## 功能

- 桌面客户端会用到的方法都支持：`OPTIONS`、`GET`、`HEAD`、`PUT`、`DELETE`、`PROPFIND`、`PROPPATCH`、`MKCOL`、`COPY`、`MOVE`、`LOCK`、`UNLOCK`。
- WebDAV 1 级和 2 级锁：锁令牌、`If` 头校验、`Depth: infinity` 的继承锁，冲突时返回 `423 Locked`。
- 文件夹递归 `COPY`、`MOVE`、`DELETE`，`Overwrite: F` 时返回 `412`。
- 按字节范围 `GET`（`206`、`416`、`If-Range`），视频和音频可以拖动进度条。
- 条件请求（`If-Match`、`If-None-Match`、`If-Modified-Since`），`PUT` 和 `PROPFIND` 返回的 R2 ETag 一致。
- 文件名可以带空格、`#`、`%`、`+`、`&` 和括号。
- 用 Workers secrets 做 Basic Auth。
- 锁可以存在 Workers KV，不想用 KV 也可以存在 D1（见 [D1 部署](./README_D1.md)）。
- 可选把请求日志写进 D1、用 Durable Object 看实时日志，同样受 Basic Auth 保护。

## 客户端支持

| 客户端 | 状态 | 怎么验证的 |
|---|---|---|
| macOS 访达 | 可读写 | 抓到的访达请求序列（[`misc/finder_handshake_dump.txt`](./misc/finder_handshake_dump.txt)）在 [`test/macos.spec.ts`](./test/macos.spec.ts) 里重放，也可以用 `npm run test:remote:finder` 对线上部署跑一遍 |
| Windows 资源管理器 | 可读写 | [`test/windows-client.spec.ts`](./test/windows-client.spec.ts) 覆盖 `LOCK` → `PUT` → `PROPFIND` → `UNLOCK` 上传流程、`PROPPATCH` 和 ETag 一致性 |
| GNOME 文件、KDE Dolphin、Thunar | 可读写 | 作者日常在用，暂无专门的自动化测试 |
| `curl` 和脚本 | 可读写 | 协议测试覆盖 |

专门为访达做的处理：

- 在认证之前就回应访达的 `OPTIONS` 探测，因为访达探测时还没带账号密码。
- 拒绝访达在弹登录框之前发的占位凭据，这样登录框才会弹出来。
- `PROPFIND` 查不存在的 `.DS_Store` 和 `._*` 时返回 `404`，访达会频繁检查这些文件。
- `DELETE` 不存在的 `._*` 文件按成功处理，覆盖已有文件时“替换”不会失败。
- 接受带 `X-Expected-Entity-Length` 的分块上传，并校验长度。

## 快速开始

### 一键部署

1. 点上面的 **Deploy to Cloudflare**，按提示完成部署。
2. 正式使用前先设置账号密码。不设置的话，服务器会放行所有请求。

   ```bash
   npx wrangler secret put WEBDAV_USERNAME
   npx wrangler secret put WEBDAV_PASSWORD
   ```

3. 用客户端连接 `https://your-worker.your-subdomain.workers.dev/`。

### 手动部署

```bash
npm install
npx wrangler login
```

创建下面这些资源，把名字和 ID 填进 `wrangler.jsonc`：

- R2 存储桶，绑定名 `BUCKET`（必需）
- KV 命名空间，绑定名 `LOCKS`（必需）
- D1 数据库，绑定名 `DB`（可选，请求日志）
- Durable Object，绑定名 `LOG_DO`（可选，实时日志）

设置上面那两个 secret，然后部署：

```bash
npm run deploy
```

想把锁存在 D1 而不是 KV，看 [README_D1.md](./README_D1.md)。这个入口在两个凭据都设置好之前会返回 `503`，拒绝所有请求。

## 连接客户端

### macOS 访达

1. 在访达里按 `Cmd + K`（前往 → 连接服务器）。
2. 输入 `https://your-worker.your-subdomain.workers.dev/`。
3. 用 WebDAV 用户名和密码登录。

### Windows 资源管理器

1. 右键 **此电脑**，选择 **映射网络驱动器**。
2. 输入 `https://your-worker.your-subdomain.workers.dev/`。
3. 勾选 **使用其他凭据连接**，然后登录。

也可以用命令提示符：

```cmd
net use * https://your-worker.your-subdomain.workers.dev/ /user:USERNAME PASSWORD
```

### Linux 文件管理器

GNOME 文件、Dolphin 和 Thunar 通过 GVfs 或 KIO 连接。用文件管理器接受的那种地址：

```text
davs://your-worker.your-subdomain.workers.dev/
https://your-worker.your-subdomain.workers.dev/
```

### 命令行

```bash
# 列出根目录
curl -u user:pass -X PROPFIND -H 'Depth: 1' https://your-worker.your-subdomain.workers.dev/
# 上传
curl -u user:pass -T local.txt https://your-worker.your-subdomain.workers.dev/remote.txt
# 下载
curl -u user:pass -o local.txt https://your-worker.your-subdomain.workers.dev/remote.txt
# 新建文件夹
curl -u user:pass -X MKCOL https://your-worker.your-subdomain.workers.dev/new-folder/
# 删除
curl -u user:pass -X DELETE https://your-worker.your-subdomain.workers.dev/remote.txt
```

更多例子见 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md)。

## 费用

个人使用一般在 Cloudflare Workers、R2 和 KV 的免费额度内。具体额度以 Cloudflare 当前的价格页面为准。

## 常见问题

**访达只读挂载。** 服务器支持锁，访达才会读写挂载。检查 `LOCKS` KV 命名空间（或 D1 锁表）是否已绑定，然后断开重连。

**访达反复要密码。** 确认线上 Worker 已经把 `WEBDAV_USERNAME` 和 `WEBDAV_PASSWORD` 都设成了 secret。

**Windows 提示文件夹无效，或者上传卡在 50 MB 左右。** Windows 的 WebClient 服务必须在运行，而且 Windows 用注册表项 `FileSizeLimitInBytes` 限制 WebDAV 文件大小（默认约 50 MB）。重启服务可以清掉缓存的失败状态：

```cmd
net stop webclient
net start webclient
```

**超大文件上传失败。** Cloudflare 按套餐限制请求体大小，见 Workers 的 limits 页面。

**文件很多的文件夹比较慢。** R2 是对象存储，列目录、移动、删除文件夹都要处理该前缀下的每个对象。

## 工作原理

```text
WebDAV 客户端（访达、资源管理器、GVfs、curl）
    │  HTTPS + Basic Auth
    ▼
Cloudflare Worker
    ├── R2 存储桶 ........ 文件内容；文件夹是 key 前缀，可带以 "/" 结尾的标记对象
    ├── KV 或 D1 ......... 带过期时间的锁令牌
    ├── D1 ............... 可选的持久化请求日志
    └── Durable Object ... 可选的实时日志流
```

调试接口在 `/_debug` 下（`/_debug/http-log`、`/_debug/write-log`、`/_debug/d1-logs`、`/_debug/do-logs`、`/_debug/all-logs`、`/_debug/live-log`）。它们会显示请求路径，所以和 WebDAV 用同一套账号密码。

## 开发和测试

```bash
npm run dev            # 本地服务，端口 8080
npm test -- --run      # 完整测试（KV 入口）
npm run test:d1        # D1 入口，使用本地真实 R2 和 D1
```

对线上部署跑访达流程和文件夹移动流程。每个脚本都在自己的临时文件夹里操作，跑完会删掉（设置 `WEBDAV_REMOTE_KEEP=1` 可保留）：

```bash
WEBDAV_REMOTE_URL=https://your-worker.your-subdomain.workers.dev/ \
WEBDAV_REMOTE_USER=username \
WEBDAV_REMOTE_PASS=password \
npm run test:remote:finder

WEBDAV_REMOTE_URL=https://your-worker.your-subdomain.workers.dev/ \
WEBDAV_REMOTE_USER=username \
WEBDAV_REMOTE_PASS=password \
npm run test:remote:folder-move
```

## 更多文档

- [认证配置](./README_AUTH.md)
- [仅用 D1 部署](./README_D1.md)
- [使用示例](./USAGE_EXAMPLES.md)
- [macOS 访达兼容说明](./mac-compatibility-plan.md)
- [Windows 资源管理器兼容说明](./window-compatibility-plan.md)

## 参与贡献

欢迎提 issue 和 PR，特别是上表之外的 WebDAV 客户端的使用反馈。客户端出问题时，紧接着导出 `/_debug/http-log` 的请求日志附上，最有助于定位。
