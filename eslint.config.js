import pluginConfig from '@elizaos/config/eslint/eslint.config.plugin.js';

/**
 * ESLint configuration for plugin-discord
 * Extends the standard ElizaOS plugin configuration which includes:
 * - @elizaos/structured-logging rule
 * - TypeScript support
 * - Standard code quality rules
 */
export default [
  ...pluginConfig,
];
