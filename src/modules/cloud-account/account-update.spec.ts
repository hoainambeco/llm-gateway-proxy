import { BadRequestException } from '@nestjs/common';
import { parseAccountUpdateInput } from './account-update';

describe('parseAccountUpdateInput', () => {
  it('trims a non-empty name and maps empty name to null', () => {
    expect(parseAccountUpdateInput({ name: '  Main  ' })).toEqual({ name: 'Main' });
    expect(parseAccountUpdateInput({ name: '   ' })).toEqual({ name: null });
  });

  it('accepts a boolean is_active', () => {
    expect(parseAccountUpdateInput({ is_active: false })).toEqual({ is_active: false });
  });

  it('rejects unknown fields', () => {
    expect(() => parseAccountUpdateInput({ email: 'x@y.z' })).toThrow(BadRequestException);
    expect(() => parseAccountUpdateInput({ name: 'x', provider: 'openai' })).toThrow(BadRequestException);
  });

  it('rejects wrong types and an empty body', () => {
    expect(() => parseAccountUpdateInput({ is_active: 'no' })).toThrow(BadRequestException);
    expect(() => parseAccountUpdateInput({})).toThrow(BadRequestException);
    expect(() => parseAccountUpdateInput(null)).toThrow(BadRequestException);
  });
});
