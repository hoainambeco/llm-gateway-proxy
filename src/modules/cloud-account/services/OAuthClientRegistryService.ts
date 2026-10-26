import { isEmpty, isString } from 'lodash-es';
import { logger } from '@/shared/logging/logger';

const OAUTH_CLIENTS_ENV = 'ANTIGRAVITY_OAUTH_CLIENTS';
const ACTIVE_OAUTH_CLIENT_ENV = 'ANTIGRAVITY_OAUTH_CLIENT_KEY';
const BUILTIN_CLIENT_ID_ENV = 'ANTIGRAVITY_OAUTH_CLIENT_ID';
const BUILTIN_CLIENT_SECRET_ENV = 'ANTIGRAVITY_OAUTH_CLIENT_SECRET';
const DEFAULT_OAUTH_CLIENT_KEY = 'antigravity_enterprise';

export const MISSING_OAUTH_CLIENT_MESSAGE =
  `No OAuth client configured. Set ${BUILTIN_CLIENT_ID_ENV} and ${BUILTIN_CLIENT_SECRET_ENV}, ` +
  `or add an entry to ${OAUTH_CLIENTS_ENV}. ` +
  'This build ships no credentials: see the "OAuth Client Credentials" section of the README.';

export interface OAuthClientConfig {
  key: string;
  label: string;
  client_id: string;
  client_secret: string;
  is_builtin: boolean;
}

interface OAuthClientRegistry {
  clients: OAuthClientConfig[];
  activeKey: string;
}

export interface OAuthClientDescriptor {
  key: string;
  label: string;
  client_id: string;
  is_active: boolean;
  is_builtin: boolean;
}

let cachedOAuthClientRegistry: OAuthClientRegistry | null = null;

export function normalizeOAuthClientKey(key: string): string {
  return key.trim().toLowerCase();
}

function getClientByKey(
  clients: OAuthClientConfig[],
  clientKey: string | undefined,
): OAuthClientConfig | null {
  if (!clientKey) {
    return null;
  }
  const normalizedKey = normalizeOAuthClientKey(clientKey);
  return clients.find((client) => client.key === normalizedKey) ?? null;
}

function readEnvOverride(name: string): string | null {
  const raw = process.env[name];
  if (!isString(raw) || isEmpty(raw.trim())) {
    return null;
  }
  return raw.trim();
}

// No credentials are compiled into this build: the scopes this proxy requests are only
// granted to Google's own first-party clients, so the pair cannot be ours to ship.
// The default client therefore exists only when the environment supplies both halves.
function buildBuiltinClient(): OAuthClientConfig | null {
  const clientId = readEnvOverride(BUILTIN_CLIENT_ID_ENV);
  const clientSecret = readEnvOverride(BUILTIN_CLIENT_SECRET_ENV);

  if (clientId === null && clientSecret === null) {
    return null;
  }

  if (clientId === null || clientSecret === null) {
    logger.warn(
      `[OAuthClientRegistryService] ${BUILTIN_CLIENT_ID_ENV} and ${BUILTIN_CLIENT_SECRET_ENV} must be set together; ignoring the incomplete pair`,
    );
    return null;
  }

  return {
    key: normalizeOAuthClientKey(DEFAULT_OAUTH_CLIENT_KEY),
    label: 'Antigravity Enterprise',
    client_id: clientId,
    client_secret: clientSecret,
    is_builtin: true,
  };
}

function buildOAuthClientRegistry(): OAuthClientRegistry {
  const builtinClient = buildBuiltinClient();
  const clients: OAuthClientConfig[] = builtinClient === null ? [] : [builtinClient];

  const rawExtraClients = process.env[OAUTH_CLIENTS_ENV];
  if (isString(rawExtraClients) && !isEmpty(rawExtraClients.trim())) {
    // Never interpolate a raw entry into a log line: it carries the client_secret.
    const entries = rawExtraClients.split(';');
    for (let index = 0; index < entries.length; index += 1) {
      const trimmed = entries[index].trim();
      if (trimmed === '') {
        continue;
      }

      const position = `entry #${index + 1}`;
      const parts = trimmed.split('|').map((part) => part.trim());
      if (parts.length < 3) {
        logger.warn(
          `[OAuthClientRegistryService] Ignored invalid OAuth client ${position} in ${OAUTH_CLIENTS_ENV}: expected 'key|client_id|client_secret[|label]', got ${parts.length} field(s)`,
        );
        continue;
      }

      const key = normalizeOAuthClientKey(parts[0]);
      const clientId = parts[1];
      const clientSecret = parts[2];
      if (key === '' || clientId === '' || clientSecret === '') {
        const missing = [
          key === '' ? 'key' : null,
          clientId === '' ? 'client_id' : null,
          clientSecret === '' ? 'client_secret' : null,
        ]
          .filter((field): field is string => field !== null)
          .join(', ');
        logger.warn(
          `[OAuthClientRegistryService] Ignored incomplete OAuth client ${position} in ${OAUTH_CLIENTS_ENV}: missing ${missing}`,
        );
        continue;
      }

      const existingIndex = clients.findIndex((client) => client.key === key);
      const clientConfig: OAuthClientConfig = {
        key,
        label: parts[3] && parts[3] !== '' ? parts[3] : key,
        client_id: clientId,
        client_secret: clientSecret,
        is_builtin: existingIndex >= 0 ? clients[existingIndex].is_builtin : false,
      };

      if (existingIndex >= 0) {
        clients[existingIndex] = clientConfig;
      } else {
        clients.push(clientConfig);
      }
    }
  }

  if (clients.length === 0) {
    logger.warn(`[OAuthClientRegistryService] ${MISSING_OAUTH_CLIENT_MESSAGE}`);
  }

  let activeKey = normalizeOAuthClientKey(
    process.env[ACTIVE_OAUTH_CLIENT_ENV] || DEFAULT_OAUTH_CLIENT_KEY,
  );
  if (!clients.some((client) => client.key === activeKey)) {
    activeKey = clients[0]?.key ?? normalizeOAuthClientKey(DEFAULT_OAUTH_CLIENT_KEY);
  }

  return {
    clients,
    activeKey,
  };
}

function getOAuthClientRegistry(): OAuthClientRegistry {
  if (cachedOAuthClientRegistry) {
    return cachedOAuthClientRegistry;
  }
  cachedOAuthClientRegistry = buildOAuthClientRegistry();
  return cachedOAuthClientRegistry;
}

export class OAuthClientRegistryService {
  static listOAuthClients(): OAuthClientDescriptor[] {
    const registry = getOAuthClientRegistry();
    return registry.clients.map((client) => {
      return {
        key: client.key,
        label: client.label,
        client_id: client.client_id,
        is_active: client.key === registry.activeKey,
        is_builtin: client.is_builtin,
      };
    });
  }

  static getActiveOAuthClientKey(): string {
    const registry = getOAuthClientRegistry();
    return registry.activeKey;
  }

  static setActiveOAuthClientKey(clientKey: string): void {
    const registry = getOAuthClientRegistry();
    const normalized = normalizeOAuthClientKey(clientKey);
    const exists = registry.clients.some((client) => client.key === normalized);
    if (!exists) {
      const available = registry.clients.map((client) => client.key).join(', ');
      throw new Error(`Unknown OAuth client key '${clientKey}'. Available: ${available}`);
    }
    registry.activeKey = normalized;
    process.env[ACTIVE_OAUTH_CLIENT_ENV] = normalized;
  }

  static getCandidateClients(preferredClientKey?: string): OAuthClientConfig[] {
    const registry = getOAuthClientRegistry();
    const candidates: OAuthClientConfig[] = [];
    const seen = new Set<string>();

    const pushCandidate = (candidate: OAuthClientConfig | null) => {
      if (!candidate || seen.has(candidate.key)) {
        return;
      }
      seen.add(candidate.key);
      candidates.push(candidate);
    };

    const preferred = getClientByKey(registry.clients, preferredClientKey);
    if (preferredClientKey && !preferred) {
      logger.warn(
        `[OAuthClientRegistryService] Preferred OAuth client '${preferredClientKey}' not found; fallback to active client list`,
      );
    }

    pushCandidate(preferred);
    pushCandidate(getClientByKey(registry.clients, registry.activeKey));

    for (const client of registry.clients) {
      pushCandidate(client);
    }

    return candidates;
  }

  static selectAuthClient(clientKey?: string): OAuthClientConfig {
    const registry = getOAuthClientRegistry();
    if (registry.clients.length === 0) {
      throw new Error(MISSING_OAUTH_CLIENT_MESSAGE);
    }

    if (isString(clientKey) && !isEmpty(clientKey.trim())) {
      const selected = getClientByKey(registry.clients, clientKey);
      if (!selected) {
        throw new Error(`Unknown OAuth client key: ${clientKey}`);
      }
      return selected;
    }

    return getClientByKey(registry.clients, registry.activeKey) ?? registry.clients[0];
  }

  static normalizeRefreshedOAuthClientKey(
    currentToken: { oauth_client_key?: string; project_id?: string },
    refreshedClientKey?: string,
  ): string | undefined {
    const resolved = refreshedClientKey ?? currentToken.oauth_client_key;
    const projectMissing =
      !isString(currentToken.project_id) || isEmpty(currentToken.project_id.trim());

    if (
      !isString(currentToken.oauth_client_key) &&
      projectMissing &&
      resolved &&
      normalizeOAuthClientKey(resolved) === DEFAULT_OAUTH_CLIENT_KEY
    ) {
      logger.warn(
        '[OAuthClientRegistryService] Refreshed token via enterprise client for a legacy account without project_id; keep oauth_client_key unset to avoid accidental enterprise lock',
      );
      return undefined;
    }

    return resolved ? normalizeOAuthClientKey(resolved) : undefined;
  }

  static resetStateForTesting(): void {
    cachedOAuthClientRegistry = null;
  }
}
