#!/usr/bin/env node

/**
 * Test script for SSE implementation
 * Usage: node test-sse-implementation.js
 */

import fetch from 'node-fetch';
import { EventSource } from 'eventsource';

const ELIZA_URL = process.env.ELIZAOS_API_URL || 'http://localhost:3000';
const DISCORD_ACTIVITY_URL = process.env.DISCORD_ACTIVITY_URL || 'http://localhost:3001';

console.log('SSE Implementation Test Script');
console.log('==============================');
console.log(`ElizaOS URL: ${ELIZA_URL}`);
console.log(`Discord Activity URL: ${DISCORD_ACTIVITY_URL}`);
console.log('');

async function testElizaOSConnection() {
  console.log('1. Testing ElizaOS Connection...');
  try {
    const response = await fetch(`${ELIZA_URL}/api/health`);
    if (response.ok) {
      console.log('✅ ElizaOS is running');
    } else {
      console.log('❌ ElizaOS health check failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Cannot connect to ElizaOS:', error.message);
    return false;
  }
  return true;
}

async function testAgentAvailability() {
  console.log('\n2. Testing Agent Availability...');
  try {
    const response = await fetch(`${ELIZA_URL}/api/messaging/simple/agents`);
    const data = await response.json();
    
    if (data.success && data.data?.agents?.length > 0) {
      console.log(`✅ Found ${data.data.agents.length} agents:`);
      data.data.agents.forEach(agent => {
        console.log(`   - ${agent.name} (${agent.id})`);
      });
      return data.data.agents[0].id;
    } else {
      console.log('❌ No agents available');
      return null;
    }
  } catch (error) {
    console.log('❌ Failed to fetch agents:', error.message);
    return null;
  }
}

async function testSSEConnection(agentId) {
  console.log('\n3. Testing SSE Connection...');
  
  return new Promise((resolve) => {
    const sessionId = `test-session-${Date.now()}`;
    const sseUrl = `${ELIZA_URL}/api/messaging/simple/${agentId}/stream?sessionId=${sessionId}`;
    
    console.log(`   Connecting to: ${sseUrl}`);
    
    const eventSource = new EventSource(sseUrl);
    let connected = false;
    
    eventSource.onopen = () => {
      console.log('✅ SSE connection established');
      connected = true;
    };
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('✅ Received SSE message:', data.type);
        if (data.type === 'connected') {
          eventSource.close();
          resolve(true);
        }
      } catch (error) {
        console.log('❌ Failed to parse SSE message:', error.message);
      }
    };
    
    eventSource.onerror = (error) => {
      console.log('❌ SSE connection error:', error);
      eventSource.close();
      resolve(false);
    };
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (!connected) {
        console.log('❌ SSE connection timeout');
        eventSource.close();
        resolve(false);
      }
    }, 5000);
  });
}

async function testMessageFlow(agentId) {
  console.log('\n4. Testing Message Flow with SSE...');
  
  const sessionId = `test-session-${Date.now()}`;
  
  // First, set up SSE connection
  const sseUrl = `${ELIZA_URL}/api/messaging/simple/${agentId}/stream?sessionId=${sessionId}`;
  const eventSource = new EventSource(sseUrl);
  
  let responseReceived = false;
  const responsePromise = new Promise((resolve) => {
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'agent_response') {
          console.log('✅ Received agent response via SSE');
          console.log('   Response:', data.data.content || data.data.response);
          responseReceived = true;
          eventSource.close();
          resolve(true);
        }
      } catch (error) {
        console.log('❌ Error parsing SSE message:', error.message);
      }
    };
    
    eventSource.onerror = (error) => {
      console.log('❌ SSE error during message test:', error);
      eventSource.close();
      resolve(false);
    };
  });
  
  // Wait a moment for SSE to connect
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Send a test message
  console.log('   Sending test message...');
  try {
    const response = await fetch(`${ELIZA_URL}/api/messaging/simple/${agentId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Hello, this is a test message for SSE implementation.',
        userId: 'test-user',
        userName: 'Test User',
        useSSE: true,
        sessionId: sessionId
      }),
    });
    
    const data = await response.json();
    if (data.success) {
      console.log('✅ Message sent successfully');
      console.log(`   Mode: ${data.data?.mode || data.mode || 'unknown'}`);
    } else {
      console.log('❌ Failed to send message:', data.error);
      eventSource.close();
      return false;
    }
  } catch (error) {
    console.log('❌ Error sending message:', error.message);
    eventSource.close();
    return false;
  }
  
  // Wait for response via SSE (timeout after 10 seconds)
  const timeout = setTimeout(() => {
    if (!responseReceived) {
      console.log('❌ Timeout waiting for SSE response');
      eventSource.close();
    }
  }, 10000);
  
  const result = await responsePromise;
  clearTimeout(timeout);
  
  return result;
}

async function testPollingFallback(agentId) {
  console.log('\n5. Testing Polling Fallback...');
  
  try {
    const response = await fetch(`${ELIZA_URL}/api/messaging/simple/${agentId}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Hello, this is a test message for polling mode.',
        userId: 'test-user',
        userName: 'Test User',
        useSSE: false  // Explicitly disable SSE
      }),
    });
    
    const data = await response.json();
    if (data.success && data.data?.response) {
      console.log('✅ Polling mode works');
      console.log(`   Mode: ${data.mode || 'polling'}`);
      console.log('   Response:', data.data.response);
      return true;
    } else {
      console.log('❌ Polling mode failed:', data.error);
      return false;
    }
  } catch (error) {
    console.log('❌ Error in polling test:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('Starting SSE implementation tests...\n');
  
  // Test 1: ElizaOS Connection
  const elizaOK = await testElizaOSConnection();
  if (!elizaOK) {
    console.log('\n❌ Cannot proceed without ElizaOS connection');
    process.exit(1);
  }
  
  // Test 2: Agent Availability
  const agentId = await testAgentAvailability();
  if (!agentId) {
    console.log('\n❌ Cannot proceed without available agents');
    process.exit(1);
  }
  
  // Test 3: SSE Connection
  const sseOK = await testSSEConnection(agentId);
  if (!sseOK) {
    console.log('\n⚠️  SSE connection failed, but polling fallback may still work');
  }
  
  // Test 4: Message Flow with SSE
  if (sseOK) {
    const messageOK = await testMessageFlow(agentId);
    if (!messageOK) {
      console.log('\n⚠️  SSE message flow failed');
    }
  }
  
  // Test 5: Polling Fallback
  const pollingOK = await testPollingFallback(agentId);
  if (!pollingOK) {
    console.log('\n❌ Polling fallback failed');
  }
  
  // Summary
  console.log('\n==============================');
  console.log('Test Summary:');
  console.log(`ElizaOS Connection: ${elizaOK ? '✅' : '❌'}`);
  console.log(`Agent Availability: ${agentId ? '✅' : '❌'}`);
  console.log(`SSE Support: ${sseOK ? '✅' : '❌'}`);
  console.log(`Polling Fallback: ${pollingOK ? '✅' : '❌'}`);
  console.log('==============================');
  
  process.exit(sseOK && pollingOK ? 0 : 1);
}

// Install required dependencies check
try {
  import('eventsource').catch(() => {
    console.log('\n⚠️  Please install test dependencies:');
    console.log('npm install eventsource node-fetch');
    process.exit(1);
  });
} catch (error) {
  console.log('\n⚠️  Please install test dependencies:');
  console.log('npm install eventsource node-fetch');
  process.exit(1);
}

// Run tests
runTests().catch(error => {
  console.error('\n❌ Test script error:', error);
  process.exit(1);
});