#!/bin/bash

echo "🚀 Starting Discord Activity with Cloudflared..."
echo "==============================="

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."

# Kill any process using port 5173 (client)
lsof -ti:5173 | xargs kill -9 2>/dev/null

# Kill any process using port 3001 (server)
lsof -ti:3001 | xargs kill -9 2>/dev/null

# Kill any vite or server processes
pkill -f "vite" 2>/dev/null
pkill -f "discord-activity.*server" 2>/dev/null
pkill -f cloudflared 2>/dev/null

echo "⏳ Waiting for ports to be released..."
sleep 3

# Start client
echo "📦 Starting client on port 5173..."
(cd "$DIR/client" && npm run dev) &
CLIENT_PID=$!

# Start server
echo "🖥️  Starting server on port 3001..."
(cd "$DIR/server" && npm run dev) &
SERVER_PID=$!

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 5

# Check if services are running
if ! curl -s http://localhost:5173 > /dev/null; then
    echo "❌ Client failed to start on port 5173"
    exit 1
fi

if ! curl -s http://localhost:3001/api/health > /dev/null; then
    echo "❌ Server failed to start on port 3001"
    exit 1
fi

echo "✅ Services started successfully!"

# Start cloudflared
echo ""
echo "🌐 Starting Cloudflared tunnel..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "👉 IMPORTANT: Copy the URL that appears below"
echo "👉 Add it to Discord Developer Portal → Activities → URL Mappings"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo "❌ cloudflared is not installed!"
    echo ""
    echo "To install cloudflared:"
    echo "  macOS:    brew install cloudflared"
    echo "  Linux:    Download from https://github.com/cloudflare/cloudflared/releases"
    echo "  Windows:  Download from https://github.com/cloudflare/cloudflared/releases"
    echo ""
    echo "Falling back to ngrok..."
    ngrok http 5173
else
    cloudflared tunnel --url http://localhost:5173
fi

# Cleanup on exit
trap "kill $CLIENT_PID $SERVER_PID 2>/dev/null; pkill -f cloudflared 2>/dev/null" EXIT

# Note: cloudflared will run in foreground, Ctrl+C will stop everything