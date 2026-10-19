import type {
  Account,
  ApiKeyItem,
  AuditRecord,
  AuthValidateResult,
  ModelEntry,
  RoutingConfig,
  SystemStatus,
} from '../types';
import { getAdminKey } from './keyStorage';

const BASE_URL = '';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const savedKey = getAdminKey() || '';
  const headers: Record<string, string> = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(savedKey ? { Authorization: `Bearer ${savedKey}` } : {}),
    ...(options?.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(errorText);
      message = parsed.error?.message || parsed.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return res.json();
}

export const api = {
  validateKey: (key: string) =>
    fetchJson<AuthValidateResult>('/internal/auth/validate', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  getSystemStatus: () => fetchJson<SystemStatus>('/internal/system/status'),

  getAccounts: async () => {
    const res = await fetchJson<{ data: Account[]; total: number }>(
      '/internal/accounts',
    );
    return res.data;
  },

  syncAccounts: (id?: string) =>
    fetchJson<{ success: boolean; message: string }>(
      id
        ? `/internal/accounts/sync?id=${encodeURIComponent(id)}`
        : '/internal/accounts/sync',
      { method: 'POST' },
    ),

  deleteAccount: (id: string) =>
    fetchJson<{ success: boolean; message: string }>(
      `/internal/accounts/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      },
    ),

  getOAuthUrl: (customRedirectUri?: string) =>
    fetchJson<{ url: string }>(
      customRedirectUri
        ? `/internal/accounts/oauth/url?redirect_uri=${encodeURIComponent(customRedirectUri)}`
        : '/internal/accounts/oauth/url',
    ),

  addAccount: (data: any) =>
    fetchJson<{ success: boolean; message: string }>('/internal/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  initClaudeOAuth: (redirectUri?: string) =>
    fetchJson<{
      authUrl: string;
      codeVerifier: string;
      state: string;
      redirectUri: string;
    }>(
      redirectUri
        ? `/internal/accounts/oauth/claude/init?redirect_uri=${encodeURIComponent(redirectUri)}`
        : '/internal/accounts/oauth/claude/init',
    ),

  exchangeClaudeOAuth: (data: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    state?: string;
    email?: string;
  }) =>
    fetchJson<{ success: boolean; account: any }>(
      '/internal/accounts/oauth/claude/exchange',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  initOpenAIOAuth: (redirectUri?: string) =>
    fetchJson<{
      authUrl: string;
      codeVerifier: string;
      state: string;
      redirectUri: string;
    }>(
      redirectUri
        ? `/internal/accounts/oauth/openai/init?redirect_uri=${encodeURIComponent(redirectUri)}`
        : '/internal/accounts/oauth/openai/init',
    ),

  exchangeOpenAIOAuth: (data: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    email?: string;
  }) =>
    fetchJson<{ success: boolean; account: any }>(
      '/internal/accounts/oauth/openai/exchange',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  startCopilotDeviceFlow: () =>
    fetchJson<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    }>('/internal/accounts/copilot/device/code', {
      method: 'POST',
    }),

  pollCopilotDeviceCode: (data: { device_code: string; email?: string }) =>
    fetchJson<{
      status: 'success' | 'pending' | 'error' | 'slow_down';
      account?: any;
      message?: string;
      retryIntervalSeconds?: number;
    }>('/internal/accounts/copilot/device/poll', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getRoutingConfig: async () => {
    const res = await fetchJson<{ success: boolean; data: RoutingConfig }>(
      '/internal/routing',
    );
    return res.data;
  },

  updateRoutingConfig: (data: RoutingConfig) =>
    fetchJson<{ success: boolean; message: string; data: RoutingConfig }>(
      '/internal/routing',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
    ),

  getModels: async () => {
    const res = await fetchJson<{ data: ModelEntry[] }>('/v1/models');
    return res.data;
  },

  getApiKeys: async () => {
    const res = await fetchJson<{ success: boolean; data: ApiKeyItem[] }>(
      '/internal/api-keys',
    );
    return res.data;
  },

  getModelSpecs: async () => {
    const res = await fetchJson<{
      success: boolean;
      data: Array<{ id: string; maxOutputTokens: number }>;
    }>('/internal/model-specs');
    return res.data;
  },

  createApiKey: (data: {
    name: string;
    role?: 'admin' | 'client';
    allowedAccountIds?: string[] | null;
    description?: string;
  }) =>
    fetchJson<{ success: boolean; data: ApiKeyItem }>('/internal/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateApiKey: (
    id: string,
    data: {
      name?: string;
      isActive?: boolean;
      allowedAccountIds?: string[] | null;
    },
  ) =>
    fetchJson<{ success: boolean; data: ApiKeyItem }>(
      `/internal/api-keys/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
    ),

  deleteApiKey: (id: string) =>
    fetchJson<{ success: boolean }>(`/internal/api-keys/${id}`, {
      method: 'DELETE',
    }),

  getAuditRequests: async () => {
    try {
      const res = await fetchJson<{ data: AuditRecord[] }>(
        '/internal/audit/requests',
      );
      return res.data || [];
    } catch {
      return [];
    }
  },
};
