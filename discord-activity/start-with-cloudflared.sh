#!/bin/bash

# Function to safely run commands that might fail
safe_run() {
    if "$@"; then
        return 0
    else
        echo "⚠️  Command failed (but continuing): $*"
        return 1
    fi
}

echo "🚀 Starting Discord Activity with Cloudflared..."
echo "==============================="
echo "📝 Debug logs will be saved to: /tmp/discord-activity-logs/"
echo ""

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Verify directories and files exist
echo "🔍 Validating project structure..."
if [ ! -d "$DIR/client" ] || [ ! -f "$DIR/client/package.json" ]; then
    echo "❌ Client directory or package.json not found"
    exit 1
fi

if [ ! -d "$DIR/server" ] || [ ! -f "$DIR/server/package.json" ]; then
    echo "❌ Server directory or package.json not found"
    exit 1
fi
echo "✅ Project structure validated"

# Kill any existing processes
echo "🧹 Cleaning up existing processes..."

# Kill processes on required ports
if lsof -ti:5173 >/dev/null 2>&1; then
    echo "🔴 Killing processes on port 5173..."
    lsof -ti:5173 | xargs kill -9 2>/dev/null
fi

if lsof -ti:3001 >/dev/null 2>&1; then
    echo "🔴 Killing processes on port 3001..."
    lsof -ti:3001 | xargs kill -9 2>/dev/null
fi

# Kill background processes
pkill -f "vite" 2>/dev/null || true
pkill -f "discord-activity.*server" 2>/dev/null || true

echo "✅ Process cleanup completed"

echo "⏳ Waiting for ports to be released..."
sleep 3

# Verify ports are free
echo "🔍 Verifying ports are available..."
if lsof -ti:5173 >/dev/null 2>&1; then
    echo "❌ Port 5173 is still in use!"
    lsof -i:5173
    exit 1
fi
echo "✅ Port 5173 is available"

if lsof -ti:3001 >/dev/null 2>&1; then
    echo "❌ Port 3001 is still in use!"
    lsof -i:3001
    exit 1
fi
echo "✅ Port 3001 is available"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed or not in PATH!"
    exit 1
fi

# Create log directory
LOG_DIR="/tmp/discord-activity-logs"
mkdir -p "$LOG_DIR"

# Install dependencies if needed and start services
echo "📦 Starting client on port 5173..."
if [ ! -d "$DIR/client/node_modules" ]; then
    echo "⚠️  Installing client dependencies..."
    (cd "$DIR/client" && npm install)
fi

(cd "$DIR/client" && npm run dev) > "$LOG_DIR/client.log" 2>&1 &
CLIENT_PID=$!
echo "✅ Client started (PID: $CLIENT_PID)"

echo "🖥️  Starting server on port 3001..."
if [ ! -d "$DIR/server/node_modules" ]; then
    echo "⚠️  Installing server dependencies..."
    (cd "$DIR/server" && npm install)
fi

(cd "$DIR/server" && npm run dev) > "$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "✅ Server started (PID: $SERVER_PID)"

# Monitor processes
echo "🔍 Checking if processes are still running..."
sleep 2

if ! kill -0 $CLIENT_PID 2>/dev/null; then
    echo "❌ Client process ($CLIENT_PID) has already died!"
    echo "🔍 Client logs from $LOG_DIR/client.log:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -20 "$LOG_DIR/client.log" 2>/dev/null || echo "❌ Could not read client log file"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
echo "✅ Client process ($CLIENT_PID) is running"

if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Server process ($SERVER_PID) has already died!"
    echo "🔍 Server logs from $LOG_DIR/server.log:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -20 "$LOG_DIR/server.log" 2>/dev/null || echo "❌ Could not read server log file"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi
echo "✅ Server process ($SERVER_PID) is running"

# Wait for services to start
echo "⏳ Waiting for services to start..."
for i in {1..10}; do
    if [ $((i % 3)) -eq 0 ]; then
        echo "⏳ Waiting... ($i/10)"
    fi
    sleep 1
done

# Check if processes are still alive before health checks
echo "🔍 Re-checking process status before health checks..."
if ! kill -0 $CLIENT_PID 2>/dev/null; then
    echo "❌ Client process died during startup!"
    echo "🔍 Final client logs:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -30 "$LOG_DIR/client.log" 2>/dev/null || echo "❌ Could not read client log file"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "❌ Server process died during startup!"
    echo "🔍 Final server logs:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -30 "$LOG_DIR/server.log" 2>/dev/null || echo "❌ Could not read server log file"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

# Check if services are running
echo "🏥 Running health checks..."

echo "🔍 Testing client connection to http://localhost:5173..."
if ! curl -s --connect-timeout 5 --max-time 10 http://localhost:5173 > /dev/null; then
    echo "❌ Client failed to start on port 5173"
    echo "🔍 Checking if port 5173 is listening..."
    if ! netstat -tuln | grep :5173; then
        echo "❌ Nothing is listening on port 5173"
    fi
    echo "🔍 Client process status:"
    if kill -0 $CLIENT_PID 2>/dev/null; then
        echo "✅ Client process is still running"
        echo "🔍 Recent client logs:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        tail -10 "$LOG_DIR/client.log" 2>/dev/null || echo "❌ Could not read client log file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
        echo "❌ Client process has died"
        echo "🔍 Client death logs:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        tail -20 "$LOG_DIR/client.log" 2>/dev/null || echo "❌ Could not read client log file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    exit 1
fi
echo "✅ Client health check passed"

echo "🔍 Testing server connection to http://localhost:3001/api/health..."
if ! curl -s --connect-timeout 5 --max-time 10 http://localhost:3001/api/health > /dev/null; then
    echo "❌ Server failed to start on port 3001"
    echo "🔍 Checking if port 3001 is listening..."
    if ! netstat -tuln | grep :3001; then
        echo "❌ Nothing is listening on port 3001"
    fi
    echo "🔍 Server process status:"
    if kill -0 $SERVER_PID 2>/dev/null; then
        echo "✅ Server process is still running"
        echo "🔍 Recent server logs:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        tail -10 "$LOG_DIR/server.log" 2>/dev/null || echo "❌ Could not read server log file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
        echo "❌ Server process has died"
        echo "🔍 Server death logs:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        tail -20 "$LOG_DIR/server.log" 2>/dev/null || echo "❌ Could not read server log file"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    echo "🔍 Trying basic server connection..."
    curl -v http://localhost:3001/ || echo "❌ Basic server connection failed"
    exit 1
fi
echo "✅ Server health check passed"

echo "✅ Services started successfully!"
echo "📝 Debug logs available at:"
echo "   Client: $LOG_DIR/client.log"
echo "   Server: $LOG_DIR/server.log"
echo ""

# Start cloudflared
echo ""
echo "🌐 Starting Cloudflared tunnel..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "👉 IMPORTANT: Copy the URL that appears below"
echo "👉 Add it to Discord Developer Portal → Activities → URL Mappings"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Setup cleanup trap early
cleanup() {
    echo "🧹 Cleanup function called..."
    echo "🔍 Killing client process: $CLIENT_PID"
    kill $CLIENT_PID 2>/dev/null || echo "⚠️  Client process already dead"
    
    echo "🔍 Killing server process: $SERVER_PID"
    kill $SERVER_PID 2>/dev/null || echo "⚠️  Server process already dead"
    
    echo "📝 Note: Cloudflared tunnel (if running) will continue - stop it manually if needed"
    echo "✅ Cleanup completed"
}

trap cleanup EXIT INT TERM

# Start tunnel
if command -v cloudflared &> /dev/null; then
    echo "🚀 Starting cloudflared tunnel..."
    cloudflared tunnel --url http://localhost:5173
else
    echo "❌ cloudflared is not installed!"
    echo ""
    echo "Install cloudflared from: https://github.com/cloudflare/cloudflared/releases"
    exit 1
fi

# Note: cloudflared will run in foreground, Ctrl+C will stop this script and tunnel
echo "📝 Note: The tunnel will run in foreground. Press Ctrl+C to stop this script."
echo "📝 Client and server processes will be automatically cleaned up on exit."