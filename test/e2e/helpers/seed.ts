import { ApiKey } from '../../../src/modules/api-key/entities/api-key.entity';
import { hashApiKey, previewApiKey } from '../../../src/modules/api-key/api-key-hash';
import { getStandaloneDataSource } from '../../../src/modules/database/database.config';
import { TrafficLog } from '../../../src/modules/proxy-gateway/audit/entities/traffic-log.entity';

export const TEST_ADMIN_KEY = `sk-ag-${'a'.repeat(48)}`;
export const TEST_CLIENT_KEY = `sk-ag-${'b'.repeat(48)}`;

export async function seedAdminKey(
  _dbPath: string,
  rawKey: string,
  role: 'admin' | 'client' = 'admin',
): Promise<{ id: string }> {
  const ds = await getStandaloneDataSource();
  try {
    const saved = await ds.getRepository(ApiKey).save({
      id: role === 'admin' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222',
      keyHash: hashApiKey(rawKey),
      keyPreview: previewApiKey(rawKey),
      name: role === 'admin' ? 'Test admin' : 'Test client',
      role,
      isActive: true,
      allowedAccountIds: null,
      expiresAt: null,
      lastUsedAt: null,
    });
    return { id: saved.id };
  } finally {
    await ds.destroy();
  }
}

export async function insertTrafficLogs(
  _dbPath: string,
  rows: Array<Partial<TrafficLog> & { id: string; timestamp: number }>,
): Promise<void> {
  const ds = await getStandaloneDataSource();
  try {
    const repo = ds.getRepository(TrafficLog);
    await repo.save(
      rows.map((row) => ({
        method: 'POST',
        endpoint: '/v1/chat/completions',
        model: 'gemini-2.5-pro',
        status: 200,
        latencyMs: 10,
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        errorMessage: null,
        apiKeyId: null,
        ...row,
      })),
    );
  } finally {
    await ds.destroy();
  }
}
