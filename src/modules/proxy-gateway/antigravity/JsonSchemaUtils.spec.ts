import { cleanJsonSchema, normalizeObjectJsonSchema } from './JsonSchemaUtils';

describe('JsonSchemaUtils', () => {
  describe('normalizeObjectJsonSchema', () => {
    it('returns fallback schema for null, undefined, or non-object input', () => {
      expect(normalizeObjectJsonSchema(null)).toEqual({ type: 'object', properties: {} });
      expect(normalizeObjectJsonSchema(undefined)).toEqual({ type: 'object', properties: {} });
      expect(normalizeObjectJsonSchema('string')).toEqual({ type: 'object', properties: {} });
      expect(normalizeObjectJsonSchema(123)).toEqual({ type: 'object', properties: {} });
    });

    it('ensures object type and properties are present', () => {
      const res = normalizeObjectJsonSchema({});
      expect(res.type).toBe('object');
      expect(res.properties).toEqual({});
    });

    it('cleans valid schema and preserves properties', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'User name' },
        },
        required: ['name'],
      };
      const res = normalizeObjectJsonSchema(schema);
      expect(res.type).toBe('object');
      expect(res.properties).toBeDefined();
      expect((res.properties as any).name.type).toBe('string');
      expect(res.required).toEqual(['name']);
    });
  });

  describe('cleanJsonSchema', () => {
    it('flattens $defs and definitions referenced by $ref', () => {
      const schema = {
        $defs: {
          Address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
            },
          },
        },
        definitions: {
          Phone: {
            type: 'string',
            pattern: '^[0-9]+$',
          },
        },
        type: 'object',
        properties: {
          homeAddress: { $ref: '#/$defs/Address' },
          contactPhone: { $ref: '#/definitions/Phone' },
        },
      };

      cleanJsonSchema(schema as any);

      expect((schema as any).$defs).toBeUndefined();
      expect((schema as any).definitions).toBeUndefined();
      expect((schema as any).properties.homeAddress.type).toBe('object');
      expect((schema as any).properties.homeAddress.properties.street.type).toBe('string');
      expect((schema as any).properties.contactPhone.type).toBe('string');
      expect((schema as any).properties.contactPhone.description).toContain('Constraint: pattern: ^[0-9]+$');
    });

    it('handles nested references and arrays of references', () => {
      const schema = {
        $defs: {
          Item: {
            type: 'string',
          },
        },
        type: 'object',
        properties: {
          list: {
            type: 'array',
            items: { $ref: '#/$defs/Item' },
          },
        },
      };

      cleanJsonSchema(schema as any);
      expect((schema as any).properties.list.items.type).toBe('string');
      expect((schema as any).properties.list.items.$ref).toBeUndefined();
    });

    it('normalizes const keywords into enum and infers type', () => {
      const stringConst = { const: 'fixed-val' };
      cleanJsonSchema(stringConst as any);
      expect(stringConst).toEqual({
        type: 'string',
        enum: ['fixed-val'],
      });

      const intConst = { const: 42 };
      cleanJsonSchema(intConst as any);
      expect(intConst).toEqual({
        type: 'integer',
        enum: ['42'],
      });

      const floatConst = { const: 3.14 };
      cleanJsonSchema(floatConst as any);
      expect(floatConst).toEqual({
        type: 'number',
        enum: ['3.14'],
      });

      const boolConst = { const: true };
      cleanJsonSchema(boolConst as any);
      expect(boolConst).toEqual({
        type: 'boolean',
        enum: ['true'],
      });

      const arrConst = { const: ['a', 'b'] };
      cleanJsonSchema(arrConst as any);
      expect((arrConst as any).type).toBe('array');
      expect((arrConst as any).items).toEqual({ type: 'string' });

      const objConst = { const: { foo: 'bar' } };
      cleanJsonSchema(objConst as any);
      expect((objConst as any).type).toBe('object');
    });

    it('collapses allOf, anyOf, and oneOf schemas into the parent node', () => {
      const schema = {
        type: 'object',
        properties: {
          base: { type: 'string' },
        },
        allOf: [
          {
            properties: {
              extra: { type: 'integer' },
            },
            required: ['extra'],
          },
        ],
        anyOf: [
          {
            type: 'object',
            description: 'branch description',
          },
        ],
      };

      cleanJsonSchema(schema as any);
      expect((schema as any).allOf).toBeUndefined();
      expect((schema as any).anyOf).toBeUndefined();
      expect((schema as any).properties.base.type).toBe('string');
      expect((schema as any).properties.extra.type).toBe('integer');
      expect((schema as any).required).toEqual(['extra']);
      expect((schema as any).description).toBe('branch description');
    });

    it('removes blacklisted fields and preserves Gemini-supported schema', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        additionalProperties: false,
        uniqueItems: true,
        default: {},
        examples: [{ name: 'foo' }],
        cache_control: { type: 'ephemeral' },
        tools: ['some_tool'],
        properties: {
          name: {
            type: 'string',
            minLength: 2,
            maxLength: 50,
          },
          age: {
            type: 'integer',
            minimum: 18,
            maximum: 120,
            multipleOf: 1,
          },
        },
      };

      cleanJsonSchema(schema as any);
      expect((schema as any).$schema).toBeUndefined();
      expect((schema as any).additionalProperties).toBeUndefined();
      expect((schema as any).uniqueItems).toBeUndefined();
      expect((schema as any).default).toBeUndefined();
      expect((schema as any).examples).toBeUndefined();
      expect((schema as any).cache_control).toBeUndefined();
      expect((schema as any).tools).toBeUndefined();

      expect((schema as any).properties.name.description).toContain('Constraint: minLen: 2, maxLen: 50');
      expect((schema as any).properties.age.description).toContain('Constraint: min: 18, max: 120, multipleOf: 1');
    });

    it('converts union types by picking the first non-null type in lowercase', () => {
      const schema = {
        type: 'object',
        properties: {
          optStr: { type: ['null', 'String'] },
          optNum: { type: ['integer', 'null'] },
          onlyNull: { type: ['null'] },
        },
      };

      cleanJsonSchema(schema as any);
      expect((schema as any).properties.optStr.type).toBe('string');
      expect((schema as any).properties.optNum.type).toBe('integer');
      expect((schema as any).properties.onlyNull.type).toBe('string');
    });

    it('cleans invalid properties entries and updates required fields', () => {
      const schema = {
        type: 'object',
        properties: {
          validProp: { type: 'string' },
          invalidProp: null, // invalid non-object property
        },
        required: ['validProp', 'invalidProp'],
      };

      cleanJsonSchema(schema as any);
      expect((schema as any).properties.invalidProp).toBeUndefined();
      expect((schema as any).properties.validProp).toBeDefined();
      expect((schema as any).required).toEqual(['validProp']);
    });

    it('deletes required array if all required properties are dropped', () => {
      const schema = {
        type: 'object',
        properties: {
          invalidOnly: 123,
        },
        required: ['invalidOnly'],
      };

      cleanJsonSchema(schema as any);
      expect((schema as any).required).toBeUndefined();
    });

    it('handles enum fields: non-array enum removed, empty primitive enum removed', () => {
      const invalidEnum = { type: 'string', enum: 'not-an-array' };
      cleanJsonSchema(invalidEnum as any);
      expect(invalidEnum.enum).toBeUndefined();

      const emptyEnum = { type: 'string', enum: [{ complex: 'object' }] };
      cleanJsonSchema(emptyEnum as any);
      expect(emptyEnum.enum).toBeUndefined();
    });

    it('handles array without items and adds default string items', () => {
      const arraySchema = { type: 'ARRAY' };
      cleanJsonSchema(arraySchema as any);
      expect((arraySchema as any).type).toBe('array');
      expect((arraySchema as any).items).toEqual({ type: 'string' });
    });
  });
});
