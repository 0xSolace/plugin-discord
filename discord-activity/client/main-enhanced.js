// main-enhanced.js
import { DiscordSDK } from "@discord/embedded-app-sdk";
import "./style.css";

class ElizaActivityClient {
  constructor() {
    console.log('[ElizaActivity] Constructor called');
    this.discordSdk = null;
    this.auth = null;
    this.currentUser = null;
    this.currentChannel = null;
    this.isConnected = false;
    this.messages = [];
    this.sessionId = null;
    this.eventSource = null;
    this.useSSE = true; // Enable SSE by default
    this.config = null;
  }

  async init() {
    console.log('[ElizaActivity] Starting initialization...');
    
    try {
      console.log('[ElizaActivity] Step 1: Fetching configuration...');
      await this.fetchConfiguration();
      
      console.log('[ElizaActivity] Step 2: Setting up Discord SDK...');
      await this.setupDiscordSdk();
      
      console.log('[ElizaActivity] Step 3: Loading context info...');
      await this.loadContextInfo();
      
      console.log('[ElizaActivity] Step 4: Rendering UI...');
      this.renderUI();
      
      console.log('[ElizaActivity] Step 5: Setting up event listeners...');
      this.setupEventListeners();
      
      console.log('[ElizaActivity] Step 6: Connecting to ElizaOS...');
      await this.connectToElizaOS();
      
      console.log('[ElizaActivity] Initialization complete!');
    } catch (error) {
      console.error("[ElizaActivity] Failed to initialize activity:", error);
      console.error("[ElizaActivity] Error stack:", error.stack);
      this.renderError(error.message);
    }
  }

  async fetchConfiguration() {
    console.log('[ElizaActivity] Fetching configuration from server...');
    
    try {
      const response = await fetch('/api/config');
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[ElizaActivity] Configuration error details:', errorData);
        
        // Provide detailed error message for missing Discord credentials
        if (errorData.error === 'Discord Client ID not configured') {
          const errorMessage = `
            <div style="text-align: left; max-width: 600px; margin: 0 auto;">
              <h3>Discord Configuration Missing</h3>
              <p>The Discord Activity requires Discord application credentials to function.</p>
              
              <h4>How to fix this:</h4>
              <ol>
                <li>Ensure your ElizaOS <code>.env</code> file contains:
                  <pre style="background: #2b2d31; padding: 10px; border-radius: 4px; margin: 10px 0;">
DISCORD_CLIENT_ID=your_discord_app_id
DISCORD_CLIENT_SECRET=your_discord_app_secret</pre>
                </li>
                <li>The server checked these locations:
                  <ul style="font-size: 0.9em; opacity: 0.8;">
                    ${errorData.details?.checkedLocations?.map(loc => `<li><code>${loc}</code></li>`).join('') || ''}
                  </ul>
                </li>
                <li>Get these values from the <a href="https://discord.com/developers/applications" target="_blank" style="color: #5865F2;">Discord Developer Portal</a></li>
                <li>Restart the Discord Activity server after adding the credentials</li>
              </ol>
              
              <p style="margin-top: 20px; opacity: 0.7;">Current environment source: <code>${errorData.details?.envPath || 'Unknown'}</code></p>
            </div>
          `;
          throw new Error(errorMessage);
        }
        
        throw new Error(errorData.message || 'Failed to fetch configuration');
      }
      
      const config = await response.json();
      console.log('[ElizaActivity] Configuration loaded successfully:', config);
      
      if (!config.discordClientId) {
        throw new Error('Discord Client ID is missing from configuration');
      }
      
      this.config = config;
      this.clientId = config.discordClientId;
      
      // Check if SSE is supported
      this.useSSE = config.config?.features?.sse ?? true;
      console.log(`[ElizaActivity] SSE support: ${this.useSSE ? 'enabled' : 'disabled'}`);
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to fetch configuration:', error);
      throw error;
    }
  }

  async setupDiscordSdk() {
    console.log('[ElizaActivity] Initializing Discord SDK with client ID:', this.clientId);
    
    try {
      this.discordSdk = new DiscordSDK(this.clientId);
      console.log('[ElizaActivity] Discord SDK created successfully');
      
      // Setup the SDK
      console.log('[ElizaActivity] Running Discord SDK setup...');
      await this.discordSdk.ready();
      console.log('[ElizaActivity] Discord SDK is ready!');
      
      // Authorize with Discord
      console.log('[ElizaActivity] Authorizing with Discord...');
      const { code } = await this.discordSdk.commands.authorize({
        client_id: this.clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: [
          "identify",
          "guilds",
          "guilds.members.read",
        ],
      });
      
      console.log('[ElizaActivity] Authorization successful, exchanging code for token...');
      
      // Exchange the code for an access token
      const tokenResponse = await fetch("/.proxy/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
        }),
      });

      const { access_token } = await tokenResponse.json();
      this.auth = { access_token };
      
      console.log('[ElizaActivity] Token exchange successful');
      
      // Authenticate with Discord SDK
      const authResponse = await this.discordSdk.commands.authenticate({
        access_token,
      });
      
      if (!authResponse || !authResponse.user) {
        throw new Error('Failed to authenticate with Discord');
      }
      
      this.currentUser = authResponse.user;
      console.log('[ElizaActivity] Authenticated as:', this.currentUser.username);
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to setup Discord SDK:', error);
      throw new Error(`Discord SDK setup failed: ${error.message}`);
    }
  }

  async loadContextInfo() {
    console.log('[ElizaActivity] Loading context information...');
    
    if (!this.discordSdk.channelId || !this.discordSdk.guildId) {
      console.warn('[ElizaActivity] No channel or guild context available');
      return;
    }
    
    try {
      // Get channel info
      const channel = await this.discordSdk.commands.getChannel({
        channel_id: this.discordSdk.channelId,
      });
      this.currentChannel = channel;
      console.log('[ElizaActivity] Current channel:', channel.name);
      
      // Get guild info
      const guild = await this.discordSdk.commands.getGuild({
        guild_id: this.discordSdk.guildId,
      });
      console.log('[ElizaActivity] Current guild:', guild.name);
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to load context info:', error);
      // Non-fatal error, continue without context
    }
  }

  async connectToElizaOS() {
    console.log('[ElizaActivity] Connecting to ElizaOS...');
    
    try {
      const response = await fetch("/.proxy/api/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: this.currentUser.id,
          username: this.currentUser.username,
          guildId: this.discordSdk.guildId,
          channelId: this.discordSdk.channelId,
          useSSE: this.useSSE
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to connect to ElizaOS');
      }

      const data = await response.json();
      this.sessionId = data.sessionId;
      this.isConnected = true;
      
      console.log('[ElizaActivity] Connected successfully with session:', this.sessionId);
      
      // Set up SSE connection if enabled
      if (this.useSSE && data.features?.sse) {
        await this.setupSSE();
      }
      
      this.updateConnectionStatus(true);
      this.addSystemMessage("Welcome! I'm ElizaOS, your AI assistant. How can I help you today?");
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to connect to ElizaOS:', error);
      this.isConnected = false;
      this.updateConnectionStatus(false);
      this.addSystemMessage("Failed to connect to ElizaOS. Please try again later.");
    }
  }

  async setupSSE() {
    if (!this.sessionId) {
      console.error('[ElizaActivity] Cannot setup SSE without session ID');
      return;
    }
    
    console.log('[ElizaActivity] Setting up SSE connection...');
    
    try {
      // Close existing connection if any
      if (this.eventSource) {
        this.eventSource.close();
      }
      
      // Create SSE connection
      const sseUrl = `/.proxy/api/stream/${this.sessionId}?userId=${this.currentUser.id}`;
      this.eventSource = new EventSource(sseUrl);
      
      this.eventSource.onopen = () => {
        console.log('[ElizaActivity] SSE connection opened');
      };
      
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleSSEMessage(data);
        } catch (error) {
          console.error('[ElizaActivity] Failed to parse SSE message:', error);
        }
      };
      
      this.eventSource.onerror = (error) => {
        console.error('[ElizaActivity] SSE connection error:', error);
        
        // Fall back to polling if SSE fails
        if (this.eventSource.readyState === EventSource.CLOSED) {
          console.log('[ElizaActivity] SSE connection closed, falling back to polling');
          this.useSSE = false;
          this.eventSource = null;
        }
      };
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to setup SSE:', error);
      this.useSSE = false;
    }
  }

  handleSSEMessage(data) {
    console.log('[ElizaActivity] Received SSE message:', data);
    
    switch (data.type) {
      case 'connected':
        console.log('[ElizaActivity] SSE connected successfully');
        break;
        
      case 'agent_response':
        this.showTypingIndicator(false);
        const response = data.data;
        this.addMessage(
          response.content || response.response || '', 
          "ElizaOS", 
          true
        );
        break;
        
      case 'error':
        this.showTypingIndicator(false);
        this.addSystemMessage(`Error: ${data.error}`);
        break;
        
      case 'message_sent':
        console.log('[ElizaActivity] Message acknowledged:', data.messageId);
        break;
        
      default:
        console.log('[ElizaActivity] Unknown SSE message type:', data.type);
    }
  }

  renderUI() {
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="header-avatar">E</div>
          <div class="header-info">
            <h1>ElizaOS AI Assistant</h1>
            <p>${this.currentChannel ? `in #${this.currentChannel.name}` : 'Discord Activity'}</p>
          </div>
          <div class="connection-status">
            <div class="status-indicator ${this.isConnected ? '' : 'disconnected'}"></div>
            <span>${this.isConnected ? 'Connected' : 'Connecting...'}</span>
            ${this.useSSE ? '<span class="sse-indicator">SSE</span>' : ''}
          </div>
        </div>
        
        <div class="chat-area">
          <div class="voice-controls">
            <button class="button secondary" id="toggleVoice">
              🎤 Join Voice Channel
            </button>
            <div class="voice-indicator" id="voiceIndicator" style="display: none;">
              <span class="icon">🔊</span>
              <span>Voice Active</span>
            </div>
          </div>
          
          <div class="messages-container" id="messages">
            <!-- Messages will be rendered here -->
          </div>
          
          <div class="typing-indicator" id="typingIndicator" style="display: none;">
            ElizaOS is typing...
          </div>
        </div>
        
        <div class="input-area">
          <div class="input-container">
            <div class="input-wrapper">
              <textarea 
                class="message-input" 
                id="messageInput" 
                placeholder="Type a message..."
                rows="1"
              ></textarea>
            </div>
            <div class="input-buttons">
              <button class="button" id="sendButton">Send</button>
            </div>
          </div>
        </div>
      </div>
    `;

    this.renderMessages();
  }

  renderMessages() {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = this.messages.map(msg => `
      <div class="message ${msg.isAI ? 'ai' : 'user'}">
        <div class="message-avatar">${msg.isAI ? 'E' : msg.author[0].toUpperCase()}</div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-author">${msg.author}</span>
            <span class="message-timestamp">${msg.timestamp}</span>
          </div>
          <div class="message-text">${msg.text}</div>
        </div>
      </div>
    `).join('');
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  addMessage(text, author, isAI = false) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.messages.push({ text, author, timestamp, isAI });
    this.renderMessages();
  }

  addSystemMessage(text) {
    this.addMessage(text, "ElizaOS", true);
  }

  setupEventListeners() {
    // Message input handling
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    const sendMessage = async () => {
      const message = messageInput.value.trim();
      if (!message || !this.isConnected) return;

      // Add user message
      this.addMessage(message, this.currentUser.username, false);
      messageInput.value = '';
      this.adjustTextareaHeight(messageInput);

      // Show typing indicator
      this.showTypingIndicator(true);

      try {
        // Send to ElizaOS backend
        const response = await fetch("/.proxy/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            userId: this.currentUser.id,
            context: {
              guildId: this.discordSdk.guildId,
              channelId: this.discordSdk.channelId,
              username: this.currentUser.username,
            },
            sessionId: this.sessionId,
            useSSE: this.useSSE
          }),
        });

        const data = await response.json();
        
        if (data.mode === 'sse') {
          // Response will arrive via SSE
          console.log('[ElizaActivity] Message sent, waiting for SSE response');
        } else {
          // Polling mode response
          this.showTypingIndicator(false);
          if (data.response) {
            this.addMessage(data.response, "ElizaOS", true);
          }
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        this.showTypingIndicator(false);
        this.addSystemMessage("Sorry, I encountered an error processing your message.");
      }
    };

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
      this.adjustTextareaHeight(messageInput);
    });

    // Voice toggle
    const toggleVoiceButton = document.getElementById('toggleVoice');
    toggleVoiceButton.addEventListener('click', () => this.toggleVoice());

    // Listen for voice state updates
    this.discordSdk.subscribe('VOICE_STATE_UPDATE', (event) => {
      console.log('Voice state update:', event);
      this.handleVoiceStateUpdate(event);
    });
  }

  adjustTextareaHeight(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  }

  showTypingIndicator(show) {
    const indicator = document.getElementById('typingIndicator');
    indicator.style.display = show ? 'block' : 'none';
  }

  updateConnectionStatus(connected) {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.connection-status span');
    
    if (connected) {
      statusIndicator.classList.remove('disconnected');
      statusText.textContent = 'Connected';
    } else {
      statusIndicator.classList.add('disconnected');
      statusText.textContent = 'Disconnected';
    }
  }

  async toggleVoice() {
    const button = document.getElementById('toggleVoice');
    const indicator = document.getElementById('voiceIndicator');

    if (!this.voiceConnection) {
      try {
        // Join voice channel
        const { voiceChannelId } = await this.discordSdk.commands.setActivity({
          activity: {
            type: 2, // Listening
            name: "ElizaOS Voice Chat",
          },
        });
        
        if (voiceChannelId) {
          button.textContent = '🔇 Leave Voice Channel';
          indicator.style.display = 'flex';
          this.voiceConnection = true;
          this.addSystemMessage("Voice features initialized! Full voice interaction coming soon!");
        }
      } catch (error) {
        console.error("Failed to initialize voice:", error);
        this.addSystemMessage("Failed to initialize voice features.");
      }
    } else {
      // Leave voice channel
      button.textContent = '🎤 Join Voice Channel';
      indicator.style.display = 'none';
      indicator.classList.remove('active');
      this.voiceConnection = false;
      this.addSystemMessage("Voice features disabled.");
    }
  }

  handleVoiceStateUpdate(event) {
    // Handle voice state changes
    if (event.user_id === this.currentUser.id) {
      const indicator = document.getElementById('voiceIndicator');
      if (event.voice_state.self_mute || event.voice_state.self_deaf) {
        indicator.classList.remove('active');
      } else {
        indicator.classList.add('active');
      }
    }
  }

  renderError(errorMessage) {
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div class="error-container">
        <div class="error-icon">⚠️</div>
        <h2>Activity Failed to Load</h2>
        <div class="error-message">${errorMessage}</div>
        <button class="button" onclick="window.location.reload()">Retry</button>
      </div>
    `;
  }

  renderNotInDiscordMessage() {
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div class="not-in-discord">
        <h1>ElizaOS Discord Activity</h1>
        <p>This application must be run within Discord.</p>
        <p>Please launch it from a Discord voice channel or text channel.</p>
      </div>
    `;
  }

  cleanup() {
    // Close SSE connection if exists
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}

// Add CSS for SSE indicator
const style = document.createElement('style');
style.textContent = `
  .sse-indicator {
    margin-left: 8px;
    padding: 2px 6px;
    background: #5865F2;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
`;
document.head.appendChild(style);

// Initialize the activity when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const client = new ElizaActivityClient();
    client.init();
    
    // Cleanup on window unload
    window.addEventListener('beforeunload', () => {
      client.cleanup();
    });
  });
} else {
  const client = new ElizaActivityClient();
  client.init();
  
  // Cleanup on window unload
  window.addEventListener('beforeunload', () => {
    client.cleanup();
  });
}