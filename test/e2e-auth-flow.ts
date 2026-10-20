import assert from "node:assert";
import axios from "axios";
import { bootstrapNestServer, stopNestServer } from "../src/server/main";
import { DEFAULT_APP_CONFIG, ProxyConfig } from "../src/modules/config/types";
import { ApiKeyService } from "../src/modules/api-key/api-key.service";

async function runE2ETests() {
  console.log("Starting E2E Auth Flow Test...");

  const testPort = 8091;
  const config: ProxyConfig = {
    ...DEFAULT_APP_CONFIG.proxy,
    enabled: true,
    port: testPort,
    api_key: "",
    auto_start: true,
  };

  const startRes = await bootstrapNestServer(config);
  assert.strictEqual(startRes.success, true, "Server should start successfully");
  console.log(`Server started on port ${testPort}`);

  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // 1. Direct access to /internal/system/status without key -> 200 OK
    console.log("Checking GET /internal/system/status without auth...");
    const statusRes = await axios.get(`${baseUrl}/internal/system/status`);
    assert.strictEqual(statusRes.status, 200);
    console.log("✓ GET /internal/system/status returns 200 without API key");

    // 2. Direct access to /internal/accounts without key -> 200 OK
    console.log("Checking GET /internal/accounts without auth...");
    const accountsRes = await axios.get(`${baseUrl}/internal/accounts`);
    assert.strictEqual(accountsRes.status, 200);
    console.log("✓ GET /internal/accounts returns 200 without API key");

    // 3. Loopback call to /v1/models without key -> 200 OK
    console.log("Checking GET /v1/models from loopback without key...");
    const modelsRes = await axios.get(`${baseUrl}/v1/models`);
    assert.strictEqual(modelsRes.status, 200);
    console.log("✓ GET /v1/models returns 200 from loopback without key");

    // 4. Model call /v1/chat/completions without key -> 401 Unauthorized
    console.log("Checking POST /v1/chat/completions without key...");
    let keylessErrorStatus = 0;
    let keylessErrorMessage = "";
    try {
      await axios.post(`${baseUrl}/v1/chat/completions`, {
        model: "gemini-2.5-pro",
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err: any) {
      keylessErrorStatus = err.response?.status;
      keylessErrorMessage = err.response?.data?.error?.message;
    }
    assert.strictEqual(keylessErrorStatus, 401, "Keyless model request must return 401");
    assert.strictEqual(
      keylessErrorMessage,
      "API key is required",
      "Error message must state 'API key is required'"
    );
    console.log("✓ POST /v1/chat/completions without key strictly rejected with 401");

    // 5. Model call /v1/chat/completions with invalid key -> 401 Unauthorized
    console.log("Checking POST /v1/chat/completions with invalid key...");
    let invalidKeyStatus = 0;
    try {
      await axios.post(
        `${baseUrl}/v1/chat/completions`,
        {
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "hi" }],
        },
        {
          headers: {
            Authorization: "Bearer sk-invalid-key-token",
          },
        }
      );
    } catch (err: any) {
      invalidKeyStatus = err.response?.status;
    }
    assert.strictEqual(invalidKeyStatus, 401, "Invalid key model request must return 401");
    console.log("✓ POST /v1/chat/completions with invalid key rejected with 401");

    // 6. Test with a newly generated dynamic key
    console.log("Creating dynamic API key and checking model authorization...");
    const createKeyRes = await axios.post(`${baseUrl}/internal/api-keys`, {
      name: "E2E Test Key",
      role: "client",
    });
    assert.strictEqual(createKeyRes.status, 201, "Creating API key should return 201");
    const rawKey = createKeyRes.data.data?.key;
    const keyId = createKeyRes.data.data?.id;
    assert.ok(rawKey && rawKey.startsWith("sk-ag-"), "Key must be generated");

    // Call /v1/chat/completions with valid dynamic key -> should pass ProxyGuard
    // (It might return 400/503/etc. due to no active Google account, but NOT 401 from ProxyGuard!)
    let authPassed = false;
    try {
      const resp = await axios.post(
        `${baseUrl}/v1/chat/completions`,
        {
          model: "gemini-2.5-pro",
          messages: [{ role: "user", content: "hi" }],
        },
        {
          headers: {
            Authorization: `Bearer ${rawKey}`,
          },
        }
      );
      if (resp.status === 200) authPassed = true;
    } catch (err: any) {
      // If status is not 401, ProxyGuard authentication succeeded!
      if (err.response && err.response.status !== 401) {
        authPassed = true;
      }
    }
    assert.strictEqual(authPassed, true, "Valid dynamic key must pass ProxyGuard authentication");
    console.log("✓ POST /v1/chat/completions with valid dynamic key successfully passed ProxyGuard");

    // 7. Cleanup the test key
    await axios.delete(`${baseUrl}/internal/api-keys/${keyId}`);
    console.log("✓ Cleaned up test key");

    console.log("\n🎉 ALL E2E AUTH FLOW TESTS PASSED SUCCESSFULLY!");
  } finally {
    await stopNestServer();
  }
}

runE2ETests().catch((err) => {
  console.error("E2E Test failed:", err);
  process.exit(1);
});
