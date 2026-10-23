import { ApiKeyService } from './api-key.service';

function repoWith(existing: any[]) {
  const saved: any[] = [];
  return {
    saved,
    repo: {
      find: jest.fn().mockResolvedValue(existing),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => {
        saved.push(v);
        return { ...v, id: 'key-1' };
      }),
    },
  };
}

describe('ApiKeyService.ensureBootstrapAdminKey', () => {
  it('creates one admin key when none exists', async () => {
    const { repo, saved } = repoWith([]);
    const service = new ApiKeyService(repo as any);
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    const raw = await service.ensureBootstrapAdminKey();

    expect(raw).toMatch(/^sk-ag-[0-9a-f]{48}$/);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Bootstrap admin', role: 'admin', isActive: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(raw!));
  });

  it('does nothing when an active admin key exists', async () => {
    const { repo, saved } = repoWith([{ role: 'admin', isActive: true }]);
    const service = new ApiKeyService(repo as any);
    await expect(service.ensureBootstrapAdminKey()).resolves.toBeNull();
    expect(saved).toHaveLength(0);
  });
});
