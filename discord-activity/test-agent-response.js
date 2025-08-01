#!/usr/bin/env node

// Test script to manually check agent responses
import { v4 as uuidv4 } from 'uuid';

async function testAgentResponse() {
  const baseUrl = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
  
  console.log('Testing Agent Response Flow\n');
  
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
        name: `test-agent-response-${Date.now()}`,
        serverId: '00000000-0000-0000-0000-000000000000',
        description: 'Test channel for agent response',
        type: 'text'
      })
    });
    
    const channelData = await channelRes.json();
    const channel = channelData.data?.channel || channelData.channel || channelData;
    console.log(`   Created channel: ${channel.id}`);
    
    // Step 3: Add agent to channel
    console.log('\n3. Adding agent to channel...');
    const addAgentRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId })
    });
    
    if (!addAgentRes.ok) {
      throw new Error(`Failed to add agent: ${addAgentRes.status}`);
    }
    console.log('   Agent added successfully');
    
    // Step 4: Send a message
    console.log('\n4. Sending test message...');
    const messageRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Hello, can you hear me?',
        author_id: uuidv4(),
        server_id: '00000000-0000-0000-0000-000000000000'
      })
    });
    
    if (!messageRes.ok) {
      const errorText = await messageRes.text();
      throw new Error(`Failed to send message: ${messageRes.status} - ${errorText}`);
    }
    console.log('   Message sent');
    
    // Step 5: Poll for response
    console.log('\n5. Polling for agent response...');
    let attempts = 0;
    const maxAttempts = 20;
    
    const pollForResponse = async () => {
      attempts++;
      process.stdout.write(`   Attempt ${attempts}/${maxAttempts}...`);
      
      const messagesRes = await fetch(`${baseUrl}/api/messaging/central-channels/${channel.id}/messages`);
      const messagesData = await messagesRes.json();
      const messages = messagesData.data?.messages || messagesData.messages || [];
      
      console.log(` ${messages.length} messages`);
      
      if (messages.length > 1) {
        console.log('\n   New messages found:');
        messages.slice(1).forEach((msg, i) => {
          console.log(`   Message ${i + 2}:`, {
            id: msg.id,
            authorId: msg.authorId || msg.author_id,
            agentId: msg.agentId,
            sourceType: msg.sourceType,
            content: msg.content?.substring(0, 50) + '...'
          });
        });
        return true;
      }
      
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        return pollForResponse();
      }
      
      return false;
    };
    
    const hasResponse = await pollForResponse();
    
    if (hasResponse) {
      console.log('\n✅ Agent responded!');
    } else {
      console.log('\n❌ No agent response after 30 seconds');
      console.log('\nPossible issues:');
      console.log('- Agent might not be monitoring new channels');
      console.log('- Agent might be busy or not processing messages');
      console.log('- Check ElizaOS logs for any errors');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testAgentResponse();