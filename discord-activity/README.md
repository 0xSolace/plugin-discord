# Discord Activity for ElizaOS

This Discord Activity brings the power of ElizaOS AI assistants directly into Discord channels through an interactive, embedded experience.

**Note**: The Discord Activity now uses the new ElizaOS Simple Messaging API for cleaner integration. To use it:

1. **Rebuild ElizaOS** with the new Simple API (see `simple-api-guide.md`)
2. **Start ElizaOS** with at least one agent
3. **Run Discord Activity** - it will automatically use the Simple API

If you're using an older version of ElizaOS without the Simple API, the Activity will show a connection error. See:
- `simple-api-guide.md` - Setup instructions
- `simple-api-debugging.md` - Troubleshooting timeouts and debugging

## Features

- **AI Chat Interface**: Natural conversation with ElizaOS agents directly in Discord
- **Voice Integration**: Join voice channels and interact with the AI through voice (in development)
- **Context Awareness**: The AI understands the current channel, server, and user context
- **Real-time Responses**: Streaming responses with typing indicators
- **Beautiful UI**: Discord-themed interface that feels native to the platform

## Prerequisites

- Discord Application with Activities enabled
- Node.js 18+ and npm/bun
- ElizaOS instance running (for full integration)

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

Copy the example environment file and fill in your credentials:

```bash
cp env.example .env
```

Edit `.env`:
```env
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
```

### 3. Install Dependencies

```bash
# Install client dependencies
cd client
npm install

# Install server dependencies
cd ../server
npm install
```

### 4. Run the Activity

Start both the client and server:

```bash
# Terminal 1: Start the client
cd client
npm run dev

# Terminal 2: Start the server
cd server
npm run dev
```

### 5. Create a Public Tunnel

For local development, you need a public URL. We recommend using Cloudflared to avoid CSP issues:

**Option A: Cloudflared (Recommended)**
```bash
# Use the provided script
./start-with-cloudflared.sh

# Or run manually
cloudflared tunnel --url http://localhost:5173
```

**Option B: ngrok**
```bash
# Note: ngrok's free tier may have CSP compatibility issues with Discord
ngrok http 5173
```

Copy the generated URL (e.g., `https://example.trycloudflare.com`)

### 6. Configure URL Mapping

In Discord Developer Portal:
1. Go to Activities → URL Mappings
2. Add mapping: `/` → `your-tunnel-url.trycloudflare.com`

### 7. Test the Activity

1. Join a voice or text channel in your Discord server
2. Click the Activities button (rocket icon)
3. Select your activity
4. Start chatting with ElizaOS!

## Development

### Project Structure

```
discord-activity/
├── client/              # Frontend React application
│   ├── src/
│   ├── index.html
│   ├── main.js         # Main application logic
│   ├── style.css       # Discord-themed styles
│   └── package.json
├── server/             # Backend Express server
│   ├── server.js       # OAuth and API endpoints
│   └── package.json
└── README.md
```

### Key Components

#### Client (`main.js`)
- **ElizaActivityClient**: Main class handling Discord SDK integration
- **Authentication**: OAuth2 flow with Discord
- **UI Rendering**: Dynamic message display and input handling
- **Voice Features**: Voice channel integration (in development)

#### Server (`server.js`)
- **OAuth Endpoint**: `/api/token` - Exchanges Discord auth code for access token
- **Connection Endpoint**: `/api/connect` - Establishes ElizaOS session
- **Chat Endpoint**: `/api/chat` - Processes messages through ElizaOS
- **Health Check**: `/api/health` - Monitor server status

### Customization

#### Styling
Modify `client/style.css` to customize the appearance. The design uses CSS variables for easy theming:

```css
:root {
  --discord-primary: #5865F2;
  --discord-bg-primary: #313338;
  /* ... more variables */
}
```

#### AI Responses
Update the `generateAIResponse` function in `server/server.js` to integrate with your actual ElizaOS instance:

```javascript
async function generateAIResponse(message, context) {
  // Replace with actual ElizaOS API call
  const response = await fetch(`${process.env.ELIZAOS_API_URL}/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ELIZAOS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, context })
  });
  
  return response.json();
}
```

## Voice Features (Coming Soon)

The activity includes placeholder code for voice interactions:
- Voice channel join/leave
- Voice activity detection
- Real-time transcription
- AI voice responses

These features will be fully implemented once the Discord Embedded App SDK adds complete voice support.

## Security Considerations

- Never expose your `DISCORD_CLIENT_SECRET`
- Use environment variables for all sensitive data
- Implement rate limiting in production
- Validate all user inputs
- Use HTTPS for all external communications

## Troubleshooting

### X-Frame-Options Error
If you see "Refused to display in a frame because it set 'X-Frame-Options' to 'sameorigin'":
- The servers are configured to allow Discord iframe embedding
- Restart both servers: `./stop.sh` then `./start.sh`
- Clear Discord's cache or try refreshing the activity
- See `x-frame-options-fix.md` for detailed solutions

### "frame_id query param is not defined" Error
This error occurs when trying to access the activity directly in a browser (http://localhost:5173).
- Discord Activities MUST be launched from within Discord
- You cannot test by opening the URL directly
- See `testing-guide.html` for proper testing instructions

### Activity Won't Load
- Ensure Activities are enabled in Discord Developer Portal
- Check that URL mappings are correctly configured
- Verify your tunnel is running and accessible

### Authentication Fails
- Confirm Client ID and Secret are correct
- Check OAuth2 redirect URI matches exactly
- Ensure all required scopes are included

### Connection Issues
- Verify both client and server are running
- Check browser console for errors
- Ensure CORS is properly configured

### Discord Credentials Not Found
- The server automatically searches for `.env` files in multiple locations
- Check server logs to see which locations were checked
- Recommended: Place credentials in your main `eliza/.env` file

### CSP Errors with ngrok
If you see Content Security Policy errors when using ngrok:
- This is due to ngrok's interstitial page on the free tier
- Solution 1: Use Cloudflared instead (`./start-with-cloudflared.sh`)
- Solution 2: Upgrade to ngrok paid plan to disable interstitial
- Solution 3: Restart the servers - we've added headers to help bypass this

## Contributing

To contribute to the Discord Activity:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

This Discord Activity is part of the ElizaOS project and follows the same license terms. 