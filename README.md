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

## Installation

As this is a workspace package, it's installed as part of the ElizaOS monorepo:

```bash
bun install
```

## Configuration

The plugin requires the following environment variables:

```bash
# Discord API Credentials (Required)
DISCORD_APPLICATION_ID=your_application_id
DISCORD_API_TOKEN=your_api_token

# Optional Settings
# Comma-separated list of Discord channel IDs to restrict the bot to.
# If not set, the bot operates in all channels as usual.
CHANNEL_IDS=123456789012345678,987654321098765432
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

## Slash Command Permissions

The plugin uses a hybrid permission system that combines Discord's native features with ElizaOS-specific controls.

### Permission Layers

Commands go through multiple permission checks in this order:

1. **Discord Native Checks** (before interaction fires):
   - User must have required Discord permissions
   - Command must be available in the current context (guild vs DM)

2. **ElizaOS Channel Whitelist** (if `CHANNEL_IDS` is set):
   - Commands only work in whitelisted channels
   - Unless command has `bypassChannelWhitelist: true`

3. **Custom Validator** (if provided):
   - Runs custom validation logic
   - Full programmatic control

### Registering Commands

```typescript
import { PermissionFlagsBits } from 'discord.js';

// Simple command (works everywhere)
const helpCommand = {
  name: 'help',
  description: 'Show help information'
};

// Guild-only command
const serverInfoCommand = {
  name: 'serverinfo',
  description: 'Show server information',
  guildOnly: true
};

// Requires Discord permission
const configCommand = {
  name: 'config',
  description: 'Configure bot settings',
  requiredPermissions: PermissionFlagsBits.ManageGuild
};

// Bypasses channel whitelist
const utilityCommand = {
  name: 'export',
  description: 'Export data',
  bypassChannelWhitelist: true
};

// Advanced: custom validation
const adminCommand = {
  name: 'admin',
  description: 'Admin-only command',
  validator: async (interaction, runtime) => {
    const adminIds = runtime.getSetting('ADMIN_USER_IDS')?.split(',') ?? [];
    return adminIds.includes(interaction.user.id);
  }
};

// Register commands
await runtime.emitEvent(['DISCORD_REGISTER_COMMANDS'], {
  commands: [helpCommand, serverInfoCommand, configCommand, utilityCommand, adminCommand]
});
```

### Permission Options

| Option | Type | Description |
|--------|------|-------------|
| `guildOnly` | `boolean` | If true, command only works in guilds (not DMs) |
| `bypassChannelWhitelist` | `boolean` | If true, bypasses `CHANNEL_IDS` restrictions |
| `requiredPermissions` | `bigint \| string` | Discord permission bitfield (e.g., `PermissionFlagsBits.ManageGuild`) |
| `contexts` | `number[]` | Raw Discord contexts (0=Guild, 1=BotDM, 2=PrivateChannel) |
| `guildIds` | `string[]` | Register only in specific guilds (instant updates) |
| `validator` | `function` | Custom validation function for advanced logic |

### Common Permission Values

From Discord.js `PermissionFlagsBits`:

- `ManageGuild` - Server settings
- `ManageChannels` - Channel management
- `ManageMessages` - Delete messages
- `BanMembers` - Ban users
- `KickMembers` - Kick users
- `ModerateMembers` - Timeout users
- `ManageRoles` - Role management
- `Administrator` - Full access

### Design Rationale

**Why Hybrid Approach?**
- Discord's native permissions are powerful but limited to role-based access
- ElizaOS needs programmatic control for channel restrictions and custom logic
- Combining both gives developers the best of both worlds

**Why Simple Flags?**
- `guildOnly: true` is clearer than `contexts: [0]`
- Abstracts Discord API details
- Sensible defaults: zero config should "just work"

**Why Keep Channel Whitelist?**
- Discord's channel permissions are UI-based (Server Settings > Integrations)
- Programmatic control is better for developer experience
- Allows dynamic, runtime-based channel restrictions

### Available Actions

The plugin provides the following actions:

1. **chatWithAttachments** - Handle messages with Discord attachments
2. **downloadMedia** - Download media files from Discord messages
3. **joinVoice** - Join a voice channel
4. **leaveVoice** - Leave a voice channel
5. **summarize** - Summarize conversation history
6. **transcribeMedia** - Transcribe audio/video media to text

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

## Testing

The plugin includes a test suite (`DiscordTestSuite`) for validating functionality.

## Notes

- Ensure that your `.env` file includes the required `DISCORD_API_TOKEN` for proper functionality
- The bot requires appropriate Discord permissions to function correctly (send messages, connect to voice channels, etc.)
- If no token is provided, the plugin will load but remain non-functional with appropriate warnings
- The plugin uses Discord.js v14.18.0 with comprehensive intent support
