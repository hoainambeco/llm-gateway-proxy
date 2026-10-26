import { CloudAccountSettingsStore } from './cloud-account-settings-store';

describe('CloudAccountSettingsStore', () => {
  it('returns defaultValue when key is not set', () => {
    expect(CloudAccountSettingsStore.getSetting('non-existent', 'default-val')).toBe('default-val');
    expect(CloudAccountSettingsStore.readSetting('non-existent')).toBeUndefined();
  });

  it('sets and reads settings', () => {
    CloudAccountSettingsStore.setSetting('test-key', { enabled: true, count: 5 });
    expect(CloudAccountSettingsStore.getSetting('test-key', { enabled: false, count: 0 })).toEqual({
      enabled: true,
      count: 5,
    });
    expect(CloudAccountSettingsStore.readSetting('test-key')).toEqual({ enabled: true, count: 5 });
  });
});
