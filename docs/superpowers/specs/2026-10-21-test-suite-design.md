# Thiết kế: login gate + bộ test Jest/Playwright

Ngày: 2026-10-21
Trạng thái: chờ duyệt
Phạm vi: thay đổi sản phẩm (phase 0) + unit test, E2E API, Playwright

## 1. Vì sao

Repo hiện **không có test runner nào**. Chỉ có hai script chạy tay:

- `test/auth-enforcement.spec.ts` — 5 assertion bằng `node:assert`, chạy `npx tsx`
- `test/e2e-auth-flow.ts` — boot server thật rồi gọi axios

CI (`.github/workflows/ci.yml`) chỉ chạy `type-check` → `build` → migration → Docker build, **không chạy test**. Lần sửa gần nhất (bỏ `PROXY_API_KEY`, bắt buộc API key động) được xác nhận thủ công.

Đồng thời có hai lỗ hổng/thiếu hụt đã được xác nhận khi khảo sát:

1. `web/src/views/LoginView.tsx` tồn tại nhưng **không được import ở đâu**; `App.tsx` render thẳng dashboard, không có logout. `AdminGuard` cho phép **mọi request không token từ bất kỳ IP** (`admin.guard.ts`, nhánh `return true`). README đang ghi dashboard không cần key.
2. Một số hành vi quản trị còn thiếu: account không sửa/tắt/tìm kiếm; audit UI chưa lọc theo thời gian/API key.

Mục tiêu: login gate có thật, quản trị account/audit đủ dùng, và mỗi push/PR có bằng chứng tự động rằng auth, proxy protocol, persistence, giao diện vẫn đúng.

## 2. Phạm vi

### Phase 0 — thay đổi sản phẩm

**0.1 Login gate + admin auth**

- Bọc `App` bằng trạng thái xác thực:
  - Chưa có key trong `sessionStorage` → render `LoginView`.
  - Có key → gọi `POST /internal/auth/validate`; hợp lệ và role `admin` → vào app, ngược lại hiện lỗi và xoá key.
  - `Header` thêm nút Logout: xoá key, reset state, quay về `LoginView`.
  - Bất kỳ API nào trả 401 → xoá key và quay về login (không hiện dashboard rỗng).
- `POST /internal/auth/validate` trả thêm `role`; LoginView từ chối key role `client` với thông báo riêng.
- `AdminGuard`: **bỏ hoàn toàn nhánh cho phép không token**. Không token → 401; token sai/hết hạn/không phải admin → 401 (403 nếu đã xác định là key client hợp lệ).
- **Bootstrap key lần đầu** (đã chốt): khi `ApiKeyService` khởi động mà DB **không có admin key active nào**, tự sinh một key role `admin`, lưu hash, và in raw key **một lần** ra console kèm cảnh báo. Key không ghi ra file. Nếu người dùng xoá hết admin key, lần khởi động sau sinh key mới. `npm run api-key -- create "Admin" --role admin` vẫn là đường tạo/thay thế.
- Cập nhật `README.md`, `SECURITY.md`, `DOCUMENTATION_VN.md`, `.env.example` theo hành vi mới. Không còn câu "dashboard không cần key".

**0.2 Quản trị account**

- `PATCH /internal/accounts/:id` (AdminGuard) nhận `{ name?, is_active? }`:
  - `name`: chuỗi ≤ 255, trim, rỗng → `null`.
  - `is_active`: boolean; `false` = tắt account.
  - Không cho sửa `email` (token cache và một số luồng khoá theo email); trả 400 nếu body chứa field khác ngoài `name`/`is_active`.
  - Lưu qua `jsonAccountStoreInstance.upsertAccount`, gọi `loadAccounts()`, trả account đã cập nhật.
- `getAccountsOverview()` trả thêm `name` và `is_active` (mặc định `true`).
- `getAccountsForProvider()` đã bỏ qua `is_active === false`; rà thêm các đường chọn account khác (quota, image scheduler, system status) để account tắt không được tính là active.
- UI `AccountsView`: ô tìm kiếm (email/name/id), lọc provider và trạng thái (active/disabled), badge "Disabled", sửa tên inline, nút tắt/bật kèm confirm. i18n en/vi đầy đủ.
- Không thêm chức năng sửa email, không đổi schema account.

**0.3 Audit filters**

- Backend `TrafficAuditListInputSchema` thêm `apiKeyId` (uuid, optional); repository lọc theo `traffic_logs.apiKeyId` (index đã có).
- `GET /internal/audit/filter-options` trả thêm danh sách API key `{id, name, keyPreview}` và account `{id, email}`.
- UI `AuditLogsView`: thêm khoảng thời gian (from/to), chọn API key, giữ lọc model/status hiện có; nút xoá filter.
- Không đổi schema bảng; chỉ dùng cột `apiKeyId` sẵn có.

**0.4 Routing**

- Giữ nguyên `GET`/`POST /internal/routing`; **không thêm PUT** (doc cũ ghi nhầm). Test dùng `POST`.

### Phase 1–4 — test

1. **Unit (Jest)** cho logic thuần và provider cô lập.
2. **E2E API (Jest)** boot server thật, SQLite/JSON store tạm, upstream bị chặn.
3. **Playwright** full-stack, test login gate + các view.
4. **Script + CI + `TESTING.md`**; chuyển 2 script cũ sang Jest rồi xoá.

### Non-goals

- Không đặt mục tiêu 100% coverage; không test thư viện bên thứ ba.
- Không gọi Google/Anthropic/OpenAI thật, không cần credential thật.
- Không load test, không security pen-test, không visual regression.
- Không test CLI tương tác (chỉ unit phần logic tách được).
- Không đa trình duyệt giai đoạn này (Chromium); WebKit/Firefox để sau.
- Không thêm React Testing Library/jsdom; component phủ bằng Playwright, unit web chỉ helper thuần.
- Không sửa email account, không thêm OAuth provider mới.

### Anti-goals

- Test ghi vào `data/`, `accounts.json`, `routing.json` thật → **fail**.
- Test phụ thuộc mạng, thời gian thực, thứ tự chạy, port cố định dễ đụng → **fail**.
- Login gate chỉ là hình thức (API vẫn cho qua khi không token) → **fail**.
- Test chỉ pass khi chạy một mình hoặc phải xoá cache thủ công → **fail**.

## 3. Quyết định kỹ thuật

| Chủ đề | Quyết định | Lý do |
|---|---|---|
| Runner backend | **Jest + ts-jest**, CommonJS | Dev quen Jest; `tsconfig` CJS + decorator sẵn; không cần Babel |
| Runner web unit | **Jest** (node env) cho helper thuần | Một runner; `lib/reorder.ts`, `exportCsv.ts`, `agentPresets.ts`, i18n parity không cần DOM |
| Playwright | **@playwright/test**, Chromium | UI mode/headed cho local, trace khi retry |
| Playwright target | **Full-stack thật**: backend phục vụ `web/dist` | Test đúng thứ người dùng chạy; không mock `/graphql`/`/internal` |
| Upstream (API E2E) | **nock** + `disableNetConnect()` | Không gọi mạng, mô phỏng 200/429/5xx/stream |
| Cách ly dữ liệu | Thư mục tạm mỗi lần chạy + `SQLITE_DB_PATH`, `ACCOUNTS_FILE`, `ROUTING_CONFIG_PATH`, `DATA_DIR` | Biến đã có trong code; không đụng dữ liệu thật |
| Server cho Playwright | **Luôn tự khởi động server riêng** trên `PLAYWRIGHT_PORT` (mặc định 8046); không reuse server dev | Tránh seed/xoá nhầm `data/` thật |
| Seed Playwright | Script chạy trước server: migrate DB, chèn admin key biết trước, ghi `accounts.json`/`routing.json`, chèn traffic log | Deterministic, không phụ thuộc bootstrap/console |
| Song song Playwright | `workers: 1` | Routing/account là state toàn cục; tránh test phụ thuộc thứ tự |
| Coverage | Báo cáo ngay, **chưa fail CI**; đo baseline rồi đặt ngưỡng thấp hơn baseline | Tránh chặn PR bằng con số tuỳ ý |
| CI | 2 job mới: `unit-and-api-tests`, `playwright` | Lỗi UI không che lỗi backend; cache browser |

Ghi chú: `durable-store-settings.ts` đã coi `NODE_ENV=test` là môi trường test (Jest tự set). Playwright chạy `NODE_ENV=production` nhưng trỏ file tạm tường minh.

## 4. Cấu trúc

```
jest.config.cjs                 # unit: src/**/*.spec.ts + web/src/lib
jest.e2e.config.cjs             # API e2e: test/e2e/**/*.e2e-spec.ts, runInBand
playwright.config.ts            # webServer, baseURL, trace/video, workers: 1
test/
  e2e/
    helpers/server.ts           # boot/stop Nest trên port trống, env tạm
    helpers/temp-env.ts         # mkdtemp, set/restore env, cleanup
    helpers/seed.ts             # admin key, account giả, traffic log
    auth.e2e-spec.ts
    internal-api.e2e-spec.ts
    graphql.e2e-spec.ts
    proxy-openai.e2e-spec.ts
    proxy-anthropic.e2e-spec.ts
    proxy-gemini.e2e-spec.ts
    proxy-errors.e2e-spec.ts
    persistence.e2e-spec.ts
  playwright/
    seed.ts                     # chạy trước server, ghi dữ liệu biết trước
    fixtures.ts                 # storage key, seeding/cleanup qua API, login helper
    auth.spec.ts
    dashboard.spec.ts
    accounts.spec.ts
    api-keys.spec.ts
    routing.spec.ts
    models.spec.ts
    analytics-audit.spec.ts
    agent-setup.spec.ts
    i18n.spec.ts
  legacy/                       # 2 script cũ, xoá sau khi port
TESTING.md
```

Unit spec đặt cạnh source (`src/**/*.spec.ts`, convention Nest); config `roots` gồm `src` và `web/src/lib` để không nuốt `test/`.

### Script npm (root)

```
test              # unit + e2e API
test:unit
test:unit:watch
test:cov
test:e2e          # jest --config jest.e2e.config.cjs --runInBand
test:e2e:watch
test:playwright
test:playwright:ui
test:playwright:headed
test:playwright:debug
test:server       # seed + build web nếu thiếu + start server tạm cho Playwright
test:all          # test + playwright
```

`playwright.config.ts` dùng `webServer.command = npm run test:server`, `reuseExistingServer: false`. `baseURL` lấy từ `PLAYWRIGHT_BASE_URL` nếu có **chỉ để chạy thử**, nhưng mặc định luôn trỏ server tạm; không hỗ trợ trỏ vào server dev đang dùng dữ liệu thật.

## 5. Nội dung test

### 5.1 Unit (Jest)

Ưu tiên theo rủi ro:

- **Auth/keys**: `api-key-hash`; `ApiKeyService` (create → raw key chỉ trả một lần, list mask, validate đúng/sai, disabled/expired, allowed accounts, migration hash cũ); bootstrap admin key khi DB trống; `AdminGuard` (không token → 401, token client → 403/401, token admin → pass); `ProxyGuard`; `api-key-auth.util`.
- **Shared**: `sensitiveDataMasking`, `atomic-json-file` (ghi nguyên tử, file hỏng), `durable-record-store`, `error-guards`, `appError`, `url`.
- **Account**: quota model families, google validation URL, OAuth state sống/hết hạn, merge account cùng id, chuẩn hoá provider, validate `PATCH` (name/is_active, field lạ), `getAccountsForProvider` bỏ account `is_active: false`.
- **Routing/quota**: `rule-based-router` (pattern khớp, pipeline fallback), `model-routing.service`, `model-availability`, `rate-limit-tracker`, `generation-constraints`, `proxy-retry` policy.
- **Protocol transform**: các mapper lõi OpenAI ↔ Gemini ↔ Anthropic (request/response, usage, tool call, ảnh), `proxy-sse-response`, `google-error-details`, `auth-error-envelope`.
- **Observability**: audit masking, token analytics aggregate (ngày/key/model), filter `apiKeyId`, export CSV.
- **Web helper**: `lib/reorder.ts`, `lib/exportCsv.ts`, `lib/agentPresets.ts`, i18n key parity en/vi.

Không unit-test controller trừ khi logic nằm trong controller.

### 5.2 E2E API (Jest)

Mỗi file boot server một lần, `runInBand`, seed tối thiểu, `afterAll` đóng server + xoá temp.

- **auth**: `/v1/models` loopback không key → 200; `/v1/chat/completions` không key → 401 đúng envelope; key hợp lệ/disabled/expired; **`/internal/*` không token → 401**; key client → 401/403; key admin → 200; GraphQL cũng bắt buộc admin.
- **bootstrap**: DB trống → server sinh đúng một admin key, hash lưu DB, raw key chỉ ở log/giá trị trả về nội bộ; khởi động lại không sinh thêm.
- **internal API**: system status; accounts list/**PATCH name**/**PATCH is_active**/**field lạ → 400**/delete; api-keys CRUD (raw key xuất hiện đúng một lần, list không lộ hash); routing GET/POST + validation; model-specs; audit list + `from`/`to`/`apiKeyId`/phân trang.
- **GraphQL**: `tokenUsageStats` có/không auth, khoảng thời gian, group by.
- **Proxy**: mỗi giao thức một case 200 với nock (body chuyển đổi, header, usage), một case SSE stream (thứ tự chunk, `[DONE]`), `/v1/models` hợp nhất.
- **Lỗi**: upstream 429 → retry/fallback; 5xx → envelope; timeout; body quá lớn; model không tồn tại.
- **Persistence**: migration trên DB trống; key còn sau restart; traffic log ghi đúng khi thành công/thất bại.

### 5.3 Playwright

Seed trước khi server boot bằng script: admin key biết trước, 3 account giả (1 disabled, không token để không gọi upstream), routing mặc định, traffic log với timestamp cố định. Fixture set `sessionStorage` bằng `addInitScript` cho test đã đăng nhập.

- **auth**: mở app chưa có key → LoginView; submit rỗng → lỗi; key sai → lỗi; key client → báo không phải admin; key admin → dashboard; reload giữ session; logout → LoginView và key bị xoá; API trả 401 → quay về login.
- **dashboard**: thẻ trạng thái, số liệu, chart render; đổi ngôn ngữ.
- **accounts**: danh sách seed; search theo email/name/id; lọc provider/trạng thái; sửa tên và thấy sau reload; tắt/bật account và badge đổi; xoá account seed phụ; thêm account google giả qua form rồi xoá.
- **api-keys**: tạo key (cảnh báo chỉ hiện một lần), copy, list mask, disable/delete; reload không thấy raw key.
- **routing**: xem rule mặc định, sửa pipeline, lưu, reload còn dữ liệu.
- **models**: danh sách model + chi tiết spec.
- **analytics/audit**: bảng traffic seed; lọc from/to và API key; xoá filter.
- **agent-setup**: chọn agent, snippet đúng endpoint đang chạy.
- **i18n**: chuyển VI/EN trên các view chính, không lộ key dịch, lựa chọn được nhớ.

Chống flaky: không `waitForTimeout`; web-first assertion; mỗi spec tự tạo/xoá dữ liệu của mình; trace/video chỉ khi retry; `workers: 1`.

## 6. CI/CD

Thêm vào `.github/workflows/ci.yml`:

1. `unit-and-api-tests` (sau checkout, `npm ci`): `npm run test:unit -- --coverage` + `npm run test:e2e`; upload coverage artifact.
2. `playwright` (song song): `npm ci`, `npm run build:all`, `npx playwright install --with-deps chromium`, `npm run test:playwright`; upload `playwright-report/` + `test-results/` khi fail, giữ 7 ngày.
3. Giữ nguyên job build/migration/Docker hiện có.

Không đưa Playwright vào job Docker.

## 7. Rủi ro

| Rủi ro | Cách xử lý |
|---|---|
| Bootstrap key in ra console làm lộ key trong log | Chỉ in một lần, kèm cảnh báo; không ghi file; cho phép `INITIAL_ADMIN_KEY` để CI/ops chủ động đặt |
| Account seed có token → boot gọi Google thật | Seed account **không token**; test thêm account dùng google token giả sau khi boot (không trigger quota sync); không bấm Sync trong Playwright |
| Thêm account provider khác trigger model discovery ra mạng | Playwright chỉ thêm account google; test provider khác ở E2E API với nock |
| Server boot chậm/port bận | Xin port trống qua `net`, timeout 30s, log rõ khi fail |
| Env rò rỉ giữa test | `jest.resetModules()`, helper set/restore env, mỗi suite một temp dir |
| `axios-hardening` can thiệp nock | Kiểm tra sớm; nếu xung đột, dùng local stub server + base URL env |
| Web build lâu | `test:server` chỉ build khi `web/dist` thiếu; CI build một lần |
| Account store JSON ghi đè khi song song | API E2E `runInBand`; Playwright `workers: 1` |
| Đồng hồ/timezone | `TZ=UTC`, timestamp seed cố định |
| Đổi AdminGuard làm hỏng CLI/flow local | Cập nhật README + thông báo lỗi rõ; test bootstrap key; giữ CLI tạo key |

## 8. Điều kiện hoàn thành

- Login gate hoạt động: không key → LoginView; key admin → app; logout xoá session; mọi `/internal/*` + `/graphql` không token đều 401.
- Server DB trống tự sinh admin key và in một lần; restart không sinh thêm.
- Account sửa tên/tắt/bật/tìm/lọc chạy đúng; account tắt không được chọn cho request model.
- Audit lọc được from/to/API key.
- `npm test` xanh trên clone sạch, không cần mạng.
- `npm run test:playwright` xanh 3 lần liên tiếp trên máy dev; CI xanh.
- Không file nào trong `data/`, `accounts.json`, `routing.json` bị thay đổi sau khi chạy test (`git status` sạch).
- README/SECURITY/DOCUMENTATION_VN/TESTING.md khớp hành vi mới.
- Hai script cũ đã port sang Jest và bị xoá.

## 9. Việc để builder quyết

- Chia unit spec thành file nào/bao nhiêu case trong từng nhóm.
- Danh sách mapper protocol được phủ trước (không phủ hết 256 file trong một lần).
- Dùng `globalSetup` server dùng chung cho E2E API hay boot theo từng file (mặc định: từng file, `runInBand`).
- Mức coverage baseline và ngưỡng ratchet phase sau.
- Chi tiết UI account edit (inline vs modal) và bố cục filter audit, miễn đủ hành vi ở mục 0.2/0.3.
- Có thêm WebKit/Firefox sau khi Chromium ổn định hay không.
