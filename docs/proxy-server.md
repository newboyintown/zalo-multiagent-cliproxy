# Local Proxy Server & WebUI

The `zalo-agent-cli` features a built-in proxy server that allows you to manage multiple accounts simultaneously and forward messages to them via standard HTTP requests.

## Start the server

To launch the multi-account server with WebUI:

```bash
zalo-agent server -p 3000 --webhook http://localhost:8080/my-webhook
```

### Options:
- `-p, --port <port>`: The local HTTP port to run the Express proxy server on (default: 3000).
- `--webhook <url>`: A URL where the proxy will POST incoming events (`message`, `friend_event`, `group_event`, `reaction`) from **all** connected accounts.

## WebUI

Once running, navigate to `http://localhost:3000` in your web browser.
The WebUI allows you to:
1. View a list of all currently registered and actively connected accounts.
2. Click **Add Account** to open a QR code modal.
3. Scan the QR code to instantly link a new account without stopping the server.

## REST API Integration

The proxy exposes several endpoints to seamlessly interact with your scripts.

### 1. `POST /api/invoke`
This is a powerful reflection endpoint. You can dynamically call **any** method available on the underlying `zca-js` API instance of a specific account.

**Payload:**
```json
{
    "accountId": "YOUR_ZALO_OWNER_ID",
    "method": "sendMessage",
    "args": ["Hello world!", "TARGET_THREAD_ID", 0]
}
```

**Example sending an image:**
```json
{
    "accountId": "YOUR_ZALO_OWNER_ID",
    "method": "sendImage",
    "args": ["/path/to/image.jpg", "TARGET_THREAD_ID", 0]
}
```

### 2. `GET /api/accounts`
Returns an array of all known accounts, showing their `ownId`, display name, configured proxy URL, and their current live `connected` status.

### 3. `DELETE /api/accounts/:id`
Disconnects and removes the specific account and its saved credentials entirely.
