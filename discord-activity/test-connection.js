#!/usr/bin/env node

// Test script to verify Discord Activity connection flow

async function testConnection() {
  const baseUrl = 'http://localhost:3001';
  
  console.log('Testing Discord Activity Connection Flow\n');
  
  try {
    // Test 1: Health check
    console.log('1. Testing health endpoint...');
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const health = await healthRes.json();
    console.log('✓ Health check:', health);
    
    // Test 2: Connect
    console.log('\n2. Testing connect endpoint...');
    const connectRes = await fetch(`${baseUrl}/api/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'test-user-123',
        username: 'TestUser',
        guildId: 'test-guild',
        channelId: 'test-channel'
      })
    });
    
    if (!connectRes.ok) {
      const error = await connectRes.text();
      throw new Error(`Connect failed: ${connectRes.status} - ${error}`);
    }
    
    const connectData = await connectRes.json();
    console.log('✓ Connected successfully:', connectData);
    
    // Test 3: Send a message
    console.log('\n3. Testing chat endpoint...');
    const chatRes = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Hello, ElizaOS!',
        userId: 'test-user-123',
        sessionId: connectData.sessionId,
        context: {
          username: 'TestUser'
        }
      })
    });
    
    if (!chatRes.ok) {
      const error = await chatRes.text();
      throw new Error(`Chat failed: ${chatRes.status} - ${error}`);
    }
    
    const chatData = await chatRes.json();
    console.log('✓ Message sent and response received:', chatData);
    
    // Test 4: Disconnect
    console.log('\n4. Testing disconnect endpoint...');
    const disconnectRes = await fetch(`${baseUrl}/api/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: connectData.sessionId
      })
    });
    
    const disconnectData = await disconnectRes.json();
    console.log('✓ Disconnected successfully:', disconnectData);
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
testConnection();