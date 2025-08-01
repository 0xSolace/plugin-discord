import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Helper function to find and load .env file from multiple locations
function loadEnvironmentVariables() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // List of paths to check for .env file (in order of priority)
  const envPaths = [
    // 1. Local discord-activity directory
    join(__dirname, '..', '.env'),
    // 2. Plugin-discord directory
    join(__dirname, '..', '..', '.env'),
    // 3. Root of Eliza project (3 levels up from server directory)
    join(__dirname, '..', '..', '..', '.env'),
    // 4. .eliza directory in user's home
    join(homedir(), '.eliza', '.env'),
    // 5. Current working directory
    join(process.cwd(), '.env')
  ];
  
  console.log('[Discord Activity Server] Searching for .env file in the following locations:');
  for (const envPath of envPaths) {
    console.log(`  - ${envPath}`);
    if (existsSync(envPath)) {
      console.log(`[Discord Activity Server] Found .env file at: ${envPath}`);
      dotenv.config({ path: envPath });
      return envPath;
    }
  }
  
  console.warn('[Discord Activity Server] No .env file found, using process environment variables');
  return null;
}

// Load environment variables from ElizaOS locations
const envPath = loadEnvironmentVariables();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware

// Add headers to bypass ngrok interstitial page and work with Discord
app.use((req, res, next) => {
  // Skip ngrok's browser warning page
  res.setHeader('ngrok-skip-browser-warning', 'true');
  
  // Critical: Allow embedding in Discord's iframe
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  
  // Set permissive CSP for Discord Activity
  res.setHeader('Content-Security-Policy', 
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
    "frame-ancestors *; " +
    "connect-src *; " +
    "img-src * data: blob:; " +
    "media-src * data: blob:; " +
    "script-src * 'unsafe-inline' 'unsafe-eval'; " +
    "style-src * 'unsafe-inline';"
  );
  
  // Additional Discord compatibility headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

app.use(cors());
app.use(express.json());

// Store active connections (in production, use Redis or similar)
const activeConnections = new Map();

// Store session to channel mappings
const sessionChannels = new Map();

// Store message polling intervals
const pollingIntervals = new Map();

// Discord OAuth2 endpoint
app.post('/api/token', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    console.log('[Discord OAuth] Token exchange request - code received');

    // Discord Activities use a specific redirect URI that must match what's in the Developer Portal
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'https://127.0.0.1', // Must match what's configured in Discord Developer Portal
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Discord OAuth error:', data);
      return res.status(response.status).json({ error: data.error || 'OAuth failed' });
    }

    // Return the access token
    res.json({ access_token: data.access_token });
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Connect to ElizaOS
app.post('/api/connect', async (req, res) => {
  try {
    const { userId, username, guildId, channelId } = req.body;

    // Create a connection session
    const sessionId = `${userId}-${Date.now()}`;
    
    console.log('[Discord Activity] Creating new session:', sessionId);

    // Step 1: Get available agents
    console.log('[Discord Activity] Fetching agents...');
    const agents = await getAgents();
    console.log('[Discord Activity] Agents response:', agents);
    
    if (!agents || agents.length === 0) {
      console.error('[Discord Activity] No agents available');
      return res.status(500).json({ error: 'No agents available' });
    }
    const agentId = agents[0].id;
    console.log('[Discord Activity] Using agent:', agentId);

    // Step 2: Get servers (use default if available)
    let serverId = '00000000-0000-0000-0000-000000000000'; // Default server ID
    try {
      console.log('[Discord Activity] Fetching servers...');
      const servers = await getServers();
      console.log('[Discord Activity] Servers response:', servers);
      
      if (servers && servers.length > 0) {
        serverId = servers[0].id;
        console.log('[Discord Activity] Using server:', serverId);
      }
    } catch (error) {
      console.log('[Discord Activity] Error fetching servers, using default:', error.message);
    }

    // Step 3: Create a new channel for this session
    const channelName = `discord-activity-${username}-${Date.now()}`;
    console.log('[Discord Activity] Creating channel:', channelName);
    
    const channel = await createChannel(channelName, serverId, `Discord Activity session for ${username}`);
    console.log('[Discord Activity] Channel created:', channel);
    
    if (!channel || !channel.id) {
      throw new Error('Failed to create channel - invalid response');
    }
    
    console.log('[Discord Activity] Created channel with ID:', channel.id);

    // Step 4: Add agent to the channel
    console.log('[Discord Activity] Adding agent to channel...');
    await addAgentToChannel(channel.id, agentId);
    console.log('[Discord Activity] Agent added to channel successfully');

    // Store session information
    activeConnections.set(sessionId, {
      userId,
      username,
      guildId,
      channelId,
      connectedAt: new Date(),
      elizaChannelId: channel.id,
      elizaServerId: serverId,
      agentId: agentId
    });

    // Store channel mapping
    sessionChannels.set(sessionId, channel.id);

    res.json({
      success: true,
      sessionId,
      message: 'Connected to ElizaOS',
      channelId: channel.id,
      agentId: agentId
    });
  } catch (error) {
    console.error('[Discord Activity] Connection error:', error);
    console.error('[Discord Activity] Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to connect to ElizaOS: ' + error.message });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, sessionId, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Get session information
    const session = activeConnections.get(sessionId);
    if (!session) {
      return res.status(400).json({ error: 'Invalid session' });
    }

    const { elizaChannelId, elizaServerId } = session;

    // Generate a unique author ID for this user (use UUID format if needed by the API)
    const authorId = uuidv4(); // Or use `discord-${userId}` if you want consistent IDs per user

    // Send message to the channel using simple messaging API
    await sendMessageToChannel(elizaChannelId, message, authorId, elizaServerId, session.agentId, sessionId);
    console.log('[Discord Activity] Message sent to channel:', elizaChannelId);

    // Start polling for responses
    let attempts = 0;
    const maxAttempts = 30; // Increased to 30 seconds
    const pollInterval = 1000; // 1 second
    let lastMessageCount = 0;
    let lastMessageId = null;

    // Get initial message state
    const initialMessages = await getChannelMessages(elizaChannelId, session.agentId, sessionId);
    lastMessageCount = initialMessages.length;
    if (initialMessages.length > 0) {
      // Messages are in descending order, so the first message is the newest
      lastMessageId = initialMessages[0].id;
    }
    
    console.log(`[Discord Activity] Initial message count: ${lastMessageCount}, last message ID: ${lastMessageId}`);

    const pollForResponse = async () => {
      attempts++;
      
      try {
        const messages = await getChannelMessages(elizaChannelId, session.agentId, sessionId);
        console.log(`[Discord Activity] Poll attempt ${attempts}: ${messages.length} total messages`);
        
        // Check if we have new messages
        if (messages.length > lastMessageCount) {
          // Messages are returned in descending order (newest first)
          // So new messages are at the beginning of the array
          const newMessageCount = messages.length - lastMessageCount;
          const newMessages = messages.slice(0, newMessageCount);
          console.log(`[Discord Activity] Found ${newMessages.length} new messages`);
          
          // Log all new messages for debugging
          newMessages.forEach((msg, index) => {
            console.log(`[Discord Activity] New message ${index + 1}:`, {
              id: msg.id,
              authorId: msg.authorId,
              content: msg.content?.substring(0, 50) + '...',
              metadata: msg.metadata,
              timestamp: msg.timestamp,
              isAgentResponse: msg.metadata?.isAgentResponse
            });
          });
          
          // Find the agent's response
          // The simple messaging API returns messages with metadata.isAgentResponse
          const agentResponse = newMessages.find(msg => {
            // Check if it's marked as an agent response
            if (msg.metadata?.isAgentResponse) {
              console.log(`[Discord Activity] Found agent response message`);
              return true;
            }
            
            // Also check if the authorId matches the agent ID
            if (msg.authorId === session.agentId) {
              console.log(`[Discord Activity] Found message from agent: ${msg.authorId}`);
              return true;
            }
            
            return false;
          });
          
          if (agentResponse) {
            console.log('[Discord Activity] Received agent response:', {
              id: agentResponse.id,
              content: agentResponse.content?.substring(0, 100)
            });
            
            // Update lastMessageCount to avoid processing same messages again
            lastMessageCount = messages.length;
            
            return res.json({ response: agentResponse.content });
          } else {
            // Update count even if no agent response found
            lastMessageCount = messages.length;
            console.log('[Discord Activity] New messages found but no agent response detected');
          }
        }
        
        // Continue polling if we haven't exceeded max attempts
        if (attempts < maxAttempts) {
          setTimeout(pollForResponse, pollInterval);
        } else {
          console.log('[Discord Activity] Polling timeout - no response received after 30 seconds');
          res.json({ response: "I'm processing your request. Please try again if you don't see a response." });
        }
      } catch (error) {
        console.error('[Discord Activity] Polling error:', error);
        res.status(500).json({ error: 'Failed to get response' });
      }
    };

    // Start polling after a short delay to allow the agent to process
    setTimeout(pollForResponse, 1000); // Increased initial delay to 1 second

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message: ' + error.message });
  }
});

// ElizaOS API Helper Functions
const elizaServiceUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';

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

// Get central servers
async function getServers() {
  try {
    const response = await fetch(`${elizaServiceUrl}/api/messaging/central-servers`);
    if (!response.ok) {
      throw new Error(`Failed to fetch servers: ${response.status}`);
    }
    const data = await response.json();
    return data.data?.servers || data.servers || [];
  } catch (error) {
    console.error('[ElizaOS API] Failed to get servers:', error);
    throw error;
  }
}

// Create a new channel
async function createChannel(name, serverId, description = '') {
  try {
    const response = await fetch(`${elizaServiceUrl}/api/messaging/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        serverId,
        description,
        type: 'text'
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create channel: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    return data.data?.channel || data.channel || data;
  } catch (error) {
    console.error('[ElizaOS API] Failed to create channel:', error);
    throw error;
  }
}

// Add agent to channel
async function addAgentToChannel(channelId, agentId) {
  try {
    const response = await fetch(`${elizaServiceUrl}/api/messaging/central-channels/${channelId}/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        agentId
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to add agent to channel: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[ElizaOS API] Failed to add agent to channel:', error);
    throw error;
  }
}

// Send message to channel using simple messaging API
async function sendMessageToChannel(channelId, content, authorId, serverId, agentId, sessionId) {
  try {
    const response = await fetch(`${elizaServiceUrl}/api/messaging/simple/${agentId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: content,
        userId: authorId,
        sessionId: sessionId,
        serverId: serverId,
        channelId: channelId
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send message: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[ElizaOS API] Failed to send message:', error);
    throw error;
  }
}

// Get messages from channel using simple messaging API
async function getChannelMessages(channelId, agentId, sessionId) {
  try {
    const response = await fetch(`${elizaServiceUrl}/api/messaging/simple/${agentId}/messages?sessionId=${sessionId}&channelId=${channelId}`);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get messages: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    return data.messages || [];
  } catch (error) {
    console.error('[ElizaOS API] Failed to get messages:', error);
    throw error;
  }
}



// Configuration endpoint for client
app.get('/api/config', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  
  console.log('[Discord Activity Server] Config request received');
  console.log(`[Discord Activity Server] Discord Client ID: ${clientId ? 'Found' : 'Not found'}`);
  console.log(`[Discord Activity Server] Discord Client Secret: ${clientSecret ? 'Found' : 'Not found'}`);
  console.log(`[Discord Activity Server] Environment loaded from: ${envPath || 'process environment'}`);
  
  if (!clientId) {
    return res.status(500).json({
      error: 'Discord Client ID not configured',
      message: 'Please set DISCORD_CLIENT_ID in your ElizaOS .env file',
      details: {
        envPath: envPath || 'No .env file found',
        checkedLocations: [
          'discord-activity/.env',
          'plugin-discord/.env', 
          'eliza/.env',
          '~/.eliza/.env',
          'Current working directory'
        ]
      }
    });
  }
  
  res.json({
    discordClientId: clientId,
    // Include additional configuration info
    config: {
      hasClientSecret: !!clientSecret,
      envSource: envPath || 'process environment',
      elizaosApiUrl: process.env.ELIZAOS_API_URL || 'http://localhost:3000'
    }
  });
});

// Disconnect endpoint
app.post('/api/disconnect', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (sessionId) {
      // Clean up session data
      activeConnections.delete(sessionId);
      sessionChannels.delete(sessionId);
      
      // Clear any polling intervals
      if (pollingIntervals.has(sessionId)) {
        clearInterval(pollingIntervals.get(sessionId));
        pollingIntervals.delete(sessionId);
      }
      
      console.log('[Discord Activity] Session disconnected:', sessionId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeConnections: activeConnections.size,
    activeChannels: sessionChannels.size,
    timestamp: new Date().toISOString(),
  });
});

// Start server
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ElizaOS Discord Activity Server running at http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Environment loaded from: ${envPath || 'process environment'}`);
  console.log(`Discord Client ID: ${process.env.DISCORD_CLIENT_ID ? '✓ Found' : '✗ Not found'}`);
  console.log(`Discord Client Secret: ${process.env.DISCORD_CLIENT_SECRET ? '✓ Found' : '✗ Not found'}`);
  console.log(`ElizaOS API URL: ${process.env.ELIZAOS_API_URL || 'http://localhost:3000'}`);
  console.log(`Active connections: ${activeConnections.size}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn('\n⚠️  WARNING: Discord credentials not found!');
    console.warn('Please ensure DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are set in your .env file');
    console.warn('Checked locations:', envPath || 'No .env file found');
  }
}); 