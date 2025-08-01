# Simple API Debugging Guide

## Issue: Timeout Waiting for Agent Response

### Problem
The Simple API was timing out after 30 seconds because:
1. Agent responses sent to `/api/messaging/submit` don't emit events to the internal bus
2. The Simple API was listening for events that never arrived

### Solution Implemented

#### 1. Changed from Event Listening to Database Polling
Instead of waiting for bus events, we now poll the database for agent responses:
```javascript
const pollInterval = setInterval(async () => {
  const messages = await serverInstance.getMessagesForChannel(channelId, 10);
  // Look for agent responses
}, 500); // Poll every 500ms
```

#### 2. Increased Timeout
- Changed from 30 seconds to 60 seconds for complex responses
- Provides more time for the agent to process and respond

#### 3. Fixed Event Name
- Changed from `message_created` to `new_message` (the correct event name)
- Added `author_display_name` field required by the message bus

#### 4. Added Comprehensive Logging
- Channel polling status
- Message filtering details
- Timestamp comparisons
- Response detection

## How to Test

1. **Rebuild ElizaOS** with the updated Simple API:
```bash
cd eliza
npm run build
# or just build the server
cd packages/server
npm run build
```

2. **Start ElizaOS** with debug logging:
```bash
cd eliza
npm start
```

3. **Test the Simple API directly**:
```bash
# Get agents
curl http://localhost:3000/api/messaging/simple/agents

# Send a test message (replace AGENT_ID)
curl -X POST http://localhost:3000/api/messaging/simple/AGENT_ID/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello! What is ElizaOS?",
    "userName": "Test User"
  }'
```

## Debugging Tips

### Check the Logs
Look for these log messages:
- `[Simple API] Creating message at time ...`
- `[Simple API] Polling channel ..., found X messages`
- `[Simple API] Message check - Time: ...`
- `[Simple API] Found agent response: ...`

### Common Issues

1. **No messages found in channel**
   - Agent might not be added as participant
   - Channel creation might have failed
   - Check agent is active

2. **Messages found but filtered out**
   - Check timestamps (agent response must be after user message)
   - Check sourceType is 'agent_response'
   - Check authorId is the agent's ID

3. **Still timing out**
   - Agent might be taking longer than 60 seconds
   - Agent might be ignoring the message
   - Check ElizaOS logs for agent processing

## Architecture Notes

The flow is now:
1. Simple API creates channel and message
2. Emits `new_message` event to bus
3. Agent processes message and sends response to `/api/messaging/submit`
4. Response is saved to database
5. Simple API polls database and finds response
6. Returns response to client

This approach is more reliable than event-based waiting because it doesn't depend on the event bus for agent responses.