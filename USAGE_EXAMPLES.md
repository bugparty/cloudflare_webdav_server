# WebDAV Basic Auth Usage Examples

## Setup steps

### 1. Configure production authentication

```bash
# Set username
wrangler secret put WEBDAV_USERNAME
# Input: myusername

# Set password
wrangler secret put WEBDAV_PASSWORD
# Input: mysecurepassword
```

### 2. Configure development authentication

In `wrangler.jsonc`:

```jsonc
{
  // ... other config
  "vars": {
    "WEBDAV_USERNAME": "testuser",
    "WEBDAV_PASSWORD": "testpass"
  }
}
```

## Client connection examples

### macOS Finder

1. Open Finder
2. Press `Cmd + K` or choose "Go" > "Connect to Server"
3. Enter the server address: `https://your-worker.your-subdomain.workers.dev`
4. Enter the username and password

### Windows File Explorer

1. Open File Explorer
2. Right-click "This PC" > "Map network drive"
3. Choose a drive letter
4. Enter the folder path: `https://your-worker.your-subdomain.workers.dev`
5. Check "Connect using different credentials"
6. Enter the username and password

### curl command line

```bash
# List the root directory
curl -u myusername:mysecurepassword -X PROPFIND https://your-worker.your-subdomain.workers.dev/

# Upload a file
curl -u myusername:mysecurepassword -T local-file.txt https://your-worker.your-subdomain.workers.dev/remote-file.txt

# Download a file
curl -u myusername:mysecurepassword https://your-worker.your-subdomain.workers.dev/remote-file.txt -o downloaded-file.txt

# Create a directory
curl -u myusername:mysecurepassword -X MKCOL https://your-worker.your-subdomain.workers.dev/new-folder/

# Delete a file
curl -u myusername:mysecurepassword -X DELETE https://your-worker.your-subdomain.workers.dev/file-to-delete.txt
```

### Python example

```python
import requests
from requests.auth import HTTPBasicAuth

# Configuration
webdav_url = "https://your-worker.your-subdomain.workers.dev"
username = "myusername"
password = "mysecurepassword"
auth = HTTPBasicAuth(username, password)

# Upload a file
with open('local-file.txt', 'rb') as f:
    response = requests.put(f"{webdav_url}/remote-file.txt", data=f, auth=auth)
    print(f"Upload status: {response.status_code}")

# Download a file
response = requests.get(f"{webdav_url}/remote-file.txt", auth=auth)
if response.status_code == 200:
    with open('downloaded-file.txt', 'wb') as f:
        f.write(response.content)
```

## Test deployment

```bash
# Deploy to the development environment
npm run deploy

# Test the connection
curl -u testuser:testpass -X OPTIONS https://your-worker.your-subdomain.workers.dev/
```

## Security notes

1. Always use HTTPS.
2. Use strong passwords.
3. Rotate passwords regularly.
4. Do not hardcode passwords in code.
5. Use Cloudflare Workers secrets in production.
