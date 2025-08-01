#!/bin/bash

echo "🚀 Starting Discord Activity with ngrok..."
echo "========================================"

# Function to kill all processes on exit
cleanup() {
    echo -e "\n🛑 Stopping all services..."
    kill $(jobs -p) 2>/dev/null
    exit
}
trap cleanup EXIT INT TERM

# Start client
echo "📦 Starting client on port 5173..."
cd client && npm run dev &
CLIENT_PID=$!

# Give client time to start
sleep 3

# Start server
echo "🖥️  Starting server on port 3001..."
cd /Users/cjft/Documents/git/eliza/plugin-discord/discord-activity/server && npm run dev &
SERVER_PID=$!

# Give server time to start
sleep 3

# Start ngrok
echo "🌐 Starting ngrok tunnel..."
ngrok http 5173 &
NGROK_PID=$!

# Wait a bit for ngrok to start
sleep 5

# Instructions
echo ""
echo "✅ All services started!"
echo ""
echo "📋 Next steps:"
echo "1. Copy the ngrok URL from the terminal above"
echo "2. Go to Discord Developer Portal → Activities → URL Mappings"
echo "3. Update the mapping with your ngrok URL (without https://)"
echo "4. Open Discord and launch your activity!"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Keep script running
wait 