#!/bin/bash

echo "🔍 Discord Activity Status Check"
echo "================================"

# Check if client is running
if lsof -i:5173 > /dev/null 2>&1; then
    echo "✅ Client is running on port 5173"
else
    echo "❌ Client is NOT running on port 5173"
fi

# Check if server is running
if lsof -i:3001 > /dev/null 2>&1; then
    echo "✅ Server is running on port 3001"
else
    echo "❌ Server is NOT running on port 3001"
fi

# Check if ElizaOS main API is running
if lsof -i:3000 > /dev/null 2>&1; then
    echo "✅ ElizaOS API is running on port 3000"
else
    echo "❌ ElizaOS API is NOT running on port 3000"
fi

# Check ngrok
if pgrep -f ngrok > /dev/null; then
    echo "✅ ngrok is running"
    echo "   URL: Check ngrok terminal for URL"
else
    echo "❌ ngrok is NOT running"
fi

# Check environment
if [ -f .env ]; then
    echo "✅ .env file exists"
    if grep -q "DISCORD_CLIENT_ID=" .env && grep -q "DISCORD_CLIENT_SECRET=" .env; then
        echo "✅ Discord credentials configured"
    else
        echo "❌ Discord credentials missing in .env"
    fi
else
    echo "❌ .env file not found"
fi

echo ""
echo "📋 Next Steps:"
echo "1. Make sure all services show ✅"
echo "2. Copy ngrok URL from ngrok terminal"
echo "3. Update Discord URL mapping if needed"
echo "4. Launch activity in Discord" 