# WebDAV Basic Auth Setup

This WebDAV server now supports Basic Auth authentication.

## Configuration

### 1. Local development

Uncomment and configure the environment variables in `wrangler.jsonc`:

```jsonc
"vars": {
  "WEBDAV_USERNAME": "your_username",
  "WEBDAV_PASSWORD": "your_password"
}
```

### 2. Production

For security, use Cloudflare Workers secrets to store the username and password:

```bash
# Set username
wrangler secret put WEBDAV_USERNAME

# Set password
wrangler secret put WEBDAV_PASSWORD
```

### 3. Backward compatibility

If `WEBDAV_USERNAME` and `WEBDAV_PASSWORD` are not set, the server will allow all requests through for backward compatibility.

## Usage

After configuration, clients must connect using Basic Auth:

- **Username**: the `WEBDAV_USERNAME` you set
- **Password**: the `WEBDAV_PASSWORD` you set

### Client examples

#### curl
```bash
curl -u username:password https://your-worker.your-subdomain.workers.dev/
```

#### File managers
Most WebDAV-capable file managers, such as macOS Finder and Windows Explorer, will prompt for a username and password.

## Security notes

1. Always use HTTPS.
2. Use secrets rather than environment variables to store credentials in production.
3. Rotate passwords regularly.
4. Consider using a password generator to create strong passwords.
