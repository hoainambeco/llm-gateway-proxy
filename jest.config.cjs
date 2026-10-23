/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/web/src/lib'],
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // App code imports ESM-only `lodash-es`; Jest's CJS runtime cannot require it.
    '^lodash-es$': 'lodash',
  },
  setupFiles: ['<rootDir>/test/setup/jest.setup.ts'],
  clearMocks: true,
  testTimeout: 15000,
};
