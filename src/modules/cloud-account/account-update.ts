import { BadRequestException } from '@nestjs/common';

export interface AccountUpdateInput {
  name?: string | null;
  is_active?: boolean;
}

const ALLOWED_KEYS = new Set(['name', 'is_active']);
const MAX_NAME_LENGTH = 255;

function badRequest(message: string): BadRequestException {
  return new BadRequestException(message);
}

/**
 * Validates the body of `PATCH /internal/accounts/:id`.
 *
 * Only `name` and `is_active` may be changed; email and every other account
 * field is deliberately excluded. Anything unexpected is rejected before any
 * write happens, so a failed request can never leave a partial update behind.
 */
export function parseAccountUpdateInput(body: unknown): AccountUpdateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object');
  }

  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length === 0) {
    throw badRequest('At least one of "name" or "is_active" is required');
  }

  for (const key of keys) {
    if (!ALLOWED_KEYS.has(key)) {
      throw badRequest(`Unknown field "${key}"; only "name" and "is_active" can be updated`);
    }
  }

  const input = body as Record<string, unknown>;
  const parsed: AccountUpdateInput = {};

  if ('name' in input) {
    const name = input.name;
    if (name !== null && typeof name !== 'string') {
      throw badRequest('Field "name" must be a string or null');
    }
    if (typeof name === 'string' && name.length > MAX_NAME_LENGTH) {
      throw badRequest(`Field "name" must be at most ${MAX_NAME_LENGTH} characters`);
    }
    const trimmed = typeof name === 'string' ? name.trim() : '';
    parsed.name = trimmed.length > 0 ? trimmed : null;
  }

  if ('is_active' in input) {
    const isActive = input.is_active;
    if (typeof isActive !== 'boolean') {
      throw badRequest('Field "is_active" must be a boolean');
    }
    parsed.is_active = isActive;
  }

  return parsed;
}
