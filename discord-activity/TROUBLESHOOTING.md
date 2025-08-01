# Discord Activity Troubleshooting Guide

## Common Issues and Solutions

### 1. Activity Won't Load

**Symptoms:**
- Clicking the activity doesn't open anything
- Blank screen or loading spinner

**Solutions:**
- Ensure Activities are enabled in Discord Developer Portal
- Verify redirect URI is exactly `https://127.0.0.1`
- Check that the Discord Activity server is running on port 3001
- Try refreshing Discord (Ctrl+R)

### 2. "Failed to connect to ElizaOS"

**Symptoms:**
- Error message about ElizaOS connection
- Can't send messages

**Solutions:**
- Verify ElizaOS is running (default: http://localhost:3000)
- Check ELIZAOS_API_URL in your .env file
- Ensure no firewall is blocking port 3000
- Try accessing http://localhost:3000/api/agents in your browser

### 3. "No agents available"

**Symptoms:**
- Connection successful but no agents listed
- Can't start a conversation

**Solutions:**
- Ensure at least one agent is configured in ElizaOS
- Check ElizaOS logs for agent initialization
- Restart ElizaOS and verify agents load properly

### 4. OAuth2 Errors

**Symptoms:**
- "Invalid redirect URI" error
- Authentication fails

**Solutions:**
- Redirect URI must be exactly `https://127.0.0.1` (not http, not localhost)
- Save changes in Discord Developer Portal after adding redirect URI
- Clear Discord cache and cookies
- Regenerate client secret if needed

### 5. Messages Not Sending

**Symptoms:**
- Type message but nothing happens
- No response from agent

**Solutions:**
- Check browser console for errors (F12)
- Verify session is created (check server logs)
- Ensure ElizaOS agent is not overloaded
- Try creating a new session (refresh the activity)

## Debugging Steps

### 1. Check Server Logs

```bash
# Discord Activity server
tail -f server/console.log

# ElizaOS server
# Check the terminal where ElizaOS is running
```

### 2. Test ElizaOS API

```bash
# Test if ElizaOS is accessible
curl http://localhost:3000/api/agents

# Should return a list of agents
```

### 3. Browser Developer Tools

1. Open Discord Developer Tools (Ctrl+Shift+I)
2. Go to Console tab
3. Look for red error messages
4. Check Network tab for failed requests

### 4. Session Management

Sessions timeout after 30 minutes of inactivity. If you experience issues:
- Refresh the Discord Activity
- This creates a new session

## Environment Variables

Ensure your `.env` file has correct values:

```env
DISCORD_CLIENT_ID=123456789012345678
DISCORD_CLIENT_SECRET=your-secret-here
ELIZAOS_API_URL=http://localhost:3000
PORT=3001
```

## Port Conflicts

If port 3001 is in use:
1. Change PORT in .env file
2. Update any hardcoded references
3. Restart the server

## HTTPS Requirements

Discord Activities require HTTPS. For local development:

1. Use ngrok:
   ```bash
   ./start-with-ngrok.sh
   ```

2. Or use Cloudflare Tunnel:
   ```bash
   ./start-with-cloudflared.sh
   ```

## Getting Help

If issues persist:
1. Check ElizaOS documentation
2. Review server logs for detailed errors
3. Open an issue with:
   - Error messages
   - Steps to reproduce
   - Environment details