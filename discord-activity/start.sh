#!/bin/bash

echo "🚀 Starting Discord Activity..."
echo "==============================="

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."

# Kill any process using port 5173 (client)
lsof -ti:5173 | xargs kill -9 2>/dev/null
lsof -ti:5174 | xargs kill -9 2>/dev/null
lsof -ti:5175 | xargs kill -9 2>/dev/null
lsof -ti:5176 | xargs kill -9 2>/dev/null
lsof -ti:5177 | xargs kill -9 2>/dev/null

# Kill any process using port 3001 (server)
lsof -ti:3001 | xargs kill -9 2>/dev/null

# Kill any vite or server processes
pkill -f "vite" 2>/dev/null
pkill -f "discord-activity.*server" 2>/dev/null
pkill -f ngrok 2>/dev/null

echo "⏳ Waiting for ports to be released..."
sleep 3

# Start client
echo "📦 Starting client on port 5173..."
(cd "$DIR/client" && npm run dev) &

# Start server
echo "🖥️  Starting server on port 3001..."
(cd "$DIR/server" && npm run dev) &

# Wait for services to start
sleep 5

# Start ngrok
echo "🌐 Starting ngrok tunnel..."
ngrok http 5173

# Note: ngrok will run in foreground, Ctrl+C will stop everything 