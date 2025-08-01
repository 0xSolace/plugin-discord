#!/usr/bin/env node

// Test the complete Discord Activity flow
import fetch from 'node-fetch';

async function testDiscordFlow() {
  const discordActivityUrl = 'http://localhost:3001';
  
  console.log('=== Testing Discord Activity Flow ===\n');
  
  try {
    // Step 1: Connect to ElizaOS
    console.log('1. Connecting to ElizaOS via Discord Activity...');
    const connectRes = await fetch(`${discordActivityUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'test-user-123',
        username: 'TestUser'
      })
    });
    
    if (!connectRes.ok) {
      const error = await connectRes.text();
      throw new Error(`Failed to connect: ${connectRes.status} - ${error}`);
    }
    
    const connectData = await connectRes.json();
    console.log('   Connected:', JSON.stringify(connectData, null, 2));
    
    const sessionId = connectData.sessionId;
    if (!sessionId) {
      throw new Error('No sessionId returned from connect');
    }
    
    // Step 2: Send a message
    console.log('\n2. Sending message via Discord Activity...');
    const messageRes = await fetch(`${discordActivityUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId,
        message: 'Hello ElizaOS! Can you help me?',
        userId: 'test-user-123'
      })
    });
    
    if (!messageRes.ok) {
      const error = await messageRes.text();
      throw new Error(`Failed to send message: ${messageRes.status} - ${error}`);
    }
    
    const messageData = await messageRes.json();
    console.log('   Response:', JSON.stringify(messageData, null, 2));
    
    if (messageData.response && messageData.response !== "I'm processing your request. Please try again if you don't see a response.") {
      console.log('\n✅ SUCCESS! Agent responded with:', messageData.response);
    } else {
      console.log('\n❌ Agent did not respond properly');
    }
    
    // Step 3: Disconnect
    console.log('\n3. Disconnecting...');
    const disconnectRes = await fetch(`${discordActivityUrl}/api/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    
    console.log('   Disconnected');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testDiscordFlow();