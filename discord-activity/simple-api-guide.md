# ElizaOS Simple Messaging API Guide

## Overview

We've created a new Simple Messaging API for ElizaOS that handles all channel management internally and returns agent responses in a single HTTP call. This is perfect for integrations like Discord Activities where you don't need full channel management capabilities.

## API Endpoints

### 1. Send Message to Agent
```
POST /api/messaging/simple/{agentId}/message
```

**Request Body:**
```json
{
  "text": "Your message here",
  "userId": "optional-user-id",
  "userName": "optional-user-name"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "response": "Agent's response text",
    "thought": "Agent's internal thought process",
    "actions": ["ACTION_TAKEN"],
    "attachments": []
  }
}
```

### 2. Get Available Agents
```
GET /api/messaging/simple/agents
```

**Response:**
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "id": "agent-uuid",
        "name": "Agent Name",
        "description": "Agent description",
        "status": "active"
      }
    ]
  }
}
```

## How It Works

1. **Automatic Channel Management**: The API creates temporary channels for each request
2. **Event-Based Response**: Uses the internal message bus to wait for agent responses
3. **Timeout Protection**: 30-second timeout to prevent hanging requests
4. **Clean API**: No need to manage channels, sessions, or polling

## Building and Using the New API

### Step 1: Build ElizaOS with the New API

The new Simple API has been added to `eliza/packages/server/src/api/messaging/simple.ts` and integrated into the messaging router.

To build and use it:

```bash
# Navigate to the ElizaOS directory
cd eliza

# Install dependencies if needed
npm install

# Build all packages
npm run build

# Or build just the server package
cd packages/server
npm run build
```

### Step 2: Start ElizaOS

After building, start ElizaOS normally:

```bash
# From the eliza directory
npm start

# Or use the CLI
pnpm eliza start
```

### Step 3: Test the Simple API

Once ElizaOS is running, you can test the simple API:

```bash
# Get available agents
curl http://localhost:3000/api/messaging/simple/agents

# Send a message to an agent
curl -X POST http://localhost:3000/api/messaging/simple/{agentId}/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! What is ElizaOS?",
    "userId": "test-user",
    "userName": "Test User"
  }'
```

## Discord Activity Integration

The Discord Activity has been updated to use this new Simple API. The benefits are:

1. **Simpler Code**: No need for complex channel management
2. **Faster Responses**: No polling required
3. **Better Error Handling**: Clear error messages
4. **Automatic Cleanup**: Temporary channels don't persist

## Example Usage in Node.js

```javascript
async function sendMessageToAgent(agentId, message, userName) {
  const response = await fetch(
    `http://localhost:3000/api/messaging/simple/${agentId}/message`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: message,
        userName: userName
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data.response;
}

// Usage
const agentResponse = await sendMessageToAgent(
  '54334a5c-cbd8-0f1f-a083-f5d48d8a7b82',
  'Hello! What can you do?',
  'Discord User'
);
console.log(agentResponse);
```

## Architecture Details

The Simple API:
- Creates a unique channel ID for each request
- Adds both the user and agent as participants
- Emits the message to the internal bus
- Listens for the agent's response via event handlers
- Returns the response when received
- Cleans up event listeners automatically

This approach eliminates the complexity of managing persistent channels while providing a clean, stateless API for simple chat interactions.