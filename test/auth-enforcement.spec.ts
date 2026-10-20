import assert from "node:assert";
import { ApiKeyService } from "../src/modules/api-key/api-key.service";
import { AdminGuard } from "../src/modules/proxy-gateway/server/guards/admin.guard";
import { ProxyGuard } from "../src/modules/proxy-gateway/server/guards/proxy.guard";
import { UnauthorizedException } from "@nestjs/common";

async function runTests() {
  console.log("Running Task 1 Auth Enforcement Unit Tests...");

  // Setup mock repository for ApiKeyService
  const mockRepo = {
    find: async () => [],
    findOne: async () => null,
    update: async () => {},
  } as any;

  // Set PROXY_API_KEY in environment to verify it is completely ignored
  process.env.PROXY_API_KEY = "sk-test-master-key-should-be-ignored-completely";

  const apiKeyService = new ApiKeyService(mockRepo);
  await apiKeyService.onModuleInit();

  // Test 1: ApiKeyService should NOT validate master key from env
  const masterKeyResult = apiKeyService.validateKeySync(process.env.PROXY_API_KEY);
  assert.strictEqual(
    masterKeyResult.valid,
    false,
    "ApiKeyService must NOT validate PROXY_API_KEY as valid key"
  );
  console.log("✓ Test 1: ApiKeyService ignores PROXY_API_KEY");

  // Test 2: hasConfiguredProtection should be false when keyCache is empty, even with PROXY_API_KEY in env
  assert.strictEqual(
    apiKeyService.hasConfiguredProtection(),
    false,
    "hasConfiguredProtection must be false when DB key cache is empty"
  );
  console.log("✓ Test 2: hasConfiguredProtection ignores PROXY_API_KEY");

  // Test 3: AdminGuard should allow access when NO client token is provided (Web UI direct access)
  const adminGuard = new AdminGuard(apiKeyService);
  const mockAdminContextNoToken = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {},
        ip: "127.0.0.1",
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;

  const adminNoTokenAllowed = await adminGuard.canActivate(mockAdminContextNoToken);
  assert.strictEqual(
    adminNoTokenAllowed,
    true,
    "AdminGuard must allow unauthenticated requests for direct dashboard access"
  );
  console.log("✓ Test 3: AdminGuard allows keyless access for dashboard");

  // Test 4: AdminGuard should reject invalid token
  const mockAdminContextInvalidToken = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: "Bearer invalid-admin-token" },
        ip: "127.0.0.1",
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as any;

  let adminInvalidRejected = false;
  try {
    await adminGuard.canActivate(mockAdminContextInvalidToken);
  } catch (err: any) {
    if (err instanceof UnauthorizedException) {
      adminInvalidRejected = true;
    }
  }
  assert.strictEqual(
    adminInvalidRejected,
    true,
    "AdminGuard must reject invalid tokens with UnauthorizedException"
  );
  console.log("✓ Test 4: AdminGuard rejects invalid token");

  // Test 5: ProxyGuard MUST reject keyless requests even when no keys exist (NO Open Mode!)
  const proxyGuard = new ProxyGuard(apiKeyService);
  const mockProxyContextNoToken = {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {},
        ip: "127.0.0.1",
        url: "/v1/chat/completions",
        raw: { method: "POST" },
      }),
    }),
  } as any;

  let proxyNoTokenRejected = false;
  try {
    await proxyGuard.canActivate(mockProxyContextNoToken);
  } catch (err: any) {
    if (err instanceof UnauthorizedException) {
      proxyNoTokenRejected = true;
    }
  }
  assert.strictEqual(
    proxyNoTokenRejected,
    true,
    "ProxyGuard must reject keyless model calls with UnauthorizedException (no Open Mode)"
  );
  console.log("✓ Test 5: ProxyGuard strictly rejects keyless model calls");

  console.log("\nAll Task 1 tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
