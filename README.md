# @elizaos/plugin-discord

A Discord plugin implementation for ElizaOS, enabling rich integration with Discord servers for managing interactions, voice, and message handling.

## Features

- Handle server join events and manage initial configurations
- Voice event management via the voice manager
- Manage and process new messages with the message manager
- Slash command registration and interaction handling
- Support for Discord attachments and media files
- Voice channel join/leave functionality
- Conversation summarization
- Media transcription capabilities
- Channel state and voice state providers
- Channel restriction support (limit bot to specific channels)
- Robust permissions management for bot functionality
- Event-driven architecture with comprehensive event handling
- **Discord Activity Support** - Interactive AI assistant embedded directly in Discord channels

## Installation

As this is a workspace package, it's installed as part of the ElizaOS monorepo:

```bash
bun install
```

## Configuration

The plugin requires the following environment variables:

```bash
# Discord Bot Credentials (Required)
DISCORD_APPLICATION_ID=your_application_id  # Bot Application ID
DISCORD_API_TOKEN=your_api_token           # Bot Token

# Optional Settings
# Comma-separated list of Discord channel IDs to restrict the bot to.
# If not set, the bot operates in all channels as usual.
CHANNEL_IDS=123456789012345678,987654321098765432

# Discord Activity Settings (Optional)
# Required for Discord Activity feature
DISCORD_CLIENT_ID=your_activity_client_id    # Can be same or different from bot
DISCORD_CLIENT_SECRET=your_client_secret     # From Discord Developer Portal  
DISCORD_ACTIVITY_PORT=3002                   # Port for Activity Service API (default: 3002)
```

## Usage

```json
const character = {
   "plugins": [
      ...otherPlugins,
      "@elizaos/plugin-discord"
   ]
}
```

### Available Actions

The plugin provides the following actions:

1. **chatWithAttachments** - Handle messages with Discord attachments
2. **downloadMedia** - Download media files from Discord messages
3. **joinVoice** - Join a voice channel
4. **leaveVoice** - Leave a voice channel
5. **summarize** - Summarize conversation history
6. **transcribeMedia** - Transcribe audio/video media to text
7. **launchActivity** - Provides information about launching the Discord Activity

### Providers

The plugin includes two state providers:

1. **channelStateProvider** - Provides state information about Discord channels
2. **voiceStateProvider** - Provides state information about voice channels

### Event Types

The plugin emits the following Discord-specific events:

- `GUILD_MEMBER_ADD` - When a new member joins a guild
- `GUILD_CREATE` - When the bot joins a guild
- `MESSAGE_CREATE` - When a message is created
- `INTERACTION_CREATE` - When an interaction is created
- `REACTION_RECEIVED` - When a reaction is added to a message

## Key Components

1. **DiscordService**
   - Main service class that extends ElizaOS Service
   - Handles authentication and session management
   - Manages Discord client connection
   - Processes events and interactions

2. **MessageManager**
   - Processes incoming messages and responses
   - Handles attachments and media files
   - Supports message formatting and templating
   - Manages conversation context

3. **VoiceManager**
   - Manages voice channel interactions
   - Handles joining and leaving voice channels
   - Processes voice events and audio streams
   - Integrates with transcription services

4. **Attachment Handler**
   - Downloads and processes Discord attachments
   - Supports various media types
   - Integrates with media transcription

5. **Discord Activity Service**
   - Provides an embedded AI assistant experience within Discord
   - Runs a separate API server for Activity communication
   - Handles OAuth authentication for Activity users
   - Integrates with ElizaOS runtime for AI responses

## Discord Activity

The Discord Activity feature allows users to interact with the ElizaOS AI assistant through an embedded interface directly in Discord channels.

### Setting Up Discord Activity

1. **Enable Activities in Discord Developer Portal**:
   - Go to your app settings → Activities → Settings
   - Enable Activities for your application

2. **Configure Environment Variables**:
   ```bash
   DISCORD_CLIENT_ID=your_discord_client_id
   DISCORD_CLIENT_SECRET=your_discord_client_secret
   DISCORD_ACTIVITY_PORT=3002  # Optional, defaults to 3002
   ```

3. **Set Up URL Mappings** (for development):
   - Use a tunneling service like cloudflared or ngrok
   - Map your local development URL in Discord Developer Portal

4. **Launch the Activity**:
   - In a voice channel: Click the rocket icon (🚀)
   - In a text channel: Click the Activities button
   - Select "ElizaOS AI Assistant"

For detailed setup instructions, see `discord-activity/README.md`.

## Testing

The plugin includes a test suite (`DiscordTestSuite`) for validating functionality.

## Notes

- Ensure that your `.env` file includes the required `DISCORD_API_TOKEN` for proper functionality
- The bot requires appropriate Discord permissions to function correctly (send messages, connect to voice channels, etc.)
- If no token is provided, the plugin will load but remain non-functional with appropriate warnings
- The plugin uses Discord.js v14.18.0 with comprehensive intent support
