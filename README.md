# @elizaos/plugin-discord

A Discord plugin implementation for ElizaOS, enabling rich integration with Discord servers for managing interactions, voice, and message handling.

## 🚀 Quick Start

### Installation

As this is a workspace package, it's installed as part of the ElizaOS monorepo:

```bash
bun install
```

### Basic Usage

Add the plugin to your character configuration:

```typescript
const character = {
  plugins: [
    "@elizaos/plugin-discord",
    // ... other plugins
  ],
};
```

## 📋 Prerequisites

- [elizaOS](https://github.com/elizaos/eliza) v1.0.0 or higher
- Node.js 23+ or Bun
- Required API credentials (see Configuration)

## 🔧 Configuration

### Environment Variables

Create a `.env` file in your project root:

```bash
# Discord API Credentials (Required)
DISCORD_APPLICATION_ID=your_application_id
DISCORD_API_TOKEN=your_api_token

# Optional Settings
# Comma-separated list of Discord channel IDs to restrict the bot to.
# If not set, the bot operates in all channels as usual.
CHANNEL_IDS=123456789012345678,987654321098765432
```

### Configuration Options

The plugin accepts the following configuration options:

```typescript
// Example configuration
const config = {
  // Add specific configuration options here
};
```

## ✨ Features

### Core Features

- **Handle server join events**: Manage initial configurations when the bot joins a server.
- **Voice event management**: Via the voice manager, handle joining and leaving voice channels.
- **Message processing**: Manage and process new messages with the message manager.
- **Slash command registration**: Support for command interaction handling.
- **Media support**: Handle Discord attachments and media files.
- **Conversation summarization**: Summarize conversation history.
- **Media transcription**: Transcribe audio/video media to text.
- **Channel and voice state providers**: Provide state information about Discord channels and voice states.
- **Channel restriction support**: Limit bot to specific channels.
- **Robust permissions management**: Ensure secure bot functionality.
- **Event-driven architecture**: Comprehensive event handling.

### Actions

The plugin provides the following actions:

1. **chatWithAttachments** - Handle messages with Discord attachments.
2. **downloadMedia** - Download media files from Discord messages.
3. **joinChannel** - Join a voice or text channel.
4. **leaveChannel** - Leave a voice or text channel.
5. **listChannels** - List all channels the bot is listening to.
6. **readChannel** - Read messages from a specified channel.
7. **sendDM** - Send a direct message to a user.
8. **summarize** - Summarize conversation history.
9. **transcribeMedia** - Transcribe audio/video media to text.
10. **searchMessages** - Search for messages based on criteria.
11. **createPoll** - Create a poll in a channel.
12. **getUserInfo** - Retrieve information about a user.
13. **reactToMessage** - Add a reaction to a message.
14. **pinMessage** - Pin a message in a channel.
15. **unpinMessage** - Unpin a message in a channel.
16. **serverInfo** - Retrieve server information.

### Services

1. **DiscordService**
   - Main service class that extends ElizaOS Service.
   - Handles authentication and session management.
   - Manages Discord client connection.
   - Processes events and interactions.

### Providers

1. **channelStateProvider**
   - Provides state information about Discord channels.
   - Retrieves channel state information based on runtime and message parameters.

2. **voiceStateProvider**
   - Provides information about the voice state of the user.
   - Determines if the user is currently in a voice channel.

## 📖 Usage Examples

### Basic Example

```typescript
const runtime = new AgentRuntime({
  plugins: ["@elizaos/plugin-discord"],
});
```

### Advanced Usage

```typescript
// Example of using specific actions
runtime.performAction('joinChannel', { channelId: '123456789' });
```

## 🛠️ Development

### Building

```bash
# Install dependencies
bun install

# Build the plugin
bun run build

# Run tests
bun test
```

### Testing

```bash
# Run unit tests
bun test

# Run integration tests
bun test:integration

# Run with coverage
bun test:coverage
```

### Local Development

1. Clone the repository:
```bash
git clone git+https://github.com/elizaos-plugins/plugin-discord.git
cd plugin-discord
```

2. Install dependencies:
```bash
bun install
```

3. Build the plugin:
```bash
bun run build
```

4. Link for local development:
```bash
bun link
```

## 🤝 Contributing

Contributions are welcome! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🐛 Troubleshooting

### Common Issues

#### Issue: Plugin not loading
**Solution**: Ensure the plugin is properly added to your character's `plugins` array and all required environment variables are set.

#### Issue: API authentication errors
**Solution**: Verify your API credentials are correct and have the necessary permissions.

#### Issue: Rate limiting
**Solution**: The plugin includes built-in rate limiting. If you're hitting limits, consider adjusting the request frequency in your configuration.

## 📚 API Reference

### Actions

Detailed documentation for each action:

#### chatWithAttachments
- **Description**: Summarizes user requests informed by specific attachments.
- **Parameters**: 
  - `attachmentIds`: Array of attachment IDs.
- **Returns**: Summary text.

### Services

Detailed documentation for each service:

#### DiscordService
- **Methods**:
  - `authenticate()`: Handles authentication.
  - `connect()`: Manages Discord client connection.

## 🔒 Security

- Store all sensitive credentials in environment variables.
- Never commit `.env` files to version control.
- Regularly rotate API keys and tokens.
- Follow the principle of least privilege for API permissions.

## 📄 License

This plugin is part of the elizaOS project. See the [LICENSE](LICENSE) file for details.

## 🆘 Support

- 📧 Email: support@elizaos.ai
- 💬 Discord: [elizaOS Discord](https://discord.gg/elizaos)
- 📚 Documentation: [elizaOS Docs](https://eliza.how)
- 🐛 Issues: [GitHub Issues](https://github.com/elizaos-plugins/plugin-discord/issues)

## 🙏 Acknowledgments

Special thanks to the elizaOS team and all contributors to this plugin.

---

Made with ❤️ by the elizaOS community