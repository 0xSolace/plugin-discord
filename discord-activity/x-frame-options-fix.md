# X-Frame-Options Discord Activity Fix

## Problem
You may encounter this error when trying to launch your Discord Activity:
```
Refused to display 'https://1370482945965428766.discordsays.com/' in a frame because it set 'X-Frame-Options' to 'sameorigin'.
```

## Solution

The Discord Activity server and client are already configured to handle this issue. The configurations include:

### 1. Server Headers (server/server.js)
```javascript
// Critical: Allow embedding in Discord's iframe
res.setHeader('X-Frame-Options', 'ALLOWALL');

// Set permissive CSP for Discord Activity
res.setHeader('Content-Security-Policy', 
  "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
  "frame-ancestors *; " +
  "connect-src *; " +
  "img-src * data: blob:; " +
  "media-src * data: blob:; " +
  "script-src * 'unsafe-inline' 'unsafe-eval'; " +
  "style-src * 'unsafe-inline';"
);
```

### 2. Vite Config Headers (client/vite.config.js)
```javascript
headers: {
  'X-Frame-Options': 'ALLOWALL',
  'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
}
```

## Common Causes & Solutions

### 1. Server Not Restarted
If you see this error after updating the code, restart both servers:
```bash
# Kill existing processes
cd discord-activity
./stop.sh

# Start fresh
./start.sh
```

### 2. Browser Cache
Discord might cache the headers. Try:
- Hard refresh (Ctrl+Shift+R or Cmd+Shift+R)
- Clear Discord's cache
- Try in Discord's incognito/private mode

### 3. Reverse Proxy Issues
If using ngrok or cloudflared, they might add their own headers. The current configuration should handle this, but if issues persist:
- Make sure you're using the latest tunnel URLs
- Check if your tunnel service is adding security headers

### 4. Discord's Proxy
Discord proxies activities through their `discordsays.com` domain. If Discord's proxy adds restrictive headers, try:
- Refreshing the activity
- Reloading Discord
- Waiting a few minutes for Discord's cache to clear

## Testing Headers

To verify headers are set correctly:
```bash
# Test local server
curl -I http://localhost:3001 | grep -E "X-Frame-Options|Content-Security-Policy"

# Test through tunnel (replace with your tunnel URL)
curl -I https://your-tunnel-url.trycloudflare.com | grep -E "X-Frame-Options|Content-Security-Policy"
```

You should see:
```
X-Frame-Options: ALLOWALL
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *; ...
```

## Security Note

The permissive headers are necessary for Discord Activities to work properly. In production, you should:
1. Use more restrictive CSP policies where possible
2. Only allow specific Discord domains
3. Consider implementing proper authentication

## If Problems Persist

1. Check Discord's developer console (F12) for specific error messages
2. Verify your Discord application settings allow activities
3. Ensure your activity URL is correctly configured in Discord's developer portal
4. Try launching from a different Discord client (web vs desktop)

The current configuration should work for most cases. If you continue to see X-Frame-Options errors, it's likely a caching issue that will resolve itself.