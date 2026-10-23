/**
 * Seeds the isolated Playwright run directory, then leaves it for the server.
 *
 * This module is a script: importing it deletes and recreates the run directory.
 * Specs must import constants from `./seed-data` instead, never from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { hashApiKey, previewApiKey } from '../../src/modules/api-key/api-key-hash';
import { ApiKey } from '../../src/modules/api-key/entities/api-key.entity';
import { getStandaloneDataSource } from '../../src/modules/database/database.config';
import { TrafficLog } from '../../src/modules/proxy-gateway/audit/entities/traffic-log.entity';
import {
  PW_ADMIN_KEY,
  PW_ADMIN_KEY_ID,
  PW_CLIENT_KEY,
  PW_CLIENT_KEY_ID,
  T0,
} from './seed-data';

const runDir = process.env.DATA_DIR || path.join(process.cwd(), 'test/.tmp/pw');
const accountsFile =
  process.env.ACCOUNTS_FILE || path.join(runDir, 'accounts.json');
const routingFile =
  process.env.ROUTING_CONFIG_PATH || path.join(runDir, 'routing.json');

async function main(): Promise<void> {
  // The server is not running yet, so this process owns the directory. Starting
  // from an empty one keeps a crashed earlier run from leaking keys or logs.
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });

  const accounts = [
    {
      id: 'acc-active',
      provider: 'google',
      email: 'active@test.local',
      name: 'Active account',
      created_at: 1790812800000,
      last_used: 1790812800000,
      is_active: true,
    },
    {
      id: 'acc-disabled',
      provider: 'google',
      email: 'disabled@test.local',
      name: 'Disabled account',
      created_at: 1790812800000,
      last_used: 1790812800000,
      is_active: false,
    },
    {
      id: 'acc-spare',
      provider: 'google',
      email: 'spare@test.local',
      name: 'Spare account',
      created_at: 1790812800000,
      last_used: 1790812800000,
      is_active: true,
    },
  ];

  // No `token` on any account: boot must not try to sync quota against Google.
  fs.writeFileSync(accountsFile, `${JSON.stringify(accounts, null, 2)}\n`);

  const exampleRouting = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'routing.json.example'), 'utf8'),
  ) as { rules: unknown[] };
  fs.writeFileSync(
    routingFile,
    `${JSON.stringify(
      { rules: exampleRouting.rules, default_pipeline: ['google'] },
      null,
      2,
    )}\n`,
  );

  const ds = await getStandaloneDataSource();
  try {
    const apiKeys = ds.getRepository(ApiKey);
    await apiKeys.save([
      {
        id: PW_ADMIN_KEY_ID,
        keyHash: hashApiKey(PW_ADMIN_KEY),
        keyPreview: previewApiKey(PW_ADMIN_KEY),
        name: 'Playwright admin',
        role: 'admin',
        isActive: true,
        allowedAccountIds: null,
        expiresAt: null,
        lastUsedAt: null,
      },
      {
        id: PW_CLIENT_KEY_ID,
        keyHash: hashApiKey(PW_CLIENT_KEY),
        keyPreview: previewApiKey(PW_CLIENT_KEY),
        name: 'Playwright client',
        role: 'client',
        isActive: true,
        allowedAccountIds: null,
        expiresAt: null,
        lastUsedAt: null,
      },
    ]);

    const trafficLogs = ds.getRepository(TrafficLog);
    await trafficLogs.save([
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        apiKeyId: PW_ADMIN_KEY_ID,
        timestamp: T0,
        method: 'POST',
        endpoint: '/v1/chat/completions',
        model: 'gemini-2.5-pro',
        status: 200,
        latencyMs: 120,
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        errorMessage: null,
      },
      {
        id: 'c0000000-0000-4000-8000-000000000002',
        apiKeyId: PW_CLIENT_KEY_ID,
        timestamp: T0 + 3600_000,
        method: 'POST',
        endpoint: '/v1/chat/completions',
        model: 'gemini-2.5-flash',
        status: 429,
        latencyMs: 45,
        promptTokens: 5,
        completionTokens: 0,
        totalTokens: 5,
        errorMessage: 'Rate limit exceeded',
      },
      {
        id: 'c0000000-0000-4000-8000-000000000003',
        apiKeyId: null,
        timestamp: T0 + 7200_000,
        method: 'POST',
        endpoint: '/v1/messages',
        model: 'claude-sonnet-4',
        status: 500,
        latencyMs: 900,
        promptTokens: 8,
        completionTokens: 0,
        totalTokens: 8,
        errorMessage: 'Upstream failure',
      },
    ]);
  } finally {
    await ds.destroy();
  }

  console.log(`Seeded Playwright run directory at ${runDir}`);
}

main().catch((error) => {
  console.error('Failed to seed the Playwright run directory', error);
  process.exitCode = 1;
});
