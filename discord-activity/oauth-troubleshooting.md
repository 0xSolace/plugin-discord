# Discord Activity OAuth2 Troubleshooting Guide

## Common OAuth2 Error: "Missing redirect_uri"

If you're seeing this error when trying to authenticate in your Discord Activity, it means the OAuth2 configuration needs to be properly set up.

### Solution:

1. **In Discord Developer Portal:**
   - Go to https://discord.com/developers/applications
   - Select your Discord application
   - Navigate to **OAuth2** → **General**
   - Add this redirect URI: `https://127.0.0.1`
   - Click "Save Changes"

   ![Important: The redirect URI must be exactly `https://127.0.0.1`]

2. **Verify Your Credentials:**
   - Ensure your `.env` file contains:
     ```
     DISCORD_CLIENT_ID=your_client_id_here
     DISCORD_CLIENT_SECRET=your_client_secret_here
     ```
   - The Client Secret is found in OAuth2 → General (you may need to reset it)

3. **Activity Settings:**
   - Go to **Activities** → **Settings**
   - Ensure "Activities" is enabled
   - Save any changes

### How Discord Activities OAuth2 Works:

Unlike standard Discord OAuth2 flows, Activities use a simplified flow:
1. The Discord SDK calls `authorize()` to get an authorization code
2. Your server exchanges this code for an access token
3. The redirect URI (`https://127.0.0.1`) is used internally by Discord

### Still Having Issues?

- **Clear Discord Cache**: Ctrl+R (Windows/Linux) or Cmd+R (Mac) in Discord
- **Check Server Logs**: Look for errors in the server console
- **Verify Cloudflare/ngrok URL**: Ensure your tunnel URL is correctly mapped in Discord

### OAuth2 Flow Diagram:
```
Discord Activity → Discord SDK → authorize() → Authorization Code
                                                       ↓
                                              Backend Server
                                                       ↓
                                          Discord OAuth2 API
                                           (with redirect_uri)
                                                       ↓
                                               Access Token
```

Remember: The redirect URI in your code MUST match exactly what's configured in the Discord Developer Portal!

## Common OAuth2 Error: "invalid_scope"

If you see this error, it means you're requesting OAuth2 scopes that aren't available for Discord Activities.

### Valid Scopes for Discord Activities:
- `identify` - Get basic user information
- `guilds` - Access user's guild list  
- `guilds.members.read` - Read guild member information

### Invalid Scopes (will cause errors):
- `applications.commands` - Not available for Activities
- `voice` - Voice features work differently in Activities
- `rpc.voice.read` - RPC scopes not available for Activities
- `bot` - Bot scope not used in Activities

### Voice Features in Activities:
Voice features in Discord Activities are handled through the Discord SDK's voice capabilities, not through OAuth2 scopes. The SDK provides voice functionality without requiring voice-related OAuth2 scopes.