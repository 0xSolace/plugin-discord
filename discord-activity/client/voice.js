// Voice interaction module for Discord Activity
export class VoiceManager {
    constructor(discordSdk) {
        this.discordSdk = discordSdk;
        this.isConnected = false;
        this.isSpeaking = false;
        this.mediaStream = null;
        this.audioContext = null;
        this.voiceActivityCallbacks = [];
    }

    // Initialize voice capabilities
    async initialize() {
        try {
            // Request microphone permissions
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });

            // Create audio context for processing
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Set up voice activity detection
            this.setupVoiceActivityDetection();
            
            return true;
        } catch (error) {
            console.error("Failed to initialize voice:", error);
            return false;
        }
    }

    // Set up voice activity detection
    setupVoiceActivityDetection() {
        if (!this.mediaStream || !this.audioContext) return;

        const source = this.audioContext.createMediaStreamSource(this.mediaStream);
        const analyser = this.audioContext.createAnalyser();
        analyser.fftSize = 256;
        
        source.connect(analyser);
        
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Voice activity detection threshold
        const VOICE_THRESHOLD = 30;
        let voiceDetected = false;
        
        const checkVoiceActivity = () => {
            analyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume
            const average = dataArray.reduce((a, b) => a + b) / bufferLength;
            
            // Detect voice activity
            const currentVoiceDetected = average > VOICE_THRESHOLD;
            
            if (currentVoiceDetected !== voiceDetected) {
                voiceDetected = currentVoiceDetected;
                this.onVoiceActivityChange(voiceDetected);
            }
            
            if (this.isConnected) {
                requestAnimationFrame(checkVoiceActivity);
            }
        };
        
        checkVoiceActivity();
    }

    // Handle voice activity changes
    onVoiceActivityChange(isSpeaking) {
        this.isSpeaking = isSpeaking;
        
        // Notify all registered callbacks
        this.voiceActivityCallbacks.forEach(callback => {
            callback(isSpeaking);
        });
        
        // Future: Send voice data to server for transcription
        if (isSpeaking) {
            console.log("Voice activity detected - ready for transcription");
        }
    }

    // Register callback for voice activity
    onVoiceActivity(callback) {
        this.voiceActivityCallbacks.push(callback);
        
        // Return unsubscribe function
        return () => {
            const index = this.voiceActivityCallbacks.indexOf(callback);
            if (index > -1) {
                this.voiceActivityCallbacks.splice(index, 1);
            }
        };
    }

    // Connect to voice channel
    async connect() {
        try {
            // Subscribe to voice state updates
            await this.discordSdk.subscribe('VOICE_STATE_UPDATE');
            
            // Initialize voice if not already done
            if (!this.mediaStream) {
                await this.initialize();
            }
            
            this.isConnected = true;
            
            // Future: Connect to Discord voice channel via RTC
            console.log("Voice manager connected - ready for voice interactions");
            
            return true;
        } catch (error) {
            console.error("Failed to connect voice:", error);
            return false;
        }
    }

    // Disconnect from voice
    async disconnect() {
        this.isConnected = false;
        
        // Stop media stream
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        // Close audio context
        if (this.audioContext) {
            await this.audioContext.close();
            this.audioContext = null;
        }
        
        // Unsubscribe from voice events
        try {
            await this.discordSdk.unsubscribe('VOICE_STATE_UPDATE');
        } catch (error) {
            console.error("Failed to unsubscribe from voice events:", error);
        }
        
        console.log("Voice manager disconnected");
    }

    // Get current voice state
    getState() {
        return {
            isConnected: this.isConnected,
            isSpeaking: this.isSpeaking,
            hasPermission: this.mediaStream !== null
        };
    }

    // Future: Add methods for:
    // - Real-time transcription
    // - Voice synthesis for AI responses
    // - Push-to-talk functionality
    // - Voice channel management
} 