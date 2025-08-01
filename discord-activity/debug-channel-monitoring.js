#!/usr/bin/env node

// Debug script to check channel monitoring
import { v4 as uuidv4 } from 'uuid';

async function debugChannelMonitoring() {
  const baseUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
  
  console.log('Testing Channel Monitoring and Agent Updates\n');
  
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
    const channelRes = await fetch(`${baseUrl}/api/messaging/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `debug-channel-${Date.now()}`,
        serverId: '00000000-0000-0000-0000-000000000000',
        description: 'Debug channel for monitoring test',
        type: 'text'
      })
    });
    
    const channelData = await channelRes.json();
    const channel = channelData.data?.channel || channelData.channel || channelData;
    console.log(`   Created channel: ${channel.id}`);
    
    // Step 3: Check channel before adding agent
    console.log('\n3. Checking channel participants before adding agent...');
    const beforeRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/participants`);
    const beforeData = await beforeRes.json();
    console.log(`   Participants: ${JSON.stringify(beforeData.data || [])}`);
    
    // Step 4: Add agent to channel
    console.log('\n4. Adding agent to channel...');
    const addAgentRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });
    
    if (!addAgentRes.ok) {
      const error = await addAgentRes.text();
      throw new Error(`Failed to add agent: ${addAgentRes.status} - ${error}`);
    }
    console.log('   Agent added successfully');
    
    // Step 5: Check channel after adding agent
    console.log('\n5. Checking channel participants after adding agent...');
    const afterRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/participants`);
    const afterData = await afterRes.json();
    const participants = afterData.data || [];
    console.log(`   Participants: ${JSON.stringify(participants)}`);
    
    const agentInChannel = participants.some(p => p === agentId);
    console.log(`   Agent is in channel: ${agentInChannel}`);
    
    // Step 6: Send multiple test messages
    console.log('\n6. Sending test messages...');
    const authorId = uuidv4();
    
    for (let i = 0; i < 3; i++) {
      const messageRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `Test message ${i + 1}: Hello agent, can you respond?`,
          author_id: authorId,
          server_id: '00000000-0000-0000-0000-000000000000'
        })
      });
      
      if (!messageRes.ok) {
        const error = await messageRes.text();
        console.log(`   Failed to send message ${i + 1}: ${error}`);
      } else {
        console.log(`   Message ${i + 1} sent`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Step 7: Check for responses
    console.log('\n7. Checking messages in channel...');
    const messagesRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`);
    const messagesData = await messagesRes.json();
    const messages = messagesData.data?.messages || messagesData.messages || [];
    
    console.log(`\n   Total messages: ${messages.length}`);
    messages.forEach((msg, i) => {
      console.log(`\n   Message ${i + 1}:`);
      console.log(`     ID: ${msg.id}`);
      console.log(`     Author ID: ${msg.authorId || msg.author_id}`);
      console.log(`     Agent ID: ${msg.agentId || 'none'}`);
      console.log(`     Source Type: ${msg.sourceType || 'none'}`);
      console.log(`     Content: ${msg.content?.substring(0, 50)}...`);
    });
    
    const agentMessages = messages.filter(msg => 
      msg.agentId === agentId || 
      msg.sourceType === 'agent' || 
      msg.sourceType === 'eliza' ||
      (msg.authorId || msg.author_id) === agentId
    );
    
    console.log(`\n   Agent messages found: ${agentMessages.length}`);
    
    if (agentMessages.length === 0) {
      console.log('\n❌ No agent responses found');
      console.log('\nPossible issues:');
      console.log('- Agent might not be receiving channel_agent_update events');
      console.log('- MessageBusService might not be processing messages');
      console.log('- Agent might be configured incorrectly');
    } else {
      console.log('\n✅ Agent is responding to messages!');
    }
    
  } catch (error) {
    console.error('\n❌ Debug failed:', error.message);
    process.exit(1);
  }
}

// Run the debug
debugChannelMonitoring();