'use strict';

/**
 * e2e-only stub for `@fastify/static`.
 *
 * The real @fastify/static is a CJS facade over ESM-only dependencies
 * (content-disposition v3, glob v13), which Jest's CJS runtime cannot
 * `require()`. The server only uses it to mount the `web/dist` dashboard,
 * which e2e tests never request, so this no-op plugin is functionally
 * equivalent inside the test harness.
 */
const fastifyStaticStub = function fastifyStaticStub(_fastify, _options, done) {
  done();
};

module.exports = Object.assign(fastifyStaticStub, { default: fastifyStaticStub });
