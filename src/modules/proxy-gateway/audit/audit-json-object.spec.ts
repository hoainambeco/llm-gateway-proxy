import {
  isAuditJsonObject,
  auditJsonObject,
  parseAuditJsonBody,
} from './audit-json-object';

describe('audit-json-object', () => {
  describe('isAuditJsonObject', () => {
    it('returns true for plain objects', () => {
      expect(isAuditJsonObject({})).toBe(true);
      expect(isAuditJsonObject({ a: 1, b: 'text' })).toBe(true);
      expect(isAuditJsonObject(Object.create(null))).toBe(true);
    });

    it('returns false for non-objects, arrays, and null', () => {
      expect(isAuditJsonObject(null)).toBe(false);
      expect(isAuditJsonObject(undefined)).toBe(false);
      expect(isAuditJsonObject([])).toBe(false);
      expect(isAuditJsonObject([1, 2, 3])).toBe(false);
      expect(isAuditJsonObject('string')).toBe(false);
      expect(isAuditJsonObject(123)).toBe(false);
      expect(isAuditJsonObject(true)).toBe(false);
    });
  });

  describe('auditJsonObject', () => {
    it('returns object if valid audit object, otherwise null', () => {
      const obj = { foo: 'bar' };
      expect(auditJsonObject(obj)).toBe(obj);
      expect(auditJsonObject(null)).toBeNull();
      expect(auditJsonObject([])).toBeNull();
      expect(auditJsonObject('string')).toBeNull();
    });
  });

  describe('parseAuditJsonBody', () => {
    it('parses valid JSON string', () => {
      expect(parseAuditJsonBody('{"key":"value","num":42}')).toEqual({
        key: 'value',
        num: 42,
      });
    });

    it('parses Buffer containing JSON string', () => {
      const buffer = Buffer.from('{"hello":"world"}', 'utf-8');
      expect(parseAuditJsonBody(buffer)).toEqual({ hello: 'world' });
    });

    it('returns original value for non-string non-buffer inputs', () => {
      const obj = { already: 'parsed' };
      expect(parseAuditJsonBody(obj)).toBe(obj);
      expect(parseAuditJsonBody(12345)).toBe(12345);
      expect(parseAuditJsonBody(null)).toBeNull();
    });

    it('returns undefined for malformed JSON string or buffer', () => {
      expect(parseAuditJsonBody('invalid-json{')).toBeUndefined();
      expect(parseAuditJsonBody(Buffer.from('not-json{'))).toBeUndefined();
    });
  });
});
