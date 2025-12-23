# Discord Voice Channel Status and Listening Activity Features

This document describes the new capabilities added to the Discord plugin for setting voice channel status and user "listening to" activity.

## Features

### 1. Voice Channel Status

Set or clear a custom status message that appears at the top of a Discord voice channel.

#### Service Method

```typescript
await discordService.setVoiceChannelStatus(channelId: string, status: string): Promise<boolean>
```

**Parameters:**
- `channelId`: The Discord ID of the voice channel
- `status`: The status text to display (max 500 characters, empty string or null to clear)

**Returns:** `Promise<boolean>` - Whether the status was successfully set

**Example:**
```typescript
const discordService = runtime.getService('discord') as DiscordService;
await discordService.setVoiceChannelStatus('1234567890', 'Weekly team meeting 📅');
```

#### Action

**Name:** `SET_VOICE_CHANNEL_STATUS`

**Similes:** `UPDATE_VOICE_STATUS`, `SET_VC_STATUS`, `CHANGE_VOICE_STATUS`, `UPDATE_VOICE_CHANNEL_STATUS`, `SET_VOICE_MESSAGE`, `CLEAR_VOICE_STATUS`

**Example Usage:**
- "Set the voice channel status to 'Weekly team meeting'"
- "Update the status in general-voice to 'Study session'"
- "Clear the voice channel status"
- "Set vc status to 'Gaming night 🎮'"

### 2. Listening Activity

Set the bot's "listening to" activity status that appears under the bot's name in the member list.

#### Service Methods

```typescript
await discordService.setListeningActivity(activity: string, url?: string): Promise<boolean>
await discordService.clearActivity(): Promise<boolean>
```

**Parameters:**
- `activity`: The activity text to display (e.g., "Spotify", "your commands")
- `url` (optional): URL for streaming activity

**Returns:** `Promise<boolean>` - Whether the activity was successfully set

**Example:**
```typescript
const discordService = runtime.getService('discord') as DiscordService;
await discordService.setListeningActivity('lo-fi beats 🎵');
await discordService.clearActivity(); // Clear the activity
```

#### Action

**Name:** `SET_LISTENING_ACTIVITY`

**Similes:** `SET_LISTENING_STATUS`, `SET_LISTENING_TO`, `UPDATE_LISTENING_STATUS`, `CHANGE_LISTENING_ACTIVITY`, `SET_NOW_PLAYING`, `CLEAR_LISTENING_STATUS`, `SET_ACTIVITY`, `UPDATE_STATUS`, `SET_PRESENCE`

**Example Usage:**
- "Set your status to listening to Spotify"
- "Update your listening activity to 'your commands'"
- "Clear your listening status"
- "Set listening to 'lo-fi beats 🎵'"
- "Stop showing your listening activity"

## Technical Implementation

### Voice Channel Status

The voice channel status feature uses the Discord REST API endpoint `PUT /channels/{channel.id}/voice-status`:

```typescript
await this.client.rest.put(
  `/channels/${channelId}/voice-status`,
  {
    body: {
      status: status || null,
    },
  }
);
```

**Requirements:**
- Bot must have appropriate permissions in the channel
- Channel must be a voice channel (type `GuildVoice`)
- Status text is limited to 500 characters

### Listening Activity

The listening activity uses Discord.js's `setActivity` method with type `2` (Listening):

```typescript
await this.client.user.setActivity(activity, {
  type: 2, // ActivityType.Listening
  url: url,
});
```

## Permissions

### Voice Channel Status
- The bot needs appropriate channel permissions to modify voice channel settings
- Typically requires `MANAGE_CHANNELS` or similar permissions

### Listening Activity
- No special permissions required
- Bot can always modify its own presence/activity

## Limitations

1. **Voice Channel Status**: 
   - Discord has historically toggled this feature on and off
   - The feature may not be visible in all Discord clients
   - Some users have reported the feature being disabled by Discord

2. **Listening Activity**:
   - Only one activity can be displayed at a time
   - Activity is visible across all servers where the bot is present

## Error Handling

Both features include comprehensive error handling:
- Client readiness checks
- Channel type validation
- Permission checks
- Length validation for status text
- Detailed logging for debugging

## Example Agent Interaction

```
User: "Set the voice channel status to 'Study session - no interruptions please'"
Agent: "I'll set the voice channel status to 'Study session - no interruptions please'."

User: "Update your listening status to 'lofi hip hop radio'"
Agent: "I've set my status to 'Listening to lofi hip hop radio'."

User: "Clear the vc status"
Agent: "I've cleared the voice channel status."
```

## Testing

To test these features:

1. Ensure the Discord bot has proper permissions
2. Join a voice channel with the bot
3. Use the actions through natural language commands
4. Verify the status appears in the Discord UI

**Note:** If voice channel status doesn't appear, it may be due to Discord temporarily disabling the feature on their end.

## API Compatibility

- **discord.js version**: 14.18.0+
- **Discord API version**: v10
- **Node.js**: 23.x recommended
- **Bun**: 1.2.x

## Future Enhancements

Potential future improvements:
- Support for other activity types (Playing, Watching, Streaming, Competing)
- Scheduled status updates
- Automatic status rotation
- Integration with external services (e.g., real Spotify integration)
- Voice channel status templates

