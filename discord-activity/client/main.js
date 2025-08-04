import { DiscordSDK } from "@discord/embedded-app-sdk";
import { VoiceManager } from "./voice.js";
import "./style.css";

// ElizaOS AI Assistant Discord Activity
class ElizaActivityClient {
      constructor() {
        console.log('[ElizaActivity] Constructor called');
        console.log('[ElizaActivity] Environment:', import.meta.env);
        
        // Discord SDK will be initialized after fetching config
        this.discordSdk = null;
        this.discordClientId = null;
        this.auth = null;
        this.messages = [];
        this.isConnected = false;
        this.isTyping = false;
        this.voiceConnection = null;
        this.voiceManager = null; // Will be created after SDK initialization
        this.currentUser = null;
        this.currentGuild = null;
        this.currentChannel = null;
        this.sessionId = null; // Store the session ID
        this.sessionKey = null; // Store the session key for chat requests
        this.selectedAgent = null; // Store the selected agent info
        this.availableAgents = []; // Store available agents
    }

  async init() {
    console.log('[ElizaActivity] Starting initialization...');
    
    try {
      // Check if we're running inside Discord
      const urlParams = new URLSearchParams(window.location.search);
      const frameId = urlParams.get('frame_id');
      const instanceId = urlParams.get('instance_id');
      
      console.log('[ElizaActivity] URL params:', {
        frameId: frameId ? 'present' : 'missing',
        instanceId: instanceId ? 'present' : 'missing',
        fullUrl: window.location.href
      });
      
      if (!frameId || !instanceId) {
        console.warn('[ElizaActivity] Not launched from Discord - showing instructions');
        this.renderNotInDiscordMessage();
        return;
      }
      
      console.log('[ElizaActivity] Step 1: Fetching configuration from server...');
      await this.fetchConfiguration();
      
      console.log('[ElizaActivity] Step 2: Setting up Discord SDK...');
      await this.setupDiscordSdk();
      
      console.log('[ElizaActivity] Step 3: Loading context info...');
      await this.loadContextInfo();
      
      console.log('[ElizaActivity] Step 4: Rendering UI...');
      this.renderUI();
      
      console.log('[ElizaActivity] Step 5: Setting up event listeners...');
      this.setupEventListeners();
      
      console.log('[ElizaActivity] Step 6: Fetching available agents...');
      await this.showAgentSelection();
      
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
      console.log('[ElizaActivity] Configuration received:', config);
      
      if (!config.discordClientId) {
        throw new Error('Discord Client ID not provided by server');
      }
      
      this.discordClientId = config.discordClientId;
      console.log('[ElizaActivity] Discord Client ID loaded:', this.discordClientId);
      console.log('[ElizaActivity] Configuration source:', config.config?.envSource);
      console.log('[ElizaActivity] ElizaOS API URL:', config.config?.elizaosApiUrl);
      
      // Initialize Discord SDK with the fetched client ID
      this.discordSdk = new DiscordSDK(this.discordClientId);
      
      // Initialize VoiceManager after SDK is created
      this.voiceManager = new VoiceManager(this.discordSdk);
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to fetch configuration:', error);
      
      // If error message contains HTML (our custom error), throw it as-is
      if (error.message.includes('<div')) {
        throw error;
      }
      
      throw new Error(`Configuration fetch failed: ${error.message}`);
    }
  }

  async setupDiscordSdk() {
    console.log('[ElizaActivity] Waiting for Discord SDK ready...');
    await this.discordSdk.ready();
    console.log("[ElizaActivity] Discord SDK is ready");

    // Authorize with Discord Client
    console.log('[ElizaActivity] Starting OAuth authorization...');
    const { code } = await this.discordSdk.commands.authorize({
      client_id: this.discordClientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: [
        "identify",
        "guilds",
        "guilds.members.read"
      ],
    });
    
    console.log('[ElizaActivity] Got auth code, exchanging for token...');

    // Get access token from backend
    const response = await fetch("/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
    
    console.log('[ElizaActivity] Token response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ElizaActivity] Token exchange failed:', errorText);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const tokenData = await response.json();
    console.log('[ElizaActivity] Token data received:', Object.keys(tokenData));
    const { access_token } = tokenData;

    // Authenticate with Discord
    this.auth = await this.discordSdk.commands.authenticate({
      access_token,
    });

    if (!this.auth) {
      throw new Error("Authentication failed");
    }

    console.log("Authenticated successfully");
  }

  async loadContextInfo() {
    // Get current user info
    const userResponse = await fetch(`https://discord.com/api/v10/users/@me`, {
      headers: {
        Authorization: `Bearer ${this.auth.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    this.currentUser = await userResponse.json();

    // Get channel info if available
    if (this.discordSdk.channelId && this.discordSdk.guildId) {
      try {
        this.currentChannel = await this.discordSdk.commands.getChannel({
          channel_id: this.discordSdk.channelId
        });
      } catch (error) {
        console.warn("Could not fetch channel info:", error);
      }
    }

    // Get guild info if available
    if (this.discordSdk.guildId) {
      const guildsResponse = await fetch(`https://discord.com/api/v10/users/@me/guilds`, {
        headers: {
          Authorization: `Bearer ${this.auth.access_token}`,
          'Content-Type': 'application/json',
        },
      });
      const guilds = await guildsResponse.json();
      this.currentGuild = guilds.find(g => g.id === this.discordSdk.guildId);
    }
  }

  async fetchAvailableAgents() {
    try {
      const response = await fetch("/api/agents");
      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.status}`);
      }
      const data = await response.json();
      return data.agents || [];
    } catch (error) {
      console.error("Failed to fetch agents:", error);
      return [];
    }
  }

  async connectToElizaOS(selectedAgentId = null) {
    try {
      const response = await fetch("/api/connect", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: this.currentUser.id,
          username: this.currentUser.username,
          guildId: this.discordSdk.guildId,
          channelId: this.discordSdk.channelId,
          agentId: selectedAgentId
        }),
      });

      if (response.ok) {
        const data = await response.json();
        this.sessionId = data.sessionId;
        this.sessionKey = data.sessionKey;
        this.selectedAgent = data.agent;
        this.isConnected = true;
        this.updateConnectionStatus(true);
        this.addSystemMessage(`Connected to ${data.agent.name}. How can I help you today?`);
        console.log('[ElizaActivity] Connected with session ID:', this.sessionId);
        console.log('[ElizaActivity] Connected with session key:', this.sessionKey);
        console.log('[ElizaActivity] Using agent:', data.agent);
      }
    } catch (error) {
      console.error("Failed to connect to ElizaOS:", error);
      this.isConnected = false;
      this.updateConnectionStatus(false);
    }
  }

  async showAgentSelection() {
    try {
      console.log('[ElizaActivity] Fetching available agents...');
      this.availableAgents = await this.fetchAvailableAgents();
      
      if (this.availableAgents.length === 0) {
        this.renderError('No agents are currently available. Please ensure ElizaOS is running with at least one agent configured.');
        return;
      }
      
      console.log('[ElizaActivity] Found agents:', this.availableAgents.length);
      this.renderAgentSelection();
      
    } catch (error) {
      console.error('[ElizaActivity] Failed to load agents:', error);
      this.renderError('Failed to load available agents. Please check if ElizaOS is running.');
    }
  }

  renderAgentSelection() {
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="header-avatar">E</div>
          <div class="header-info">
            <h1>ElizaOS AI Assistant</h1>
            <p>${this.currentChannel ? `in #${this.currentChannel.name}` : 'Choose an AI Assistant'}</p>
          </div>
        </div>
        
        <div class="agent-selection">
          <h2>Select an AI Assistant</h2>
          <p>Choose which ElizaOS agent you'd like to chat with:</p>
          
          <div class="agents-grid" id="agentsGrid">
            ${this.availableAgents.map(agent => `
              <div class="agent-card" data-agent-id="${agent.id}">
                <div class="agent-avatar">
                  ${agent.avatar ? `<img src="${agent.avatar}" alt="${agent.name}">` : agent.name.charAt(0).toUpperCase()}
                </div>
                <div class="agent-info">
                  <h3 class="agent-name">${agent.name}</h3>
                  <p class="agent-bio">${agent.bio}</p>
                </div>
                <div class="agent-actions">
                  <button class="button primary select-agent-btn" data-agent-id="${agent.id}">
                    Select ${agent.name}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
          
          <div class="loading-indicator" id="connectingIndicator" style="display: none;">
            <div class="spinner"></div>
            <p>Connecting to <span id="selectedAgentName"></span>...</p>
          </div>
        </div>
      </div>
    `;
    
    this.setupAgentSelectionListeners();
  }

  setupAgentSelectionListeners() {
    const selectButtons = document.querySelectorAll('.select-agent-btn');
    
    selectButtons.forEach(button => {
      button.addEventListener('click', async (e) => {
        const agentId = e.target.getAttribute('data-agent-id');
        const agent = this.availableAgents.find(a => a.id === agentId);
        
        if (!agent) {
          console.error('[ElizaActivity] Selected agent not found:', agentId);
          return;
        }
        
        console.log('[ElizaActivity] User selected agent:', agent.name);
        
        // Show loading state
        const indicator = document.getElementById('connectingIndicator');
        const selectedAgentName = document.getElementById('selectedAgentName');
        selectedAgentName.textContent = agent.name;
        indicator.style.display = 'block';
        
        // Disable all buttons
        selectButtons.forEach(btn => btn.disabled = true);
        
        try {
          // Connect to ElizaOS with selected agent
          await this.connectToElizaOS(agentId);
          
          // If connected successfully, render the chat UI
          if (this.isConnected) {
            this.renderUI();
            this.setupEventListeners();
          } else {
            throw new Error('Failed to establish connection');
          }
          
        } catch (error) {
          console.error('[ElizaActivity] Connection failed:', error);
          
          // Hide loading and re-enable buttons
          indicator.style.display = 'none';
          selectButtons.forEach(btn => btn.disabled = false);
          
          // Show error message
          const errorDiv = document.createElement('div');
          errorDiv.className = 'error-message';
          errorDiv.innerHTML = `
            <p>Failed to connect to ${agent.name}. Please try again.</p>
            <small>${error.message}</small>
          `;
          document.querySelector('.agent-selection').appendChild(errorDiv);
          
          // Remove error after 5 seconds
          setTimeout(() => {
            if (errorDiv.parentNode) {
              errorDiv.parentNode.removeChild(errorDiv);
            }
          }, 5000);
        }
      });
    });
  }

  renderUI() {
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div class="container">
        <div class="header">
          <div class="header-avatar">
            ${this.selectedAgent?.avatar ? `<img src="${this.selectedAgent.avatar}" alt="${this.selectedAgent.name}">` : (this.selectedAgent?.name.charAt(0).toUpperCase() || 'E')}
          </div>
          <div class="header-info">
            <h1>${this.selectedAgent?.name || 'ElizaOS AI Assistant'}</h1>
            <p>${this.currentChannel ? `in #${this.currentChannel.name}` : 'Discord Activity'}</p>
          </div>
          <div class="connection-status">
            <div class="status-indicator ${this.isConnected ? '' : 'disconnected'}"></div>
            <span>${this.isConnected ? 'Connected' : 'Connecting...'}</span>
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
            ${this.selectedAgent?.name || 'ElizaOS'} is typing...
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
    
    // Only render if the messages container exists (not present on agent selection screen)
    if (messagesContainer) {
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
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            sessionKey: this.sessionKey,
            context: {
              guildId: this.discordSdk.guildId,
              channelId: this.discordSdk.channelId,
              username: this.currentUser.username,
            }
          }),
        });

        const data = await response.json();
        this.showTypingIndicator(false);
        
        if (data.response) {
          this.addMessage(data.response, "ElizaOS", true);
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
    
    // Only update if the indicator exists (not present on agent selection screen)
    if (indicator) {
      indicator.style.display = show ? 'block' : 'none';
    }
  }

  updateConnectionStatus(connected) {
    const statusIndicator = document.querySelector('.status-indicator');
    const statusText = document.querySelector('.connection-status span');
    
    // Only update if the elements exist (they're not present on agent selection screen)
    if (statusIndicator && statusText) {
      if (connected) {
        statusIndicator.classList.remove('disconnected');
        statusText.textContent = 'Connected';
      } else {
        statusIndicator.classList.add('disconnected');
        statusText.textContent = 'Disconnected';
      }
    }
  }

      async toggleVoice() {
        const button = document.getElementById('toggleVoice');
        const indicator = document.getElementById('voiceIndicator');

        if (!this.voiceConnection) {
            try {
                // Connect voice manager
                const connected = await this.voiceManager.connect();
                
                if (connected) {
                    button.textContent = '🔇 Leave Voice Channel';
                    indicator.style.display = 'flex';
                    this.voiceConnection = true;
                    
                    // Set up voice activity listener
                    this.voiceManager.onVoiceActivity((isSpeaking) => {
                        if (isSpeaking) {
                            indicator.classList.add('active');
                        } else {
                            indicator.classList.remove('active');
                        }
                    });
                    
                    this.addSystemMessage("Voice features initialized! I can detect when you're speaking. Full voice interaction coming soon!");
                } else {
                    throw new Error("Voice manager failed to connect");
                }
            } catch (error) {
                console.error("Failed to initialize voice:", error);
                this.addSystemMessage("Failed to initialize voice features. Please ensure microphone permissions are granted.");
            }
        } else {
            // Disconnect voice
            await this.voiceManager.disconnect();
            
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

  

  renderNotInDiscordMessage() {
    const app = document.querySelector('#app');
    app.innerHTML = `
      <div class="not-in-discord">
        <div class="discord-logo">
          <svg width="71" height="55" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.5729 16.3292 45.4997C16.1893 45.4031 16.1781 45.1951 16.3068 45.0831C16.679 44.8094 17.0513 44.5225 17.4067 44.2323C17.471 44.1806 17.5606 44.1691 17.6362 44.2031C29.2558 49.6202 41.8354 49.6202 53.3179 44.2031C53.3935 44.1663 53.4831 44.1778 53.5502 44.2295C53.9057 44.5197 54.2779 44.8094 54.6529 45.0831C54.7816 45.1951 54.7732 45.4031 54.6333 45.4997C52.8646 46.5901 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z" fill="#5865F2"/>
          </svg>
        </div>
        <h2>Launch from Discord</h2>
        <p>This activity must be launched from within Discord</p>
        
        <div class="instructions">
          <h3>How to use ElizaOS AI Assistant:</h3>
          <ol>
            <li>Open Discord and join a server where the activity is enabled</li>
            <li>Join a voice channel or open a text channel</li>
            <li>Click the <strong>Activities</strong> button (rocket icon 🚀)</li>
            <li>Find <strong>"ElizaOS AI Assistant"</strong> in the activities list</li>
            <li>Click <strong>Launch</strong> to start chatting!</li>
          </ol>
        </div>
        
        <div class="dev-note">
          <h4>For Developers:</h4>
          <p>Discord Activities cannot be tested by accessing <code>http://localhost:5173</code> directly.</p>
          <p>You must launch the activity from within Discord to test it properly.</p>
          <p>Use <code>ngrok</code> or <code>cloudflared</code> to create a public URL for testing.</p>
        </div>
        
        <div class="status-info">
          <p><strong>Server Status:</strong> <span id="server-status">Checking...</span></p>
          <p><strong>Configuration:</strong> <span id="config-status">Checking...</span></p>
        </div>
      </div>
    `;
    
    // Check server and config status
    this.checkServerStatus();
  }
  
  async checkServerStatus() {
    try {
      // Check health
      const healthResponse = await fetch('/api/health');
      const healthSpan = document.getElementById('server-status');
      if (healthResponse.ok) {
        healthSpan.textContent = '✓ Server is running';
        healthSpan.style.color = '#43b581';
      } else {
        healthSpan.textContent = '✗ Server unavailable';
        healthSpan.style.color = '#f04747';
      }
      
      // Check config
      const configResponse = await fetch('/api/config');
      const configSpan = document.getElementById('config-status');
      if (configResponse.ok) {
        const config = await configResponse.json();
        if (config.discordClientId) {
          configSpan.textContent = '✓ Discord credentials configured';
          configSpan.style.color = '#43b581';
        } else {
          configSpan.textContent = '✗ Discord credentials missing';
          configSpan.style.color = '#f04747';
        }
      } else {
        configSpan.textContent = '✗ Configuration error';
        configSpan.style.color = '#f04747';
      }
    } catch (error) {
      console.error('[ElizaActivity] Status check error:', error);
    }
  }

  renderError(message) {
    const app = document.querySelector('#app');
    
    // Check if message contains HTML (for detailed configuration errors)
    if (message.includes('<div')) {
      app.innerHTML = `
        <div class="error-message">
          ${message}
        </div>
      `;
    } else {
      app.innerHTML = `
        <div class="error-message">
          <h2>Error</h2>
          <p>${message}</p>
          <p>Please refresh to try again.</p>
        </div>
      `;
    }
  }
}

// Initialize the activity
const activity = new ElizaActivityClient();
activity.init(); 