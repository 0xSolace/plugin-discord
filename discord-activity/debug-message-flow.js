#!/usr/bin/env node

// Detailed debug script to trace message flow
import { v4 as uuidv4 } from 'uuid';

async function debugMessageFlow() {
  const baseUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
  
  console.log('=== DETAILED MESSAGE FLOW DEBUG ===\n');
  
  try {
    // Step 1: Get agents
    console.log('1. Getting agents...');
    const agentsRes = await fetch(`${baseUrl}/api/agents`);
    const agentsData = await agentsRes.json();
    const agents = agentsData.data?.agents || [];
    
    if (agents.length === 0) {
      throw new Error('No agents available');
    }
    
    const agentId = agents[0].id;
    console.log(`   Found agent: ${agentId} - ${agents[0].name}`);
    
    // Step 2: Create a test channel
    console.log('\n2. Creating test channel...');
    const channelName = `debug-flow-${Date.now()}`;
    const channelRes = await fetch(`${baseUrl}/api/messaging/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: channelName,
        serverId: '00000000-0000-0000-0000-000000000000',
        description: 'Debug channel for message flow',
        type: 'text'
      })
    });
    
    const channelData = await channelRes.json();
    const channel = channelData.data?.channel || channelData.channel || channelData;
    console.log(`   Created channel: ${channel.id} (${channelName})`);
    
    // Step 3: Add agent to channel
    console.log('\n3. Adding agent to channel...');
    const addAgentRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });
    
    if (!addAgentRes.ok) {
      const error = await addAgentRes.text();
      throw new Error(`Failed to add agent: ${addAgentRes.status} - ${error}`);
    }
    const addAgentData = await addAgentRes.json();
    console.log('   Agent added:', JSON.stringify(addAgentData, null, 2));
    
    // Step 4: Verify agent is in participants
    console.log('\n4. Verifying agent in participants...');
    const participantsRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/participants`);
    const participantsData = await participantsRes.json();
    console.log('   Participants:', participantsData.data);
    
    // Step 5: Send a message
    console.log('\n5. Sending test message...');
    const authorId = uuidv4();
    const messageContent = `Hello agent, this is a test message at ${new Date().toISOString()}`;
    
    const messagePayload = {
      content: messageContent,
      author_id: authorId,
      server_id: '00000000-0000-0000-0000-000000000000',
      metadata: {
        test: true,
        timestamp: Date.now()
      }
    };
    
    console.log('   Sending payload:', JSON.stringify(messagePayload, null, 2));
    
    const messageRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messagePayload)
    });
    
    if (!messageRes.ok) {
      const error = await messageRes.text();
      throw new Error(`Failed to send message: ${messageRes.status} - ${error}`);
    }
    
    const sentMessage = await messageRes.json();
    console.log('   Message sent:', JSON.stringify(sentMessage, null, 2));
    
    // Step 6: Immediately check messages
    console.log('\n6. Checking initial messages...');
    const initialMessagesRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`);
    const initialMessagesData = await initialMessagesRes.json();
    const initialMessages = initialMessagesData.data?.messages || initialMessagesData.messages || [];
    
    console.log(`   Found ${initialMessages.length} message(s)`);
    initialMessages.forEach((msg, i) => {
      console.log(`\n   Message ${i + 1}:`, JSON.stringify({
        id: msg.id,
        author_id: msg.authorId || msg.author_id,
        agent_id: msg.agentId,
        source_type: msg.sourceType || msg.source_type,
        content: msg.content?.substring(0, 100),
        created_at: msg.createdAt || msg.created_at
      }, null, 2));
    });
    
    // Step 7: Poll for agent response with detailed logging
    console.log('\n7. Polling for agent response (with detailed checks)...');
    let attempts = 0;
    const maxAttempts = 15;
    let previousMessageCount = initialMessages.length;
    
    const pollForResponse = async () => {
      attempts++;
      console.log(`\n   === Poll attempt ${attempts}/${maxAttempts} ===`);
      
      const messagesRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`);
      const messagesData = await messagesRes.json();
      const messages = messagesData.data?.messages || messagesData.messages || [];
      
      console.log(`   Total messages: ${messages.length} (was ${previousMessageCount})`);
      
      if (messages.length > previousMessageCount) {
        console.log('   NEW MESSAGES DETECTED!');
        const newMessages = messages.slice(previousMessageCount);
        newMessages.forEach((msg, i) => {
          console.log(`\n   New Message ${i + 1}:`, JSON.stringify({
            id: msg.id,
            author_id: msg.authorId || msg.author_id,
            agent_id: msg.agentId,
            source_type: msg.sourceType || msg.source_type,
            content: msg.content,
            created_at: msg.createdAt || msg.created_at
          }, null, 2));
          
          // Check if this is an agent message
          const isAgentMessage = 
            msg.agentId === agentId || 
            (msg.authorId || msg.author_id) === agentId ||
            msg.sourceType === 'agent' || 
            msg.sourceType === 'eliza';
          
          console.log(`   Is agent message: ${isAgentMessage}`);
        });
        
        previousMessageCount = messages.length;
        return true;
      }
      
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        return pollForResponse();
      }
      
      return false;
    };
    
    const hasNewMessages = await pollForResponse();
    
    if (hasNewMessages) {
      console.log('\n✅ Agent responded!');
    } else {
      console.log('\n❌ No agent response detected');
      console.log('\nDebugging tips:');
      console.log('1. Check ElizaOS server logs for any errors');
      console.log('2. Verify the agent has required API keys (OPENAI_API_KEY, etc.)');
      console.log('3. Check if the MessageBusService is receiving the message');
      console.log('4. Verify the bootstrap plugin is loaded and processing messages');
    }
    
    // Step 8: Final channel state
    console.log('\n8. Final channel state...');
    const finalMessagesRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`);
    const finalMessagesData = await finalMessagesRes.json();
    const finalMessages = finalMessagesData.data?.messages || finalMessagesData.messages || [];
    
    console.log(`\n   Total messages in channel: ${finalMessages.length}`);
    console.log('   Message IDs:', finalMessages.map(m => m.id));
    
  } catch (error) {
    console.error('\n❌ Debug failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the debug
debugMessageFlow();