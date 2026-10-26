import { getStandaloneDataSource } from '../../src/modules/database/database.config';
import { ApiKey } from '../../src/modules/api-key/entities/api-key.entity';
import { startTestServer } from './helpers/server';

describe('first-run admin bootstrap', () => {
  it('creates exactly one admin key when the database starts empty', async () => {
    const server = await startTestServer({ seedKeys: false });
    try {
      const ds = await getStandaloneDataSource();
      const admins = await ds.getRepository(ApiKey).find({ where: { role: 'admin' } });
      await ds.destroy();
      expect(admins).toHaveLength(1);
      expect(admins[0].keyPreview).toMatch(/^sk-ag-[0-9a-f]{2}\.\.\.[0-9a-f]{4}$/);
      expect(admins[0].isActive).toBe(true);
    } finally {
      await server.close();
    }
  });
});
