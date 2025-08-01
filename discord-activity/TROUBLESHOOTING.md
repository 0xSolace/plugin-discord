# Discord Activity Troubleshooting Guide

## Common Issues

### 1. 500 Error on /api/connect

**Error Message:**
```
POST https://[discord-activity-url]/.proxy/api/connect 500 (Internal Server Error)
```

**Causes and Solutions:**

#### Server Not Running
- **Check:** Run `lsof -i :3001` to see if the server is running
- **Fix:** Start the server with:
  ```bash
  cd discord-activity/server
  npm start
  ```

#### Port Already in Use
- **Error:** `Error: listen EADDRINUSE: address already in use :::3001`
- **Fix:** Kill the process using the port:
  ```bash
  lsof -ti:3001 | xargs kill -9
  ```

#### ElizaOS Backend Not Running
- **Check:** Verify ElizaOS is running on port 3000
- **Test:** `curl http://localhost:3000/api/agents`
- **Fix:** Start ElizaOS backend first

### 2. API Response Format Issues

The server expects specific response formats from ElizaOS:
- Agents: `{ success: true, data: { agents: [...] } }`
- Servers: `{ success: true, data: { servers: [...] } }`
- Channels: Response should contain channel object with `id` field

### 3. Debugging Steps

1. **Check Server Logs:**
   ```bash
   cd discord-activity/server
   tail -f server.log
   ```

2. **Test API Endpoints:**
   ```bash
   # Test health
   curl http://localhost:3001/api/health
   
   # Test ElizaOS endpoints
   curl http://localhost:3000/api/agents
   curl http://localhost:3000/api/messaging/central-servers
   ```

3. **Enable Verbose Logging:**
   The server includes detailed logging for the connect flow. Check console output for:
   - Agent fetching status
   - Server selection
   - Channel creation
   - Agent assignment

### 4. Server Startup Script

For reliable server startup:
```bash
#!/bin/bash
# Kill any existing process on port 3001
lsof -ti:3001 | xargs kill -9 2>/dev/null || true

# Wait a moment
sleep 1

# Start the server
cd discord-activity/server
npm start
```

### 5. Environment Variables

Ensure these are set in your `.env` file:
- `DISCORD_CLIENT_ID` - Your Discord app client ID
- `DISCORD_CLIENT_SECRET` - Your Discord app client secret  
- `ELIZAOS_API_URL` - ElizaOS API URL (default: http://localhost:3000)

The server checks multiple locations for `.env`:
1. `discord-activity/.env`
2. `plugin-discord/.env`
3. `eliza/.env`
4. `~/.eliza/.env`
5. Current working directory