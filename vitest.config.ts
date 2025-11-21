import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Resolve @elizaos/core - check local node_modules first, then monorepo
function resolveCorePath(): string {
  const localPath = resolve(__dirname, 'node_modules/@elizaos/core');
  if (existsSync(localPath)) {
    return localPath;
  }
  // Fallback to monorepo path
  return resolve(__dirname, '../../core/src');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@elizaos/core': resolveCorePath(),
    },
  },
});
