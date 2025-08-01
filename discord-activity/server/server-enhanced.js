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

// SSE Connection Manager
class SSEConnectionManager {
  constructor() {
    this.connections = new Map(); // sessionId -> { res, userId, agentStreamSessionId }
    this.sessionAgents = new Map(); // sessionId -> agentId
  }

  addConnection(sessionId, res, userId) {
    this.connections.set(sessionId, { res, userId, createdAt: Date.now() });
    console.log(`[SSE Manager] Added connection for session ${sessionId}`);
  }

  removeConnection(sessionId) {
    const connection = this.connections.get(sessionId);
    if (connection && connection.agentStreamSessionId) {
      // Close the upstream SSE connection to ElizaOS
      this.closeUpstreamConnection(connection.agentStreamSessionId);
    }
    this.connections.delete(sessionId);
    this.sessionAgents.delete(sessionId);
    console.log(`[SSE Manager] Removed connection for session ${sessionId}`);
  }

  sendToSession(sessionId, data) {
    const connection = this.connections.get(sessionId);
    if (connection && connection.res) {
      try {
        connection.res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        console.error(`[SSE Manager] Failed to send to session ${sessionId}:`, error);
        this.removeConnection(sessionId);
      }
    }
  }

  setAgentStreamSession(sessionId, agentStreamSessionId, agentId) {
    const connection = this.connections.get(sessionId);
    if (connection) {
      connection.agentStreamSessionId = agentStreamSessionId;
      this.sessionAgents.set(sessionId, agentId);
    }
  }

  closeUpstreamConnection(agentStreamSessionId) {
    // This would close the upstream SSE connection to ElizaOS
    // Implementation depends on how we manage upstream connections
    console.log(`[SSE Manager] Closing upstream connection ${agentStreamSessionId}`);
  }

  cleanup() {
    for (const [sessionId] of this.connections) {
      this.removeConnection(sessionId);
    }
  }
}

const sseManager = new SSEConnectionManager();

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

// SSE endpoint for real-time messaging
app.get('/api/stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { userId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Disable nginx buffering
  });

  // Add connection to manager
  sseManager.addConnection(sessionId, res, userId);

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Keep connection alive with periodic pings
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch (error) {
      clearInterval(pingInterval);
      sseManager.removeConnection(sessionId);
    }
  }, 30000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(pingInterval);
    sseManager.removeConnection(sessionId);
  });
});

// Connect to ElizaOS with SSE support
app.post('/api/connect', async (req, res) => {
  try {
    const { userId, username, guildId, channelId, useSSE = false } = req.body;

    // Create a connection session
    const sessionId = `discord-${userId}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    activeConnections.set(sessionId, {
      userId,
      username,
      guildId,
      channelId,
      connectedAt: new Date(),
      useSSE
    });

    res.json({
      success: true,
      sessionId,
      message: 'Connected to ElizaOS',
      features: {
        sse: useSSE
      }
    });
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ error: 'Failed to connect to ElizaOS' });
  }
});

// Enhanced chat endpoint with SSE support
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, context, sessionId, useSSE = false } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // If using SSE and session exists, use the enhanced API
    if (useSSE && sessionId && sseManager.connections.has(sessionId)) {
      const response = await generateAIResponseWithSSE(message, context, sessionId);
      
      // For SSE mode, we return immediately with an acknowledgment
      return res.json({ 
        success: true,
        mode: 'sse',
        sessionId,
        message: 'Message sent, response will arrive via SSE stream'
      });
    }

    // Fall back to polling mode
    const response = await generateAIResponse(message, context);
    res.json({ response, mode: 'polling' });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// SSE-enabled AI response generation
async function generateAIResponseWithSSE(message, context, sessionId) {
  try {
    const elizaServiceUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
    
    // Get available agents
    const agentsResponse = await fetch(`${elizaServiceUrl}/api/messaging/simple/agents`);
    if (!agentsResponse.ok) {
      throw new Error('Failed to fetch agents');
    }
    
    const agentsData = await agentsResponse.json();
    const agents = agentsData.data?.agents || [];
    
    if (agents.length === 0) {
      sseManager.sendToSession(sessionId, {
        type: 'error',
        error: 'No AI agents are currently available'
      });
      return;
    }
    
    const agentId = agents[0].id;
    const agentStreamSessionId = `${sessionId}-${Date.now()}`;
    
    console.log(`[Discord Activity] Setting up SSE connection to agent ${agentId}`);
    
    // Store the agent stream session
    sseManager.setAgentStreamSession(sessionId, agentStreamSessionId, agentId);
    
    // First, establish SSE connection to ElizaOS
    const streamUrl = `${elizaServiceUrl}/api/messaging/simple/${agentId}/stream?sessionId=${agentStreamSessionId}`;
    
    fetch(streamUrl, {
      headers: {
        'Accept': 'text/event-stream',
      }
    }).then(response => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      const processStream = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                // Forward the data to the Discord client
                sseManager.sendToSession(sessionId, data);
              } catch (e) {
                // Ignore parsing errors
              }
            }
          }
        }
      };
      
      processStream().catch(error => {
        console.error('[Discord Activity] SSE stream error:', error);
        sseManager.sendToSession(sessionId, {
          type: 'error',
          error: 'Stream connection lost'
        });
      });
    });
    
    // Send the message using the enhanced API with SSE flag
    const response = await fetch(
      `${elizaServiceUrl}/api/messaging/simple/${agentId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: message,
          userId: context.userId,
          userName: context.username || 'Discord User',
          useSSE: true,
          sessionId: agentStreamSessionId
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElizaOS Simple API error:', response.status, errorText);
      sseManager.sendToSession(sessionId, {
        type: 'error',
        error: `Failed to send message: ${errorText}`
      });
      return;
    }

    const data = await response.json();
    console.log(`[Discord Activity] Message sent successfully in SSE mode`);
    
  } catch (error) {
    console.error('Failed to setup SSE with ElizaOS:', error);
    sseManager.sendToSession(sessionId, {
      type: 'error',
      error: 'Failed to connect to AI service'
    });
  }
}

// Original polling-based AI response (kept for backwards compatibility)
async function generateAIResponse(message, context) {
  try {
    const elizaServiceUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
    
    // Get available agents first
    const agentsResponse = await fetch(`${elizaServiceUrl}/api/messaging/simple/agents`);
    if (!agentsResponse.ok) {
      throw new Error('Failed to fetch agents');
    }
    
    const agentsData = await agentsResponse.json();
    const agents = agentsData.data?.agents || [];
    
    if (agents.length === 0) {
      return "No AI agents are currently available. Please make sure ElizaOS is running with at least one agent.";
    }
    
    // Use the first available agent
    const agentId = agents[0].id;
    
    console.log(`[Discord Activity] Sending message to agent ${agentId} via simple API (polling mode)`);
    
    // Use the simple API without SSE
    const response = await fetch(
      `${elizaServiceUrl}/api/messaging/simple/${agentId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: message,
          userId: context.userId,
          userName: context.username || 'Discord User',
          useSSE: false
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElizaOS Simple API error:', response.status, errorText);
      throw new Error(`ElizaOS API responded with ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    
    if (data.success && data.data) {
      console.log(`[Discord Activity] Received response from agent (polling mode)`);
      return data.data.response || "I received your message but couldn't generate a response.";
    }

    // Fallback if no response
    return "I'm having trouble processing your message right now. Please try again.";
    
  } catch (error) {
    console.error('Failed to get response from ElizaOS:', error);
    
    // Fallback response if ElizaOS API is unavailable
    return "I apologize, but I'm having trouble connecting to my AI services right now. Please make sure the ElizaOS server is running on port 3000.";
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
      elizaosApiUrl: process.env.ELIZAOS_API_URL || 'http://localhost:3000',
      features: {
        sse: true, // Indicate SSE support
        polling: true // Still support polling as fallback
      }
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeConnections: activeConnections.size,
    sseConnections: sseManager.connections.size,
    timestamp: new Date().toISOString(),
  });
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
  console.log('[Discord Activity Server] Shutting down...');
  sseManager.cleanup();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ElizaOS Discord Activity Server (Enhanced) running at http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Environment loaded from: ${envPath || 'process environment'}`);
  console.log(`Discord Client ID: ${process.env.DISCORD_CLIENT_ID ? '✓ Found' : '✗ Not found'}`);
  console.log(`Discord Client Secret: ${process.env.DISCORD_CLIENT_SECRET ? '✓ Found' : '✗ Not found'}`);
  console.log(`ElizaOS API URL: ${process.env.ELIZAOS_API_URL || 'http://localhost:3000'}`);
  console.log(`Active connections: ${activeConnections.size}`);
  console.log(`Features: SSE ✓ | Polling ✓`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn('\n⚠️  WARNING: Discord credentials not found!');
    console.warn('Please ensure DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are set in your .env file');
    console.warn('Checked locations:', envPath || 'No .env file found');
  }
});