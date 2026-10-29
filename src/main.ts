// Must be the first import: it disables redirect-following on the shared axios
// defaults before any module creates its own axios instance.
import '@/shared/http/axios-hardening';
import 'dotenv/config';
import { DEFAULT_APP_CONFIG, ProxyConfig } from './modules/config/types';
import { bootstrapNestServer, stopNestServer } from './server/main';
import { logger } from './shared/logging/logger';

async function run() {
  const port = parseInt(process.env.PORT || '8045', 10);
  const apiKey = (
    process.env.PROXY_API_KEY ||
    process.env.INITIAL_ADMIN_KEY ||
    ''
  ).trim();

  const config: ProxyConfig = {
    ...DEFAULT_APP_CONFIG.proxy,
    enabled: true,
    port,
    api_key: apiKey,
    auto_start: true,
  };

  logger.info(`Starting LLM Gateway Proxy Standalone on port ${port}...`);
  if (apiKey) {
    logger.info(`Admin API Key configured via environment variable.`);
  } else {
    logger.info(
      `Model requests require dynamic API keys managed via Dashboard or CLI.`,
    );
  }

  const result = await bootstrapNestServer(config);

  if (result.success) {
    console.log(`\n======================================================`);
    console.log(
      `🚀 LLM Gateway Proxy is RUNNING on http://0.0.0.0:${result.port}`,
    );
    console.log(`======================================================`);
    console.log(`Supported endpoints:`);
    console.log(`  • Web UI:    http://localhost:${result.port}/`);
    console.log(
      `  • OpenAI:    http://localhost:${result.port}/v1/chat/completions`,
    );
    console.log(`  • OpenAI:    http://localhost:${result.port}/v1/models`);
    console.log(`  • Anthropic: http://localhost:${result.port}/v1/messages`);
    console.log(
      `  • Gemini:    http://localhost:${result.port}/v1beta/models/...`,
    );
    console.log(`\nUse this with Cursor, Claude Code, Cline, OpenCode, etc.`);
    console.log(`======================================================\n`);
  } else {
    const errorMsg = 'message' in result ? result.message : 'Unknown error';
    logger.error(`Failed to start proxy server: ${errorMsg}`);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down LLM Gateway Proxy...`);
    await stopNestServer();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

run().catch((err) => {
  logger.error('Fatal error during startup:', err);
  process.exit(1);
});
