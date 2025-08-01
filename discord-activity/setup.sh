#!/bin/bash

echo "🚀 Discord Activity Setup for ElizaOS"
echo "===================================="
echo ""

# Check if we're in the right directory
if [ ! -f "client/package.json" ] || [ ! -f "server/package.json" ]; then
    echo "❌ Error: Please run this script from the discord-activity directory"
    exit 1
fi

# Check for required environment variables
if [ -z "$DISCORD_CLIENT_ID" ]; then
    echo "⚠️  Warning: DISCORD_CLIENT_ID is not set"
    echo "   You need to get this from Discord Developer Portal:"
    echo "   1. Go to https://discord.com/developers/applications"
    echo "   2. Select your application (can be same or different from your bot)"
    echo "   3. Copy the Client ID (Application ID)"
    echo ""
    read -p "Enter your Discord Client ID: " DISCORD_CLIENT_ID
    export DISCORD_CLIENT_ID
fi

if [ -z "$DISCORD_CLIENT_SECRET" ]; then
    echo "⚠️  Warning: DISCORD_CLIENT_SECRET is not set"
    echo "   You need to get this from Discord Developer Portal:"
    echo "   1. Go to https://discord.com/developers/applications"
    echo "   2. Select your application"
    echo "   3. Go to OAuth2 → General"
    echo "   4. Copy the Client Secret"
    echo ""
    read -p "Enter your Discord Client Secret: " DISCORD_CLIENT_SECRET
    export DISCORD_CLIENT_SECRET
fi

echo "✅ Environment variables configured:"
echo "   DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}"
echo "   DISCORD_CLIENT_SECRET: [HIDDEN]"
echo "   DISCORD_ACTIVITY_PORT: ${DISCORD_ACTIVITY_PORT:-3002}"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
echo "   Installing client dependencies..."
cd client && npm install
cd ..

echo "   Installing server dependencies..."
cd server && npm install
cd ..

echo ""
echo "✅ Dependencies installed!"
echo ""

# Provide instructions for running
echo "🎮 To run the Discord Activity:"
echo ""
echo "1. Start the client (in one terminal):"
echo "   cd client && npm run dev"
echo ""
echo "2. Start the server (in another terminal):"
echo "   cd server && npm run dev"
echo ""
echo "3. Set up a tunnel for development:"
echo "   cloudflared tunnel --url http://localhost:3000"
echo ""
echo "4. Configure URL mapping in Discord Developer Portal"
echo ""
echo "5. Enable Activities in your Discord app settings"
echo ""
echo "📚 For detailed instructions, see README.md" 