#!/usr/bin/env node

// Debug script to examine message structure from ElizaOS API

async function debugMessages() {
  const baseUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
  
  console.log('Debugging ElizaOS Message Structure\n');
  
  try {
    // Get a channel ID from command line or use a test channel
    const channelId = process.argv[2];
    
    if (!channelId) {
      console.log('Usage: node debug-messages.js <channel-id>');
      console.log('\nFetching recent channels to get an example...');
      
      // Try to get recent channels
      const serversRes = await fetch(`${baseUrl}/api/messaging/central-servers`);
      const serversData = await serversRes.json();
      
      if (serversData.data?.servers && serversData.data.servers.length > 0) {
        console.log('\nAvailable servers:', serversData.data.servers.map(s => ({ id: s.id, name: s.name })));
      }
      
      return;
    }
    
    // Fetch messages from the channel
    console.log(`\nFetching messages from channel: ${channelId}`);
    const response = await fetch(`${baseUrl}/api/messaging/central-channels/${channelId}/messages`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.status}`);
    }
    
    const data = await response.json();
    const messages = data.data?.messages || data.messages || [];
    
    console.log(`\nFound ${messages.length} messages\n`);
    
    // Display each message with full structure
    messages.forEach((msg, index) => {
      console.log(`Message ${index + 1}:`);
      console.log('━'.repeat(50));
      console.log('Full structure:', JSON.stringify(msg, null, 2));
      console.log('━'.repeat(50));
      console.log(`ID: ${msg.id}`);
      console.log(`Author ID: ${msg.author_id}`);
      console.log(`Agent ID: ${msg.agentId || 'N/A'}`);
      console.log(`Content: ${msg.content?.substring(0, 100)}...`);
      console.log(`Created: ${msg.createdAt}`);
      console.log('\n');
    });
    
    // Look for patterns to identify agent messages
    const agentMessages = messages.filter(msg => msg.agentId || msg.source === 'agent' || msg.type === 'agent');
    console.log(`\nFound ${agentMessages.length} messages that appear to be from agents`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the debug
debugMessages();