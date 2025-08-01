# Discord Activity - Channel API Implementation

This document describes the implementation of the full ElizaOS channel API flow for Discord Activities.

## Overview

The Discord Activity now uses the complete ElizaOS channel management API instead of the simple API. When a new Discord Activity session starts, it:

1. Creates a new channel on the ElizaOS server
2. Adds an agent to the channel
3. Sends messages through the channel API
4. Polls for responses from the agent

## API Flow

### 1. Session Initialization (`/api/connect`)

When a user connects to the Discord Activity:

```javascript
// GET /api/agents - Get available agents
const agents = await getAgents();

// GET /api/messaging/central-servers - Get servers
const servers = await getServers();
// Default server ID: 00000000-0000-0000-0000-000000000000

// POST /api/messaging/channels - Create new channel
const channel = await createChannel(
  `discord-activity-${username}-${timestamp}`,
  serverId,
  `Discord Activity session for ${username}`
);

// POST /api/messaging/central-channels/{channelId}/agents - Add agent
await addAgentToChannel(channel.id, agentId);
```

### 2. Message Handling (`/api/chat`)

When a user sends a message:

```javascript
// POST /api/messaging/central-channels/{channelId}/messages
await sendMessageToChannel(channelId, message, authorId, serverId);

// Poll for responses
// GET /api/messaging/central-channels/{channelId}/messages
const messages = await getChannelMessages(channelId);
```

## Key Changes

### Server-side Changes

1. **Helper Functions Added** (`server.js`):
   - `getAgents()` - Fetch available agents
   - `getServers()` - Fetch available servers
   - `createChannel()` - Create a new channel
   - `addAgentToChannel()` - Add agent to channel
   - `sendMessageToChannel()` - Send message to channel
   - `getChannelMessages()` - Fetch messages from channel

2. **Updated `/api/connect` endpoint**:
   - Creates a new channel for each session
   - Stores channel ID and session information
   - Returns session ID to client

3. **Updated `/api/chat` endpoint**:
   - Uses channel API instead of simple API
   - Implements polling mechanism (10 attempts, 1 second intervals)
   - Tracks message count to detect new responses

4. **Added `/api/disconnect` endpoint**:
   - Cleans up session data
   - Removes polling intervals

### Client-side Changes

1. **Added session tracking**:
   - Stores `sessionId` from connect response
   - Sends `sessionId` with each chat message

2. **Updated message sending**:
   - Includes `sessionId` in chat requests
   - Maintains existing UI/UX

## Data Storage

The implementation uses in-memory storage for session management:

```javascript
const activeConnections = new Map(); // Session data
const sessionChannels = new Map();   // Session to channel mapping
const pollingIntervals = new Map();  // Polling interval tracking
```

## Configuration

The server uses the same environment variables:
- `ELIZAOS_API_URL` - ElizaOS API endpoint (default: http://localhost:3000)
- `DISCORD_CLIENT_ID` - Discord application client ID
- `DISCORD_CLIENT_SECRET` - Discord application client secret

## Polling Mechanism

The implementation uses a polling approach to fetch agent responses:

1. After sending a message, the server starts polling the channel
2. Polls every 1 second for up to 10 attempts
3. Looks for new messages from agents (excluding the user's own messages)
4. Returns the first agent response found

## Error Handling

- Graceful fallback to default server ID if server fetch fails
- Proper error messages for missing agents or failed API calls
- Session validation on all chat requests
- Cleanup of resources on disconnect

## Future Improvements

1. Consider implementing WebSocket or SSE for real-time updates instead of polling
2. Add message history persistence
3. Implement channel cleanup after session ends
4. Add retry logic for failed API calls
5. Consider using Redis or similar for session storage in production