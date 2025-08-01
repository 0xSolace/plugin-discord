import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type State,
    type HandlerCallback,
    logger,
} from "@elizaos/core";

export const launchActivity: Action = {
    name: "LAUNCH_DISCORD_ACTIVITY",
    similes: [
        "START_ACTIVITY",
        "OPEN_ACTIVITY",
        "LAUNCH_AI_ASSISTANT",
        "START_AI_ACTIVITY",
    ],
    description: "Provides information about launching the Discord Activity for AI interactions",
    
    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        const text = message.content.text.toLowerCase();
        return text.includes("activity") || 
               text.includes("launch") ||
               text.includes("start ai") ||
               text.includes("interactive");
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback?: HandlerCallback
    ): Promise<boolean> => {
        try {
            const isActivityEnabled = runtime.getSetting("DISCORD_CLIENT_SECRET") && 
                                    runtime.getSetting("DISCORD_CLIENT_ID");

            let response = "";

            if (isActivityEnabled) {
                response = `🚀 **Discord Activity is Available!**

To launch the ElizaOS AI Assistant Activity:

1. **In a Voice Channel**: Click the rocket icon (🚀) next to the voice controls
2. **In a Text Channel**: Click the Activities button in the channel header
3. **Search for**: "ElizaOS AI Assistant"
4. **Click Launch**: Start chatting with me in an interactive interface!

**Features:**
• Real-time AI conversations
• Voice channel integration (coming soon)
• Beautiful Discord-themed UI
• Context-aware responses`;
            } else {
                response = `⚠️ **Discord Activity is not configured**

To enable the Discord Activity feature:

1. Set up your Discord Application:
   • Go to https://discord.com/developers/applications
   • Enable Activities in your app settings
   • Note your Client ID and Client Secret

2. Configure environment variables:
   • DISCORD_CLIENT_ID=your_client_id
   • DISCORD_CLIENT_SECRET=your_client_secret


3. Set up URL mappings in Discord Developer Portal

For detailed setup instructions, check the discord-activity/README.md file.`;
            }

            if (callback) {
                callback({
                    text: response,
                    action: "LAUNCH_DISCORD_ACTIVITY",
                });
            }

            return true;
        } catch (error) {
            logger.error("Error in launchActivity action:", error);
            
            if (callback) {
                callback({
                    text: "Sorry, I encountered an error while checking the Discord Activity status.",
                    action: "LAUNCH_DISCORD_ACTIVITY",
                });
            }
            
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "How do I launch the Discord activity?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "You can launch the ElizaOS AI Assistant Activity by clicking the rocket icon in a voice channel or the Activities button in a text channel!",
                    action: "LAUNCH_DISCORD_ACTIVITY",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Start the AI activity",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "I'll help you launch the activity. Click the Activities button in your channel and select 'ElizaOS AI Assistant'!",
                    action: "LAUNCH_DISCORD_ACTIVITY",
                },
            },
        ],
    ],
}; 