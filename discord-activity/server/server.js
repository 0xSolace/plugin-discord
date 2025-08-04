import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config } from 'dotenv';
import crypto from 'crypto';
import { v5 as uuidv5 } from 'uuid';

// Load environment variables from .env file
config({ path: path.join(dirname(fileURLToPath(import.meta.url)), '../.env') });

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

// Discord configuration
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;

// UUID namespace for converting Discord IDs to UUIDs
const DISCORD_NAMESPACE = '550e8400-e29b-41d4-a716-446655440000';

/**
 * Converts a Discord user ID (snowflake) to a deterministic UUID
 * This ensures the same Discord user always gets the same UUID
 */
function discordIdToUuid(discordId) {
  // Convert Discord ID to string if it's not already
  const idString = String(discordId);
  
  // Generate a deterministic UUID using namespace UUID v5
  return uuidv5(idString, DISCORD_NAMESPACE);
}

/**
 * Validates that a string is a proper UUID format
 */
function isValidUuid(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

// Configuration endpoint - provides Discord client ID to the client
app.get('/api/config', (req, res) => {
  if (!discordClientId) {
    return res.status(500).json({
      error: 'Discord Client ID not configured',
      message: 'Please set DISCORD_CLIENT_ID in your environment variables',
      details: {
        envPath: process.env.NODE_ENV === 'development' ? '.env file' : 'Environment variables',
        elizaosApiUrl: elizaServiceUrl,
        checkedLocations: [
          'process.env.DISCORD_CLIENT_ID',
          '.env file in discord-activity directory',
          'System environment variables'
        ]
      }
    });
  }

  res.json({
    discordClientId,
    config: {
      elizaosApiUrl: elizaServiceUrl,
      envSource: process.env.NODE_ENV === 'development' ? '.env file' : 'Environment variables'
    }
  });
});

// Token exchange endpoint - exchanges Discord auth code for access token
app.post('/api/token', async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    return res.status(400).json({ error: 'Authorization code is required' });
  }

  if (!discordClientId || !discordClientSecret) {
    return res.status(500).json({ 
      error: 'Discord credentials not configured',
      message: 'Please set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in your environment variables'
    });
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: discordClientId,
        client_secret: discordClientSecret,
        grant_type: 'authorization_code',
        code: code,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('[Discord OAuth] Token exchange failed:', error);
      return res.status(tokenResponse.status).json({ 
        error: 'Token exchange failed',
        details: error
      });
    }

    const tokenData = await tokenResponse.json();
    res.json(tokenData);
    
  } catch (error) {
    console.error('[Discord OAuth] Token exchange error:', error);
    res.status(500).json({ 
      error: 'Internal server error during token exchange',
      details: error.message
    });
  }
});

// Add API prefix to endpoints to match client expectations

// Get available agents endpoint
app.get('/api/agents', async (req, res) => {
  try {
    console.log('[Discord Activity] Fetching available agents...');
    const agents = await getAgents();
    
    res.json({
      success: true,
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.name || agent.characterName || 'Unnamed Agent',
        bio: agent.bio || agent.description || 'No description available',
        avatar: agent.avatar || null
      }))
    });
  } catch (error) {
    console.error('[Discord Activity] Failed to fetch agents:', error);
    res.status(500).json({
      error: 'Failed to fetch agents',
      details: error.message
    });
  }
});

// Connect endpoint - establishes a session with ElizaOS
app.post('/api/connect', async (req, res) => {
  const { userId, username, discriminator, avatar, agentId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  const sessionKey = `${userId}-${Date.now()}`;
  
  try {
    console.log(`[Discord Activity] Creating new session: ${sessionKey}`);
    
    let agent;
    if (agentId) {
      // Use specified agent
      console.log(`[Discord Activity] Using specified agent: ${agentId}`);
      const agents = await getAgents();
      agent = agents.find(a => a.id === agentId);
      
      if (!agent) {
        throw new Error(`Agent with ID ${agentId} not found`);
      }
    } else {
      // Fallback to first available agent for backward compatibility
      console.log('[Discord Activity] No agent specified, using first available...');
      const agents = await getAgents();
      
      if (!agents || agents.length === 0) {
        throw new Error('No agents available');
      }
      
      agent = agents[0];
    }
    
    console.log(`[Discord Activity] Using agent: ${agent.id}`);
    
    // Convert Discord user ID to UUID for Sessions API compatibility
    const userUuid = discordIdToUuid(userId);
    console.log(`[Discord Activity] Converted Discord user ID ${userId} to UUID: ${userUuid}`);
    
    // Ensure agent ID is also a valid UUID
    const agentUuid = isValidUuid(agent.id) ? agent.id : discordIdToUuid(agent.id);
    console.log(`[Discord Activity] Using agent UUID: ${agentUuid}`);
    
    // Create a session with ElizaOS
    const sessionResponse = await fetch(`${elizaServiceUrl}/api/messaging/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: agentUuid,
        userId: userUuid,
        metadata: {
          platform: 'discord-activity',
          username,
          discriminator,
          avatar,
          originalDiscordUserId: userId // Keep original for reference
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
app.post('/api/chat', async (req, res) => {
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
app.post('/api/disconnect', async (req, res) => {
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

// Health check endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeConnections: activeConnections.size,
    elizaServiceUrl,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
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