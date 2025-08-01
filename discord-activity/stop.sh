#!/bin/bash

echo "🛑 Stopping Discord Activity services..."
echo "======================================="

# Kill any process using port 5173 (client)
echo "📦 Stopping client..."
lsof -ti:5173 | xargs kill -9 2>/dev/null

# Kill any process using port 3001 (server)
echo "🖥️  Stopping server..."
lsof -ti:3001 | xargs kill -9 2>/dev/null

# Kill any vite or server processes
echo "🧹 Cleaning up processes..."
pkill -f "vite" 2>/dev/null
pkill -f "discord-activity.*server" 2>/dev/null
pkill -f ngrok 2>/dev/null

echo "✅ All services stopped!" 