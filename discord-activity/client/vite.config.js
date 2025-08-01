import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,  // Changed to avoid conflict with ElizaOS API
    strictPort: true,  // Exit if port is already in use instead of trying another
    // Allow all hosts for tunnel services (ngrok, cloudflare, etc)
    host: true,
    allowedHosts: [
      'localhost',
      '.trycloudflare.com',  // Cloudflare tunnel domains
      '.ngrok.io',           // ngrok domains
      '.ngrok-free.app',     // ngrok free tier domains
      '.discordsays.com',    // Discord Activity domains
    ],
    proxy: {
      // Route API calls to the backend server
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
        // Add headers to bypass ngrok interstitial
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            proxyReq.setHeader('ngrok-skip-browser-warning', 'true');
          });
        }
      }
    },
    hmr: {
      clientPort: 5173
    },
    headers: {
      // Headers to work with Discord and ngrok
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;",
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
}); 