# Discord Activity for ElizaOS

This Discord Activity brings the power of ElizaOS AI assistants directly into Discord channels through an interactive, embedded experience.

## Features

- **AI Chat Interface**: Natural conversation with ElizaOS agents directly in Discord
- **Voice Integration**: Join voice channels and interact with the AI through voice (in development)
- **Context Awareness**: The AI understands the current channel, server, and user context
- **Real-time Responses**: Fast responses with clean UI
- **Beautiful UI**: Discord-themed interface that feels native to the platform

## Prerequisites

- Discord Application with Activities enabled
- Node.js 18+ and npm
- ElizaOS instance running with the Sessions API

## Quick Start

Run the setup script from the discord-activity directory:
```bash
./setup.sh
```

This will check your environment, install dependencies, and provide instructions.

## Manual Setup

### 1. Discord Application Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application or select an existing one
3. Note down your **Client ID** and **Client Secret**
4. **IMPORTANT**: Go to OAuth2 → General → Add a Redirect URI: `https://127.0.0.1`
   - This MUST be exactly `https://127.0.0.1` for Activities to work
   - Click "Save Changes" after adding
5. Go to Activities → Settings → Enable Activities

### 2. Environment Configuration

Create a `.env` file in the discord-activity directory:
```env
# Discord Configuration
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here

# ElizaOS Configuration (optional - defaults to localhost:3000)
ELIZAOS_API_URL=http://localhost:3000
```

### 3. Install Dependencies

```bash
# Server dependencies
cd server
npm install

# Client dependencies
cd ../client
npm install
npm run build
```

### 4. Start the Services

#### Option 1: Using start script (recommended)
```bash
./start.sh
```

#### Option 2: Manual start
```bash
# Terminal 1: Start ElizaOS
cd /path/to/elizaos
npm start

# Terminal 2: Start Discord Activity Server
cd discord-activity/server
npm start

# The server runs on port 3001 by default
```

### 5. Access the Activity

1. Join a Discord server where you have permissions
2. Click the Activities button (rocket icon) in the voice channel
3. Select your application from the list
4. The activity will load in an embedded iframe

## Architecture

The Discord Activity consists of:

1. **Client**: React-based UI that runs in Discord's embedded iframe
2. **Server**: Express server that handles:
   - Discord OAuth2 authentication
   - Communication with ElizaOS via the Sessions API
   - Session management

### Sessions API Integration

The Discord Activity uses ElizaOS's Sessions API for simplified messaging:

```javascript
// 1. Create a session when user connects
POST /api/messaging/sessions
{
  "agentId": "agent-uuid",
  "userId": "discord-user-id",
  "metadata": {
    "platform": "discord-activity",
    "username": "discord-username"
  }
}

// 2. Send messages
POST /api/messaging/sessions/:sessionId/messages
{
  "content": "Hello, AI!"
}

// 3. Poll for responses
GET /api/messaging/sessions/:sessionId/messages?after=timestamp
```

## Development

### Local Development with HTTPS

Discord Activities require HTTPS. Use one of these methods:

#### Option 1: ngrok (recommended for development)
```bash
./start-with-ngrok.sh
```

#### Option 2: Cloudflare Tunnel
```bash
./start-with-cloudflared.sh
```

### Debugging

1. Check server logs:
   ```bash
   # Discord Activity server logs
   tail -f server/server.log
   
   # ElizaOS logs
   # Check the ElizaOS console output
   ```

2. Browser Console:
   - Open Discord Developer Tools (Ctrl+Shift+I)
   - Check for errors in the Console tab

3. Common Issues:
   - **"Failed to connect to ElizaOS"**: Ensure ElizaOS is running and accessible
   - **"No agents available"**: Make sure at least one agent is configured in ElizaOS
   - **OAuth errors**: Verify your redirect URI is exactly `https://127.0.0.1`

## Configuration

### Server Configuration

The server can be configured via environment variables:

- `PORT`: Server port (default: 3001)
- `ELIZAOS_API_URL`: ElizaOS API URL (default: http://localhost:3000)
- `DISCORD_CLIENT_ID`: Your Discord application's client ID
- `DISCORD_CLIENT_SECRET`: Your Discord application's client secret

### Client Configuration

The client is configured at build time. To change settings:

1. Edit `client/src/config.js`
2. Rebuild the client: `npm run build`

## Scripts

- `./setup.sh` - Initial setup and dependency installation
- `./start.sh` - Start the Discord Activity server
- `./stop.sh` - Stop all Discord Activity processes
- `./check-status.sh` - Check if services are running
- `./start-with-ngrok.sh` - Start with ngrok for HTTPS
- `./start-with-cloudflared.sh` - Start with Cloudflare Tunnel

## Troubleshooting

### Activity Won't Load
1. Ensure Activities are enabled in your Discord application
2. Verify the redirect URI is set correctly
3. Check that the server is running and accessible

### Connection Issues
1. Verify ElizaOS is running
2. Check the ELIZAOS_API_URL in your .env file
3. Ensure no firewall is blocking the connections

### Authentication Errors
1. Double-check your Discord Client ID and Secret
2. Ensure the redirect URI matches exactly
3. Try clearing Discord's cache

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is part of ElizaOS and follows the same license terms.