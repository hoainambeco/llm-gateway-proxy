/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/e2e'],
  testMatch: ['**/*.e2e-spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^lodash-es$': 'lodash',
    // See test/e2e/helpers/fastify-static-stub.cjs:
    // the real package pulls in ESM-only deps Jest's CJS runtime cannot require.
    '^@fastify/static$': '<rootDir>/test/e2e/helpers/fastify-static-stub.cjs',
  },
  setupFiles: ['<rootDir>/test/setup/jest.setup.ts'],
  maxWorkers: 1,
  testTimeout: 30000,
};
