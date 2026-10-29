# Đặc tả Bộ Test Case Toàn diện Dự án LLM Gateway Proxy (Full Test Suite Specification)

Tài liệu này tổng hợp và quy chuẩn hóa toàn bộ các kịch bản kiểm thử (Test Cases) nhằm **phủ 100% tính năng** của hệ thống **LLM Gateway Proxy**, đối chiếu từ các tài liệu đặc tả kỹ thuật:
- `README.md` & `DOCUMENTATION_VN.md` (Tổng quan, giao thức, cấu hình client, CLI)
- `docs/ARCHITECTURE.md` (Vòng đời request, Lease State Machine, Thought Signature Store, Audit SSE)
- `requirements/requirement-261019-1456-token-usage-analytics-dashboard.md` (Token Analytics & GraphQL)
- `docs/superpowers/specs/2026-10-28-dynamic-model-discovery-design.md` (Khám phá model 100% động từ Upstream)
- `docs/superpowers/specs/2026-10-28-playground-studio-design.md` (Playground Studio & Code Generator)
- `docs/superpowers/specs/2026-10-21-test-suite-design.md` (Login Gate, AdminGuard, Account Management)
- `docs/opencode-custom-provider-api.md` (Đặc tả giao thức kết nối OpenCode & wire format)

---

## Mục lục Ma trận Kiểm thử

1. [Module 1: Xác thực, Phân quyền & Bảo mật Hệ thống (Auth, AdminGuard & API Keys)](#module-1-xác-thực-phân-quyền--bảo-mật-hệ-thống)
2. [Module 2: Chuyển đổi Giao thức & Định tuyến Suy luận AI (Protocol Mappers & Proxying)](#module-2-chuyển-đổi-giao-thức--định-tuyến-suy-luận-ai)
3. [Module 3: Quản lý Pool Tài khoản, Cấp phát Lease & Hạ nhiệt Rate Limit (Account Leasing & Cooldown)](#module-3-quản-lý-pool-tài-khoản-cấp-phát-lease--hạ-nhiệt-rate-limit)
4. [Module 4: Bộ định tuyến theo Quy tắc & Khám phá Model Động (Rule-Based Routing & Dynamic Discovery)](#module-4-bộ-định-tuyến-theo-quy-tắc--khám-phá-model-động)
5. [Module 5: Lưu trữ & Phục hồi Chuỗi suy luận (Thought Signature Preservation)](#module-5-lưu-trữ--phục-hồi-chuỗi-suy-luận)
6. [Module 6: Ghi nhật ký Giám sát, GraphQL Token Analytics & Ước tính Chi phí (Observability & GraphQL)](#module-6-ghi-nhật-ký-giám-sát-graphql-token-analytics--ước-tính-chi-phí)
7. [Module 7: Giao diện Người dùng Web UI Dashboard & End-to-End User Flow](#module-7-giao-diện-người-dùng-web-ui-dashboard--end-to-end-user-flow)
8. [Module 8: Hạ tầng Lưu trữ, Cơ sở dữ liệu SQLite/Redis & Công cụ Dòng lệnh CLI](#module-8-hạ-tầng-lưu-trữ-cơ-sở-dữ-liệu-sqliteredis--công-cụ-dòng-lệnh-cli)

---

## Phân cấp Kiểm thử & Độ ưu tiên (Test Classification & Priority)

- **Test Level:**
  - `Unit`: Kiểm thử đơn vị logic thuần (Jest).
  - `Integration E2E`: Kiểm thử tích hợp API qua Fastify HTTP Server với stub `nock` và DB SQLite tạm (Jest E2E).
  - `Browser E2E`: Kiểm thử giao diện tương tác trình duyệt thật trên Chromium (Playwright).
- **Độ ưu tiên (Priority):**
  - `P0 (Critical)`: Tính năng sống còn, bảo mật cốt lõi, proxy luồng chính.
  - `P1 (High)`: Quản trị tài khoản, định tuyến, giám sát số liệu, fallback khi lỗi.
  - `P2 (Medium)`: Tối ưu hoá trải nghiệm, i18n, các tiện ích sinh mã, bộ lọc nâng cao.

---

## Module 1: Xác thực, Phân quyền & Bảo mật Hệ thống

### Bảng Test Cases: Module 1

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-AUTH-001** | Tự sinh Bootstrap Admin Key khi database trống | Integration E2E | P0 | Database SQLite mới tinh chưa có bảng hoặc chưa có key nào | 1. Khởi động server NestJS.<br>2. Quan sát log console khởi động và kiểm tra bảng `api_keys`. | Server tự động sinh 1 admin key định dạng `sk-ag-...`, lưu SHA-256 hash vào DB, in raw key 1 lần duy nhất ra console kèm cảnh báo bảo mật. |
| **TC-AUTH-002** | Khởi động lại khi đã có Admin Key không sinh thêm | Integration E2E | P0 | Database đã tồn tại ít nhất 1 admin key active | 1. Khởi động lại server NestJS.<br>2. Kiểm tra số lượng bản ghi trong bảng `api_keys`. | Không sinh thêm key mới; số lượng key giữ nguyên. |
| **TC-AUTH-003** | Khởi động với biến môi trường `INITIAL_ADMIN_KEY` | Unit / E2E | P0 | Cấu hình env `INITIAL_ADMIN_KEY=sk-ag-init-admin-supersecret` | 1. Boot server với DB trống.<br>2. Dùng key `sk-ag-init-admin-supersecret` gọi `/internal/auth/validate`. | Server tạo admin key với chuỗi định sẵn; đăng nhập thành công role `admin`. |
| **TC-AUTH-004** | AdminGuard chặn mọi request `/internal/*` không có token | Integration E2E | P0 | Server đang chạy | Gửi `GET /internal/accounts`, `GET /internal/api-keys`, `GET /internal/routing` không kèm header Authorization. | Trả về HTTP 401 Unauthorized `{ success: false, error: { message: "Admin authorization required", ... } }`. |
| **TC-AUTH-005** | AdminGuard chặn token sai hoặc token hết hạn | Integration E2E | P0 | Server đang chạy | Gửi request tới `/internal/system/status` kèm `Authorization: Bearer sk-invalid-token`. | Trả về HTTP 401 Unauthorized; log ghi nhận unauthorized attempt. |
| **TC-AUTH-006** | AdminGuard từ chối Client Key (Role `client`) | Integration E2E | P0 | Đã tạo 1 key có role `client` | Dùng token role `client` gọi `/internal/api-keys`. | Trả về HTTP 403 Forbidden hoặc 401; không cho phép truy cập tài nguyên quản trị. |
| **TC-AUTH-007** | AdminGuard bảo vệ GraphQL endpoint `/graphql` | Integration E2E | P0 | Server đang chạy | Gửi GraphQL Query `tokenUsageStats` không kèm token hoặc kèm key client. | Trả về HTTP 401 Unauthorized; chặn toàn bộ truy vấn GraphQL trái phép. |
| **TC-AUTH-008** | Miễn trừ xác thực cho Loopback Model Discovery (`127.0.0.1`) | Integration E2E | P1 | Request xuất phát từ localhost (`127.0.0.1` hoặc `::1`) | Gửi `GET /v1/models` không kèm header Authorization từ IP nội bộ. | Trả về HTTP 200 OK danh sách models, cho phép Cursor/Cline tự động nhận diện model. |
| **TC-AUTH-009** | Chặn `GET /v1/models` không token từ IP bên ngoài | Integration E2E | P0 | Request giả lập IP nguồn từ mạng ngoài (`192.168.1.50`) | Gửi `GET /v1/models` không token qua remote IP. | Trả về HTTP 401 Unauthorized. |
| **TC-AUTH-010** | ProxyGuard bắt buộc API Key động trên route model (`/v1/chat/completions`, `/v1/messages`) | Integration E2E | P0 | Server đang chạy | Gửi request `POST /v1/chat/completions` hoặc `POST /v1/messages` không có key. | Trả về HTTP 401 Unauthorized theo đúng error envelope chuẩn của giao thức tương ứng. |
| **TC-AUTH-011** | Chấp nhận đa dạng Header xác thực (`Authorization: Bearer`, `x-api-key`, `x-goog-api-key`) | Unit / E2E | P1 | Có key client hợp lệ | 1. Gửi `Bearer <key>`.<br>2. Gửi `x-api-key: <key>`.<br>3. Gửi `x-goog-api-key: <key>`. | Cả 3 cách truyền header đều giải mã và xác thực key thành công. |
| **TC-AUTH-012** | Chống Timing Attacks bằng `crypto.timingSafeEqual` | Unit | P0 | Hàm `validateKey()` | Truyền key có độ dài khớp nhưng sai 1 ký tự cuối, đo đạc tính an toàn. | So sánh hash SHA-256 qua hàm thời gian hằng số `timingSafeEqual`, ngăn chặn tấn công kênh kề. |
| **TC-AUTH-013** | Tạo API Key mới chỉ trả về raw key 1 lần duy nhất | Integration E2E | P0 | Admin key hợp lệ | Gọi `POST /internal/api-keys` với `{ name: "Cursor Dev", role: "client" }`. | Response trả về raw key `sk-ag-...`. Các lần gọi `GET /internal/api-keys` sau đó chỉ trả về masked `keyPreview` (`sk-ag-xx...xxxx`). |
| **TC-AUTH-014** | Vô hiệu hoá (Toggle Inactive) và Hạn dùng (ExpiresAt) của API Key | Integration E2E | P1 | Key client đã tạo | 1. Gọi `PATCH /internal/api-keys/:id` chuyển `isActive: false`. Thử gọi model proxy.<br>2. Cập nhật `expiresAt` về quá khứ. Thử gọi model proxy. | Đều bị từ chối với HTTP 401 báo key bị khoá hoặc đã hết hạn. |
| **TC-AUTH-015** | Ràng buộc tài khoản được phép (`allowedAccounts`) của API Key | Unit / E2E | P1 | Key cấu hình chỉ cho phép dùng `['acc-1']` | Gửi request model qua key này khi hệ thống có `acc-1` và `acc-2`. | `AccountLeaseService` chỉ cấp phát `acc-1`; nếu `acc-1` không khả dụng thì từ chối, không nhảy sang `acc-2`. |

---

## Module 2: Chuyển đổi Giao thức & Định tuyến Suy luận AI

### Bảng Test Cases: Module 2

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-MAP-001** | OpenAI Non-streaming Chat Completion chuẩn | Integration E2E | P0 | Upstream nock mock OpenAI 200 | Gửi `POST /v1/chat/completions` với `{ model: "gpt-4o", messages: [{ role: "user", content: "hello" }], stream: false }`. | Trả về JSON đúng cấu trúc OpenAI `{ id, object: "chat.completion", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "..." } }], usage: {...} }`. |
| **TC-MAP-002** | OpenAI Streaming Chat Completion (SSE & `data: [DONE]`) | Integration E2E | P0 | Upstream nock stream chunks | Gửi `POST /v1/chat/completions` với `stream: true`. | Client nhận luồng SSE các chunk `data: {"choices":[{"delta":{"content":"..."}}]}`, kết thúc bằng `data: [DONE]`, chunk cuối có `finish_reason` và `usage`. |
| **TC-MAP-003** | Tương thích `max_tokens` và `max_completion_tokens` | Unit | P1 | Service chuyển đổi payload | Truyền `max_completion_tokens: 1500` (chuẩn OpenCode/OpenAI o1/o3). | Hệ thống nhận diện đúng giới hạn token và chuyển thành tham số upstream phù hợp; không bị lỗi 400. |
| **TC-MAP-004** | Ánh xạ Function Calling / Tool Calls OpenAI | Unit / E2E | P0 | Payload chứa `tools` và `tool_choice` | Gửi request có định nghĩa tool `get_weather`. | Trả về `choices[0].delta.tool_calls` đầy đủ `id`, `function.name`, `function.arguments` dạng streaming và không bị rụng khi kết thúc. |
| **TC-MAP-005** | Tái hiện suy luận (`reasoning_content`) cho lượt chat tiếp theo | Unit | P1 | Assistant message lượt trước có `reasoning_content` | Gửi hội thoại 2 lượt: Lượt 1 user, lượt 2 assistant mang reasoning, lượt 3 user hỏi tiếp. | Hệ thống trích xuất và bảo toàn block thinking / reasoning gửi lên upstream mà không bị lỗi 400 Bad Request. |
| **TC-MAP-006** | Anthropic Messages SSE Streaming (`POST /v1/messages`) | Integration E2E | P0 | Upstream Google/Anthropic | Gửi `POST /v1/messages` với `stream: true`, model `claude-3-7-sonnet`. | Nhận chuỗi sự kiện SSE có tên chuẩn: `message_start` -> `content_block_start` -> `content_block_delta` -> `content_block_stop` -> `message_delta` -> `message_stop`. Không có `[DONE]` thừa. |
| **TC-MAP-007** | Anthropic Extended Thinking & Thinking Budget | Unit | P0 | Header `anthropic-beta: interleaved-thinking-2025-05-14`, thinking budget | Gửi tin nhắn với `thinking: { type: "enabled", budget_tokens: 2048 }`. | Upstream stream về `thinking_delta`, `signature_delta`, và client nhận đúng `type: "thinking"` trước khi nhận block text trả lời. |
| **TC-MAP-008** | Anthropic Tool Use & Tool Result Round-trip | Unit / E2E | P0 | Messages chứa `tool_use` và `tool_result` | 1. Model trả về block `tool_use` kèm `id`, `name`, `input`.<br>2. Client gửi tiếp message mang role `user`, block `tool_result`. | Hệ thống mapping chính xác sang `functionResponse` của Gemini/Upstream, phản hồi lượt kế tiếp thành công. |
| **TC-MAP-009** | Anthropic Multimodal (Ảnh Base64 & Media) | Unit | P1 | User message mang block `type: "image"` | Gửi payload chứa ảnh base64 `image/png` hoặc `image/jpeg`. | Hệ thống trích xuất mimeType và base64 data, map thành `inlineData` của Gemini API. |
| **TC-MAP-010** | Anthropic Legacy Complete (`POST /v1/complete`) | Integration E2E | P2 | Request text completion | Gửi `prompt: "\n\nHuman: Hi\n\nAssistant:"`. | Trả về `{ completion: "...", stop_reason: "stop_sequence", model: "..." }`. |
| **TC-MAP-011** | Anthropic Token Counting (`POST /v1/messages/count_tokens`) | Unit / E2E | P1 | Message payload hợp lệ | Gửi danh sách messages và system prompt tới endpoint đếm token. | Trả về `{ input_tokens: <number> }`. |
| **TC-MAP-012** | Gemini Native Content Generation (`POST /v1beta/models/...:generateContent`) | Integration E2E | P0 | Account Google Antigravity active | Gửi request `POST /v1beta/models/gemini-2.5-pro:generateContent` dạng JSON chuẩn Google. | Nhận kết quả `{ candidates: [{ content: { parts: [{ text: "..." }] }, finishReason: "STOP" }], usageMetadata: {...} }`. |
| **TC-MAP-013** | Gemini Native Streaming (`:streamGenerateContent?alt=sse`) | Integration E2E | P0 | Stream flag `alt=sse` | Gọi `:streamGenerateContent?alt=sse`. | Nhận stream SSE chứa từng chunk `data: <GenerateContentResponse>`, kết thúc an toàn khi có `finishReason`. |
| **TC-MAP-014** | Sinh ảnh OpenAI Images API (`POST /v1/images/generations`) | Integration E2E | P1 | Account hỗ trợ model hình ảnh (Imagen/DALL-E) | Gửi `{ prompt: "sunset over ocean", n: 1, size: "1024x1024" }`. | Điều phối qua `ImageAccountSchedulerService`, trả về `{ data: [{ b64_json: "..." | url: "..." }] }`. |
| **TC-MAP-015** | Quản lý File và Uploads (`/v1/files`, `/upload/v1beta/files`, `/v1/uploads`) | Integration E2E | P1 | File metadata & content multipart | 1. Upload file binary.<br>2. Lấy thông tin file qua ID.<br>3. Tải nội dung content.<br>4. Xoá file. | Thực hiện đúng vòng đời CRUD file tương thích cả OpenAI và Gemini Files API. |
| **TC-MAP-016** | Xử lý Batch Processing (`/v1/batches`, `/v1/messages/batches`) | Integration E2E | P2 | Batch creation payload | 1. Tạo batch request.<br>2. Kiểm tra status batch.<br>3. Cancel batch. | Chuyển tiếp và quản lý tác vụ bất đồng bộ đúng thông số kỹ thuật. |

---

## Module 3: Quản lý Pool Tài khoản, Cấp phát Lease & Hạ nhiệt Rate Limit

### Bảng Test Cases: Module 3

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-LEASE-001** | Khởi tạo Pool từ `accounts.json` đa Provider | Unit / E2E | P0 | File `accounts.json` chứa 1 Google, 1 Anthropic API, 1 Copilot, 1 OpenAI | Khởi động server, kiểm tra `AccountLeaseService.loadAccounts()`. | Nạp thành công tất cả tài khoản vào cache, phân loại đúng enum provider (`google`, `anthropic_api`, `copilot`, `openai`). |
| **TC-LEASE-002** | Thuật toán Round-Robin phân phối đều tải | Unit | P0 | Có 3 tài khoản active cùng hỗ trợ model `gemini-2.5-pro` | Gửi 6 request liên tiếp không có `session_id`. | Lease xoay vòng tuần tự qua Acc 1 -> Acc 2 -> Acc 3 -> Acc 1 -> Acc 2 -> Acc 3. |
| **TC-LEASE-003** | Sticky Session duy trì tài khoản cho cùng phiên chat | Unit | P1 | Có 3 tài khoản active; client truyền `session_id: "sess-abc"` | Gửi 5 request liên tiếp với cùng header/param `session_id`. | Cả 5 request đều được cấp phát vào cùng 1 tài khoản ban đầu để tối ưu context caching. |
| **TC-LEASE-004** | Tự động Hydrate / Refresh Token OAuth Google khi hết hạn | Unit / E2E | P0 | Tài khoản Google có `access_token` rỗng hoặc `expiry_timestamp` trong quá khứ | Gửi request cần cấp phát tài khoản Google này. | `CloudAccountRefreshService` tự động gọi Google OAuth endpoint với `refresh_token`, nhận `access_token` mới `ya29...`, cập nhật `accounts.json` nguyên tử. |
| **TC-LEASE-005** | Phát hiện lỗi 429 và Ghi nhận Strike (Two-Strike Policy) | Unit | P0 | Tài khoản đang ở Strike 0 | Upstream trả về lỗi HTTP 429 Too Many Requests. | Strike tăng lên 1, tài khoản bị tạm khóa ngắn (exponential backoff). Nếu tiếp tục lỗi lần 2, chuyển sang trạng thái Lockout hoàn toàn. |
| **TC-LEASE-006** | Tự động Failover sang tài khoản khác khi gặp 429 | Integration E2E | P0 | Pool có 2 tài khoản Google A và B. Upstream trả 429 cho A | Client gửi `POST /v1/chat/completions`. | Server tự động đánh dấu cooldown tài khoản A, thử lại ngay lập tức với tài khoản B, client nhận về response 200 OK không bị ngắt quãng. |
| **TC-LEASE-007** | Báo lỗi 429 và `Retry-After` khi toàn bộ Pool cạn kiệt | Integration E2E | P0 | Tất cả tài khoản hỗ trợ model đều đang bị cooldown | Client gửi request tới model đó. | Server trả về HTTP 429 kèm header `Retry-After: <giây>`, giải thích toàn bộ pool đang hạ nhiệt. |
| **TC-LEASE-008** | Phát sóng Cooldown qua `CooldownBus` (Đồng bộ đa node) | Unit | P1 | Có cấu hình Redis CooldownBus hoặc EventEmitter nội bộ | Kích hoạt cooldown trên Node 1. | Bản tin `ag:cooldown` được phát ra; các node khác nhận tin và loại bỏ tài khoản bị rate-limit khỏi pool cục bộ, bỏ qua self-broadcast. |
| **TC-LEASE-009** | Bỏ qua tài khoản bị vô hiệu hoá (`is_active: false`) | Unit / E2E | P0 | Cập nhật 1 tài khoản thành `is_active: false` qua `PATCH /internal/accounts/:id` | Gửi request yêu cầu model tương ứng. | Hệ thống lọc bỏ tài khoản này ngay tại `account-lease.disabled-accounts`, không bao giờ cấp phát tài khoản disabled. |
| **TC-LEASE-010** | Cấm sửa đổi `email` của tài khoản | Integration E2E | P1 | Gọi `PATCH /internal/accounts/:id` | Body gửi kèm `{ email: "new@gmail.com", name: "Valid Name" }`. | Server trả về HTTP 400 Bad Request, giữ nguyên email gốc. |
| **TC-LEASE-011** | Chế độ xoay vòng `cache-first` và `performance-first` | Unit | P2 | Cấu hình `ROUTING_STRATEGY=cache-first` | Gửi chuỗi prompt có prompt caching. | Thuật toán ưu tiên cấp phát tài khoản có khả năng trúng cache cao nhất. |

---

## Module 4: Bộ định tuyến theo Quy tắc & Khám phá Model Động

### Bảng Test Cases: Module 4

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-ROUTE-001** | Khớp định tuyến theo Regex Pattern (`routing.json`) | Unit | P0 | Rule: `^(claude-3-7-sonnet)` -> `["google", "anthropic_api"]` | Client gửi request với model `claude-3-7-sonnet`. | `RuleBasedRouterService` khớp đúng rule, chọn pipeline ưu tiên Google, nếu lỗi chuyển Anthropic API. |
| **TC-ROUTE-002** | Khám phá Model 100% Động từ Upstream API (Loại bỏ Hardcode) | Unit / E2E | P0 | Tài khoản có quota từ `fetchAvailableModels` | Gọi `GET /v1/models` và `GET /internal/model-specs`. | Chỉ trả về danh sách các model thực tế được phát hiện từ tài khoản đang kết nối; không còn chứa model rác hay danh sách tĩnh cũ. |
| **TC-ROUTE-003** | Tự động sinh biến thể Thinking (-low, -medium, -high) | Unit | P1 | Model upstream có `supportsThinking = true` và `thinkingBudget = 16384` | Kiểm tra danh mục model động. | Hệ thống tự sinh 3 biến thể: `-low` (1024), `-medium` (4096), `-high` (16384) với cấu hình thinking budget tương ứng. |
| **TC-ROUTE-004** | Trạng thái Empty State khi chưa có tài khoản active | Integration E2E | P1 | File `accounts.json` rỗng hoặc toàn bộ tài khoản bị disabled | Gọi `GET /v1/models` và `GET /internal/model-specs`. | Trả về `{ object: "list", data: [] }` và `{ success: true, data: [] }` an toàn, không sinh lỗi 500. |
| **TC-ROUTE-005** | Tự động Forward Model Deprecated sang Model Mới | Unit | P1 | Upstream đổi mã model cũ sang mới | Gửi request với mã model cũ (legacy). | Router ghi nhận vào `model-route-miss-journal` và ánh xạ sang phiên bản mới ổn định. |
| **TC-ROUTE-006** | Cập nhật cấu hình routing động qua `POST /internal/routing` | Integration E2E | P1 | Admin key hợp lệ | Gửi payload cập nhật danh sách rules và `default_pipeline`. | Server validate schema, ghi file `routing.json` nguyên tử, các request sau áp dụng ngay rule mới. |

---

## Module 5: Lưu trữ & Phục hồi Chuỗi suy luận (Thought Signature Preservation)

### Bảng Test Cases: Module 5

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-THINK-001** | Lưu trữ Thought Signature vào bộ nhớ đệm LRU | Unit | P0 | Model reasoning (Gemini Flash Thinking / Claude Thinking) phản hồi | Response mang block suy luận và `thought_signature`. | `SignatureStore` lưu signature theo index `(sessionKey, messageCount, toolCallId)` với dung lượng tối đa 500 mục, TTL 1 giờ. |
| **TC-THINK-002** | Phục hồi Thought Signature khi Client gọi Function Calling | Unit / E2E | P0 | Cursor/Cline gửi tiếp tool result mà không mang theo thought signature cũ | Request tới proxy trước khi đẩy lên upstream Google. | `ThoughtSignatureCompat` can thiệp, lấy signature đã lưu từ store chèn vào assistant message, loại bỏ triệt để lỗi upstream `400 Invalid Argument`. |
| **TC-THINK-003** | Đóng gói Chuẩn System Instructions Chính thức | Unit | P1 | Model thinking yêu cầu định dạng XML nghiêm ngặt | Client gửi system prompt hỗn hợp. | `OfficialSystemInstruction` chuẩn hóa prompt theo khuôn mẫu hệ thống để model tuân thủ cấu trúc reasoning và output blocks. |
| **TC-THINK-004** | Quản lý và Dọn dẹp Session Thinking qua Internal API | Integration E2E | P2 | Admin key hợp lệ | 1. `GET /internal/thinking/stats`.<br>2. `GET /internal/thinking/sessions`.<br>3. `DELETE /internal/thinking/sessions/:key`. | Thống kê số lượng signature đang cache, xem chi tiết và giải phóng bộ nhớ thành công. |

---

## Module 6: Ghi nhật ký Giám sát, GraphQL Token Analytics & Ước tính Chi phí

### Bảng Test Cases: Module 6

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-AUDIT-001** | Ghi log bất đồng bộ không làm chậm luồng stream (Zero-Buffer SSE) | Unit / E2E | P0 | Request streaming hoàn tất | `IncrementalSseRedactor` xử lý sliding chunk, gửi dữ liệu sang `TrafficAuditService`. | Dữ liệu log được ghi vào SQLite trong background; client nhận stream liên tục không bị nghẽn buffer. |
| **TC-AUDIT-002** | Che giấu thông tin nhạy cảm và Auth Headers (Masking) | Unit | P0 | Request có chứa `Authorization`, `x-api-key`, `cookie` | Kiểm tra bản ghi lưu trong bảng `traffic_logs`. | Các token, secret, cookie đều được thay bằng `[REDACTED]` hoặc chuỗi hash che bớt. |
| **TC-AUDIT-003** | Phân tích và Tách bạch Token Usage (`prompt`, `completion`, `total`) | Unit / E2E | P0 | Response kết thúc mang usage metadata | Kiểm tra cột `promptTokens`, `completionTokens`, `totalTokens`. | Trích xuất chính xác số token từ mọi loại giao thức (OpenAI, Anthropic, Gemini). |
| **TC-AUDIT-004** | Gỡ bỏ giới hạn 10.000 log & Composite Indexes cho bảng `traffic_logs` | Unit / E2E | P0 | Database chạy migration `1790640000000-AddTrafficLogsAnalyticsIndexes` | Kiểm tra cấu trúc index của SQLite table `traffic_logs`. | Tồn tại `IDX_traffic_logs_apiKeyId_timestamp` và `IDX_traffic_logs_model_timestamp`. Dữ liệu vượt 10k dòng không bị ngẫu nhiên xoá mất. |
| **TC-AUDIT-005** | GraphQL Query `tokenUsageStats` với các Preset thời gian | Integration E2E | P0 | Seed sẵn traffic log phân bố theo các ngày/giờ khác nhau | Gửi GraphQL Query với `range`: `ONE_HOUR`, `TWENTY_FOUR_HOURS`, `SEVEN_DAYS`, `THIRTY_DAYS`, `NINETY_DAYS`, `ONE_YEAR`. | Trả về tổng token, prompt, completion, totalRequests, successfulRequests, failedRequests khớp chính xác với dữ liệu trong khoảng. |
| **TC-AUDIT-006** | GraphQL Chia Bucket Biểu đồ Động (Dynamic Time-series Bucketing) | Unit / E2E | P1 | Query mốc `24h` và `30d` | Kiểm tra mảng `timeSeries` trả về trong GraphQL. | `24h` chia bước 1 giờ (24 điểm); `30d` chia bước 1 ngày (30 điểm); mỗi điểm có timestamp, label, token, chi phí. |
| **TC-AUDIT-007** | GraphQL Lọc Thống kê theo API Key cụ thể (`apiKeyId`) | Integration E2E | P0 | Có log của Key A và Key B | Gửi query `tokenUsageStats` kèm `{ apiKeyId: "id-key-A" }`. | Toàn bộ summary, time-series, byModel chỉ tính toán riêng cho Key A. |
| **TC-AUDIT-008** | Tính toán Chi phí Ước tính theo Model Pricing Catalog | Unit | P1 | Request model Claude 3.7 Sonnet ($3 prompt / $15 completion) | 1 triệu prompt tokens và 1 triệu completion tokens. | Ước tính chính xác $18.00 USD; model không xác định áp dụng giá mặc định ($1 / $3). |
| **TC-AUDIT-009** | Xử lý An toàn khi Dữ liệu Rỗng (Không chia cho 0 / Tránh `NaN%`) | Unit / E2E | P0 | Khoảng thời gian không có request nào | Gửi query `tokenUsageStats`. | Trả về toàn bộ chỉ số là 0, mảng rỗng `[]`, `percentage: 0` an toàn tuyệt đối, không phát sinh lỗi `NaN`. |
| **TC-AUDIT-010** | Danh sách Log Phân trang và Bộ lọc nâng cao (`/internal/audit/requests`) | Integration E2E | P1 | Hàng chục log lưu trữ | Gọi `GET /internal/audit/requests?page=1&limit=10&apiKeyId=...&model=...&status=success`. | Trả về danh sách phân trang chính xác, metadata tổng số trang và thông tin chi tiết từng request. |

---

## Module 7: Giao diện Người dùng Web UI Dashboard & End-to-End User Flow

### Bảng Test Cases: Module 7

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-UI-001** | Luồng Đăng nhập Login Gate & Bảo vệ Session | Browser E2E | P0 | Mở trình duyệt chưa lưu key | 1. Mở trang chủ `/`.<br>2. Nhập key sai hoặc để trống.<br>3. Nhập key client.<br>4. Nhập key admin chuẩn. | 1. Chuyển hướng về LoginView.<br>2. Báo lỗi key không hợp lệ.<br>3. Báo lỗi key không có quyền admin.<br>4. Đăng nhập thành công, lưu session, chuyển vào Dashboard. |
| **TC-UI-002** | Đăng xuất (Logout) và Tự động Bật Login khi gặp lỗi 401 | Browser E2E | P0 | Đang ở trong Dashboard | 1. Bấm nút "Log out" trên Header.<br>2. Khi session key bị xoá hoặc backend trả 401. | Key bị xoá khỏi `sessionStorage`, trạng thái reset, giao diện quay ngay về `LoginView`. |
| **TC-UI-003** | Dashboard Tổng quan & Widget Token 24h | Browser E2E | P1 | Đã đăng nhập Admin | Quan sát trang Dashboard chính. | Hiển thị các thẻ chỉ số (Accounts, Models, API Keys, Uptime), bảng hạn mức quota, và Widget Token Usage 24h có nút chuyển nhanh sang trang Analytics. |
| **TC-UI-004** | Quản lý Tài khoản (Tìm kiếm, Lọc Provider, Sửa tên, Bật/Tắt) | Browser E2E | P0 | Đã đăng nhập, tab Accounts | 1. Gõ tìm kiếm theo email/id.<br>2. Lọc theo provider (Google, Anthropic).<br>3. Sửa tên tài khoản inline.<br>4. Bấm toggle chuyển tài khoản sang Disabled và kiểm tra badge. | Bộ lọc hoạt động tức thì; tên mới được lưu và hiển thị lại sau reload; badge Disabled cập nhật chính xác. |
| **TC-UI-005** | Quản lý API Key (Tạo mới, Copy 1 lần, Masked View, Xoá) | Browser E2E | P0 | Đã đăng nhập, tab API Keys | 1. Bấm "Create API Key", nhập tên, chọn role.<br>2. Dialog hiện raw key kèm nút Copy và cảnh báo chỉ hiện 1 lần.<br>3. Đóng dialog, kiểm tra bảng danh sách.<br>4. Bấm xoá key. | Raw key được hiển thị và copy thành công; bảng danh sách chỉ hiển thị `keyPreview`; key bị xoá biến mất khỏi danh sách. |
| **TC-UI-006** | Trình chỉnh sửa Quy tắc Định tuyến (Routing Editor) | Browser E2E | P1 | Đã đăng nhập, tab Routing Rules | 1. Mở modal chỉnh sửa rule.<br>2. Thay đổi thứ tự ưu tiên pipeline (reorder).<br>3. Bấm Lưu và reload lại trang. | Thứ tự pipeline mới được bảo toàn sau khi reload. |
| **TC-UI-007** | Danh mục Models Động & Specs | Browser E2E | P1 | Đã đăng nhập, tab Models | 1. Kiểm tra danh sách models được phát hiện.<br>2. Bấm xem specs chi tiết (Thinking budget, Max tokens).<br>3. Bấm icon copy model id. | Hiển thị đúng badge (Vision, Thinking); specs mở modal chi tiết; copy model id hiện toast thông báo. |
| **TC-UI-008** | Trang Phân tích Nâng cao (AnalyticsView & Biểu đồ SVG) | Browser E2E | P0 | Đã đăng nhập, tab Token Analytics | 1. Chọn các mốc thời gian: 1h, 24h, 7d, 30d, 90d, 1y.<br>2. Chọn lọc theo từng API Key.<br>3. Di chuột lên biểu đồ SVG xem hover tooltip.<br>4. Chuyển đổi xem biểu đồ theo Token hoặc theo Requests.<br>5. Quan sát bảng Top Models và bảng chi tiết API Key. | Biểu đồ SVG phản hồi mượt mà không lỗi; số liệu tổng hợp thay đổi tương ứng theo bộ lọc thời gian và key. |
| **TC-UI-009** | Xuất Báo cáo Thống kê ra File CSV (Export CSV) | Browser E2E | P1 | Đang ở tab Token Analytics | Bấm nút "Export CSV". | Trình duyệt kích hoạt tải về file `.csv` chứa đầy đủ cột: Model, API Key, Prompt Tokens, Completion Tokens, Total Tokens, Chi phí USD. |
| **TC-UI-010** | Playground Studio (Chat Đa lượt, Tham số & Sinh Code Mẫu) | Browser E2E | P0 | Đã đăng nhập, tab Playground | 1. Kiểm tra bộ chọn model, slider Temperature (0.0 - 2.0), Max Tokens, ô System Prompt.<br>2. Nhập câu hỏi và gửi chat.<br>3. Kiểm tra khung Code Sample bên phải: Bấm lần lượt các tab `cURL`, `Python`, `Node.js`, `Fetch`.<br>4. Bấm nút "Copy Code". | Code snippet tự động cập nhật đúng model và tham số đang chọn; chuyển tab mượt mà; bấm copy hiện toast thông báo thành công. |
| **TC-UI-011** | Cấu hình Agent Cài đặt Sẵn (Agent Setup) | Browser E2E | P1 | Đã đăng nhập, tab Agent Setup | Chọn lần lượt các preset: Cursor, Claude Code, Cline, OpenCode, Aider. | Code snippet tương ứng tự động sinh ra kèm địa chỉ Base URL cổng hiện tại và hướng dẫn điền API Key. |
| **TC-UI-012** | Đa ngôn ngữ (i18n Parity: Tiếng Anh & Tiếng Việt) | Browser E2E | P1 | Toàn bộ giao diện | 1. Bấm nút chuyển đổi cờ 🇻🇳 VI sang 🇺🇸 EN và ngược lại.<br>2. Reload lại trình duyệt. | Toàn bộ nhãn, nút bấm, menu, thông báo toast chuyển ngữ 100% chuẩn xác không bị lộ key dịch; lựa chọn ngôn ngữ được ghi nhớ trong `localStorage`. |

---

## Module 8: Hạ tầng Lưu trữ, Cơ sở dữ liệu SQLite/Redis & Công cụ Dòng lệnh CLI

### Bảng Test Cases: Module 8

| Mã TC | Tên Test Case | Cấp độ | Ưu tiên | Tiền điều kiện | Các bước thực hiện & Dữ liệu kiểm thử | Kết quả mong đợi |
|---|---|---|---|---|---|---|
| **TC-INFRA-001** | Ghi tệp JSON Nguyên tử (Atomic POSIX Write) | Unit | P0 | File hệ thống Linux/macOS | `atomic-json-file.ts` ghi đồng thời dữ liệu lớn vào `accounts.json` hoặc `routing.json`. | Ghi vào file tạm `.tmp.<pid>.<ts>` rồi `fs.rename` nguyên tử, ngăn ngừa tuyệt đối nguy cơ hỏng file khi tắt máy đột ngột. |
| **TC-INFRA-002** | Cấu hình SQLite WAL Mode và Busy Timeout 5000ms | Unit / E2E | P0 | Khởi tạo TypeORM connection | Kiểm tra PRAGMA `journal_mode` và `busy_timeout`. | `journal_mode = WAL` cho phép đọc ghi đồng thời; `busy_timeout = 5000` loại bỏ lỗi SQLite database locked khi tải cao. |
| **TC-INFRA-003** | Thực thi Tự động Migration (`migrationsRun: true`) | Integration E2E | P0 | Chạy server với database trống | Khởi động server NestJS. | Tự động chạy tất cả file migration còn thiếu theo thứ tự thời gian; không sử dụng `synchronize: true` gây mất dữ liệu. |
| **TC-INFRA-004** | Tích hợp Redis Cluster Tuỳ chọn (Lazy Dynamic Import) | Unit | P1 | Khi không đặt `REDIS_URL` vs khi có `REDIS_URL` | 1. Chạy không có `REDIS_URL`.<br>2. Chạy với `REDIS_URL=redis://127.0.0.1:6379`. | Khi không có Redis, hệ thống chạy thuần in-memory không tốn tài nguyên; khi có Redis, kích hoạt `RedisAccountLeaseTokenStore` và `RedisCooldownBus`. |
| **TC-INFRA-005** | CLI Quản lý API Key (`npm run api-key ...`) | Unit / CLI | P1 | Terminal console | Chạy các lệnh: `list`, `create`, `toggle`, `delete`. | Thực hiện CRUD API keys nhanh chóng từ terminal mà không cần mở trình duyệt. |
| **TC-INFRA-006** | CLI Thêm Tài khoản Đa Nền tảng (`npm run add-account ...`) | Unit / CLI | P1 | Terminal console | Chạy `add-account` với cờ `--provider anthropic`, `--provider openai`, `--provider copilot`. | Parse tham số chính xác và lưu vào `accounts.json` an toàn. |

---

## Hướng dẫn Chạy Kiểm thử Toàn bộ Hệ thống (Test Execution Guide)

Để chạy toàn bộ các lớp kiểm thử tự động tương ứng với ma trận trên:

```bash
# 1. Chạy 100% Unit Tests (Logic chuyển đổi, Security, Mappers, Stores)
npm run test:unit

# 2. Chạy Unit Tests kèm đo độ phủ dòng lệnh (Coverage Report)
npm run test:unit -- --coverage

# 3. Chạy toàn bộ E2E API Tests (Xác thực, Nock stubs, GraphQL, Upstreams)
npm run test:e2e

# 4. Chạy toàn bộ Browser E2E Tests (Playwright Chromium headless)
npm run test:playwright

# 5. Chạy Playwright với giao diện tương tác trực quan (UI Mode)
npm run test:playwright:ui

# 6. Chạy toàn bộ tất cả các tầng kiểm thử theo thứ tự tự động
npm run test:all
```
