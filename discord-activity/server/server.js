const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files
app.use(express.static(path.join(__dirname, '../client/dist')));

// In-memory store for active connections (maps Discord user ID to session info)
const activeConnections = new Map();

// ElizaOS API configuration
const elizaServiceUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';

// Connect endpoint - establishes a session with ElizaOS
app.post('/connect', async (req, res) => {
  const { userId, username, discriminator, avatar } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const sessionKey = `${userId}-${Date.now()}`;
  
  try {
    console.log(`[Discord Activity] Creating new session: ${sessionKey}`);
    
    // Get available agents
    console.log('[Discord Activity] Fetching agents...');
    const agents = await getAgents();
    console.log('[Discord Activity] Agents response:', agents);
    
    if (!agents || agents.length === 0) {
      throw new Error('No agents available');
    }
    
    // Use the first available agent
    const agent = agents[0];
    console.log(`[Discord Activity] Using agent: ${agent.id}`);
    
    // Create a session with ElizaOS
    const sessionResponse = await fetch(`${elizaServiceUrl}/api/messaging/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agent.id,
        userId: userId, // Using Discord user ID as the user ID
        metadata: {
          platform: 'discord-activity',
          username,
          discriminator,
          avatar
        }
      })
    });
    
    if (!sessionResponse.ok) {
      const error = await sessionResponse.text();
      throw new Error(`Failed to create session: ${sessionResponse.status} - ${error}`);
    }
    
    const sessionData = await sessionResponse.json();
    console.log('[Discord Activity] Session created:', sessionData);
    
    // Store connection info
    const connectionInfo = {
      sessionId: sessionData.sessionId,
      agentId: agent.id,
      agentName: agent.name || agent.characterName,
      userId,
      username,
      connectedAt: new Date()
    };
    
    activeConnections.set(sessionKey, connectionInfo);
    
    res.json({
      success: true,
      sessionKey,
      sessionId: sessionData.sessionId,
      agent: {
        id: agent.id,
        name: agent.name || agent.characterName,
        bio: agent.bio || agent.description
      }
    });
    
  } catch (error) {
    console.error('[Discord Activity] Connection error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to ElizaOS', 
      details: error.message 
    });
  }
});

// Chat endpoint - sends a message and polls for response
app.post('/chat', async (req, res) => {
  const { sessionKey, message } = req.body;
  
  if (!sessionKey || !message) {
    return res.status(400).json({ error: 'Session key and message are required' });
  }
  
  const session = activeConnections.get(sessionKey);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  try {
    console.log(`[Discord Activity] Sending message for session: ${session.sessionId}`);
    
    // Send message to ElizaOS
    const messageResponse = await fetch(`${elizaServiceUrl}/api/messaging/sessions/${session.sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: message,
        metadata: {
          platform: 'discord-activity'
        }
      })
    });
    
    if (!messageResponse.ok) {
      const error = await messageResponse.text();
      throw new Error(`Failed to send message: ${messageResponse.status} - ${error}`);
    }
    
    const sentMessage = await messageResponse.json();
    console.log('[Discord Activity] Message sent:', sentMessage.id);
    
    // Poll for agent response
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    const pollInterval = 1000; // 1 second
    let lastTimestamp = sentMessage.createdAt;
    
    const pollForResponse = async () => {
      attempts++;
      
      try {
        // Get messages after the timestamp of our sent message
        const messagesResponse = await fetch(
          `${elizaServiceUrl}/api/messaging/sessions/${session.sessionId}/messages?after=${new Date(lastTimestamp).getTime()}&limit=10`
        );
        
        if (!messagesResponse.ok) {
          throw new Error(`Failed to get messages: ${messagesResponse.status}`);
        }
        
        const { messages } = await messagesResponse.json();
        console.log(`[Discord Activity] Poll attempt ${attempts}: ${messages.length} new messages`);
        
        // Look for agent responses
        const agentResponses = messages.filter(msg => msg.isAgent);
        
        if (agentResponses.length > 0) {
          const latestResponse = agentResponses[agentResponses.length - 1];
          console.log('[Discord Activity] Received agent response:', {
            id: latestResponse.id,
            content: latestResponse.content?.substring(0, 100)
          });
          
          return res.json({ 
            response: latestResponse.content,
            metadata: latestResponse.metadata
          });
        }
        
        // Continue polling if no response yet
        if (attempts < maxAttempts) {
          setTimeout(pollForResponse, pollInterval);
        } else {
          console.log('[Discord Activity] Polling timeout - no agent response received');
          res.status(408).json({ error: 'Timeout waiting for agent response' });
        }
        
      } catch (error) {
        console.error('[Discord Activity] Polling error:', error);
        res.status(500).json({ error: 'Failed to get response' });
      }
    };
    
    // Start polling after a short delay to allow the agent to process
    setTimeout(pollForResponse, 1000);
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message: ' + error.message });
  }
});

// Disconnect endpoint
app.post('/disconnect', async (req, res) => {
  const { sessionKey } = req.body;
  
  if (!sessionKey) {
    return res.status(400).json({ error: 'Session key is required' });
  }
  
  const session = activeConnections.get(sessionKey);
  if (session) {
    // Optionally delete the session from ElizaOS
    try {
      await fetch(`${elizaServiceUrl}/api/messaging/sessions/${session.sessionId}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('[Discord Activity] Error deleting session:', error);
    }
    
    activeConnections.delete(sessionKey);
    console.log(`[Discord Activity] Disconnected session: ${sessionKey}`);
  }
  
  res.json({ success: true });
});

// Get active connections (admin endpoint)
app.get('/connections', (req, res) => {
  const connections = Array.from(activeConnections.entries()).map(([key, info]) => ({
    sessionKey: key,
    ...info
  }));
  
  res.json({
    connections,
    total: connections.length
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeConnections: activeConnections.size,
    elizaServiceUrl,
    timestamp: new Date().toISOString()
  });
});

// ElizaOS API Helper Functions

// Get available agents
async function getAgents() {
  try {
    const response = await fetch(`${elizaServiceUrl}/api/agents`);
    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.status}`);
    }
    const data = await response.json();
    return data.data?.agents || data.agents || [];
  } catch (error) {
    console.error('[ElizaOS API] Failed to get agents:', error);
    throw error;
  }
}

// Serve the Discord Activity client
app.get('*', (req, res) => {
  const clientPath = path.join(__dirname, '../client/dist/index.html');
  if (fs.existsSync(clientPath)) {
    res.sendFile(clientPath);
  } else {
    res.status(404).send('Discord Activity client not found. Please build the client first.');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`[Discord Activity] Server running on port ${PORT}`);
  console.log(`[Discord Activity] ElizaOS API URL: ${elizaServiceUrl}`);
  console.log(`[Discord Activity] Active connections will be tracked in memory`);
});

// Cleanup inactive connections periodically
setInterval(() => {
  const now = new Date();
  const timeout = 30 * 60 * 1000; // 30 minutes
  
  for (const [key, session] of activeConnections.entries()) {
    if (now - session.connectedAt > timeout) {
      activeConnections.delete(key);
      console.log(`[Discord Activity] Cleaned up inactive session: ${key}`);
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes