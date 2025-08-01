import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
function loadEnvironmentVariables() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  const envPaths = [
    join(__dirname, '..', '.env'),
    join(__dirname, '..', '..', '.env'),
    join(__dirname, '..', '..', '..', '.env'),
    join(homedir(), '.eliza', '.env'),
    join(process.cwd(), '.env')
  ];
  
  console.log('[Discord Activity Server] Searching for .env file...');
  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      console.log(`[Discord Activity Server] Found .env file at: ${envPath}`);
      dotenv.config({ path: envPath });
      return envPath;
    }
  }
  
  console.warn('[Discord Activity Server] No .env file found, using process environment variables');
  return null;
}

const envPath = loadEnvironmentVariables();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', 
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
    "frame-ancestors *; " +
    "connect-src *; " +
    "img-src * data: blob:; " +
    "media-src * data: blob:; " +
    "script-src * 'unsafe-inline' 'unsafe-eval'; " +
    "style-src * 'unsafe-inline';"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  next();
});

app.use(cors());
app.use(express.json());

// Store conversation sessions
const sessions = new Map();

// Simple conversation storage
class ConversationSession {
  constructor(sessionId, userId, agentId) {
    this.sessionId = sessionId;
    this.userId = userId;
    this.agentId = agentId;
    this.messages = [];
    this.createdAt = new Date();
  }
  
  addMessage(content, isAgent = false) {
    const message = {
      id: uuidv4(),
      content,
      isAgent,
      timestamp: new Date(),
      authorId: isAgent ? this.agentId : this.userId
    };
    this.messages.push(message);
    return message;
  }
  
  getMessages() {
    return this.messages;
  }
  
  getLastUserMessage() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (!this.messages[i].isAgent) {
        return this.messages[i];
      }
    }
    return null;
  }
}

// ElizaOS API URL
const elizaServiceUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';

// Discord OAuth2 endpoint
app.post('/api/token', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({ error: 'Code is required' });
    }

    console.log('[Discord OAuth] Token exchange request - code received');

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
        redirect_uri: 'https://127.0.0.1',
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Discord OAuth error:', data);
      return res.status(response.status).json({ error: data.error || 'OAuth failed' });
    }

    res.json({ access_token: data.access_token });
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simplified connect endpoint
app.post('/api/connect', async (req, res) => {
  try {
    const { userId, username, guildId, channelId } = req.body;
    const sessionId = `${userId}-${Date.now()}`;
    
    console.log('[Discord Activity] Creating new session:', sessionId);

    // Get available agents
    const agentsRes = await fetch(`${elizaServiceUrl}/api/agents`);
    const agentsData = await agentsRes.json();
    const agents = agentsData.data?.agents || agentsData.agents || [];
    
    if (agents.length === 0) {
      return res.status(500).json({ error: 'No agents available' });
    }
    
    const agentId = agents[0].id;
    console.log('[Discord Activity] Using agent:', agentId);

    // Create session
    const session = new ConversationSession(sessionId, userId, agentId);
    sessions.set(sessionId, session);

    res.json({
      success: true,
      sessionId,
      message: 'Connected to ElizaOS',
      agentId: agentId
    });
  } catch (error) {
    console.error('Connection error:', error);
    res.status(500).json({ error: 'Failed to connect to ElizaOS: ' + error.message });
  }
});

// Simplified chat endpoint - direct agent communication
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId, sessionId, context } = req.body;

    if (!message || !sessionId) {
      return res.status(400).json({ error: 'Message and sessionId are required' });
    }

    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(400).json({ error: 'Invalid session' });
    }

    // Add user message to session
    session.addMessage(message, false);
    console.log('[Discord Activity] User message:', message);

    // Try different API endpoints to communicate with the agent
    let agentResponse = null;
    
    // Method 1: Try the postman collection format
    try {
      const response = await fetch(`${elizaServiceUrl}/api/agent/${session.agentId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          userId: userId,
          roomId: sessionId
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.text || data.response) {
          agentResponse = data.text || data.response;
        }
      }
    } catch (error) {
      console.log('[Discord Activity] Method 1 failed:', error.message);
    }
    
    // Method 2: Try direct message format
    if (!agentResponse) {
      try {
        const response = await fetch(`${elizaServiceUrl}/api/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: session.agentId,
            content: message,
            userId: userId
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.message || data.response) {
            agentResponse = data.message || data.response;
          }
        }
      } catch (error) {
        console.log('[Discord Activity] Method 2 failed:', error.message);
      }
    }
    
    // If we got a response, add it to the session
    if (agentResponse) {
      session.addMessage(agentResponse, true);
      console.log('[Discord Activity] Agent response:', agentResponse);
      return res.json({ response: agentResponse });
    }
    
    // Fallback response
    res.json({ 
      response: "I'm having trouble connecting to the agent. Please ensure ElizaOS is running and try again." 
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message: ' + error.message });
  }
});

// Get session messages
app.get('/api/session/:sessionId/messages', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    success: true,
    messages: session.getMessages()
  });
});

// Disconnect endpoint
app.post('/api/disconnect', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (sessionId) {
      sessions.delete(sessionId);
      console.log('[Discord Activity] Session disconnected:', sessionId);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Configuration endpoint
app.get('/api/config', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  
  console.log('[Discord Activity Server] Config request received');
  
  if (!clientId) {
    return res.status(500).json({
      error: 'Discord Client ID not configured',
      message: 'Please set DISCORD_CLIENT_ID in your ElizaOS .env file'
    });
  }
  
  res.json({
    discordClientId: clientId,
    config: {
      hasClientSecret: !!clientSecret,
      envSource: envPath || 'process environment',
      elizaosApiUrl: elizaServiceUrl
    }
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeSessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

// Start server
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`ElizaOS Discord Activity Server (Simplified) running at http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Environment loaded from: ${envPath || 'process environment'}`);
  console.log(`Discord Client ID: ${process.env.DISCORD_CLIENT_ID ? '✓ Found' : '✗ Not found'}`);
  console.log(`Discord Client Secret: ${process.env.DISCORD_CLIENT_SECRET ? '✓ Found' : '✗ Not found'}`);
  console.log(`ElizaOS API URL: ${elizaServiceUrl}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.warn('\n⚠️  WARNING: Discord credentials not found!');
    console.warn('Please ensure DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET are set in your .env file');
  }
});