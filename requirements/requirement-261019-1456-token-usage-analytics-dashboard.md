# Tài liệu Yêu cầu Kỹ thuật: Hệ thống Thống kê & Phân tích Token Nâng cao (Token Usage Analytics Dashboard)

* **Mã tài liệu:** `requirement-261019-1456-token-usage-analytics-dashboard`
* **Ngày tạo:** 19/10/2026
* **Trạng thái:** `ĐÃ CHỐT 2026-10-19`
* **Repository áp dụng:** `antigravity-proxy`

---

## 1. Vấn đề

### 1.1. Yêu cầu nghiệp vụ
Hệ thống hiện tại cần bổ sung tính năng Dashboard nâng cao nhằm:
1. Thống kê lượng token đã sử dụng (`Prompt Tokens`, `Completion Tokens`, `Total Tokens`) cho toàn bộ hệ thống và phân tách chi tiết theo từng API Key.
2. Thống kê theo các mốc thời gian linh hoạt: `1 Giờ (1h)`, `24 Giờ (24h/1d)`, `7 Ngày (7d)`, `30 Ngày (30d/1m)`, `90 Ngày (90d)`, `1 Năm (1y)` và `Khoảng thời gian tùy chọn (Custom Date Range)`.
3. Cung cấp API chuẩn **GraphQL** để truy vấn dữ liệu thống kê tổng hợp, biểu đồ chuỗi thời gian (time-series), bảng xếp hạng các model được dùng nhiều nhất (Top Models), và chi tiết lượng token theo từng model.
4. Ước tính chi phí sử dụng (USD) dựa trên bảng giá token của từng model.
5. Xuất dữ liệu thống kê ra file định dạng CSV trực tiếp từ giao diện.
6. Cung cấp giao diện trực quan 2 tầng: Một widget tóm tắt nhanh trên trang Dashboard chính và một trang chuyên sâu **Analytics** trên thanh Sidebar với biểu đồ time-series thuần SVG/Tailwind mượt mà.

### 1.2. Khảo sát hiện trạng code (Claims vs Code)

| Yêu cầu / Giả định | Đánh giá | Dẫn chứng trong code (`file:line`) | Nhận định thực tế |
|---|---|---|---|
| **Ghi nhận số token của mỗi request** | **TRUE** | `src/modules/proxy-gateway/audit/audit-usage.ts:1-100`<br>`src/modules/proxy-gateway/audit/traffic-audit-context.ts:404-418`<br>`src/modules/proxy-gateway/audit/entities/traffic-log.entity.ts:33-40` | Proxy đã tự động bóc tách `promptTokens`, `completionTokens`, `totalTokens` từ stream/response và lưu vào bảng `traffic_logs`. |
| **Gắn token với từng API Key** | **TRUE** | `src/modules/proxy-gateway/audit/entities/traffic-log.entity.ts:9-10`<br>`src/modules/proxy-gateway/audit/traffic-audit.service.ts:95,169`<br>`src/modules/proxy-gateway/audit/traffic-audit-context.ts:405` | Cột `apiKeyId` đã có trong bảng `traffic_logs` (và có index `IDX_traffic_logs_apiKeyId`), được gán ID của API Key tạo request. |
| **Lưu trữ lâu dài để thống kê 1 tháng, 1 năm** | **FALSE / GIỚI HẠN** | `src/modules/proxy-gateway/audit/traffic-audit.service.ts:110-116` | Bảng `traffic_logs` hiện có cơ chế tự động xóa bản ghi cũ, **chỉ giữ tối đa 10.000 requests gần nhất** (`ORDER BY timestamp DESC LIMIT -1 OFFSET 10000`). Nếu hệ thống gọi nhiều, 10.000 log sẽ chỉ tương đương vài ngày, không thể tính toán 1m/1y nếu không gỡ bỏ giới hạn này. |
| **API thống kê token theo mốc thời gian hoặc API key** | **FALSE** | `src/modules/proxy-gateway/server/modules/observability/observability.controller.ts:54-67`<br>`src/modules/proxy-gateway/audit/traffic-audit.service.ts:305-327` | API `GET /internal/audit/stats` hiện chỉ đếm số lượng bản ghi và dung lượng byte; chưa có API nào tính `SUM(totalTokens)` gom nhóm theo thời gian (bucket) hay theo `apiKeyId`. |
| **Hỗ trợ GraphQL API** | **FALSE** | `package.json:33-52`<br>`src/server/app.module.ts:1-40` | Hệ thống hiện tại chỉ dùng REST API thuần với NestJS Fastify; chưa cài đặt và cấu hình module GraphQL. |
| **Dashboard UI có biểu đồ và bộ lọc thời gian thống kê token** | **FALSE** | `web/src/views/DashboardView.tsx:64-146`<br>`web/src/views/AuditLogsView.tsx:51-95` | `DashboardView` hiện chỉ có card đếm tổng quan (accounts, models, api keys, uptime) và bảng hạn mức upstream. `AuditLogsView` chỉ là bảng danh sách log phân trang đơn thuần. |

---

## 2. Phạm vi

### 2.1. Trong phạm vi (In-scope)
* **Backend (`src/`)**:
  * Tích hợp `@nestjs/graphql` và `@nestjs/mercurius` (GraphQL adapter chính thức cho NestJS + Fastify).
  * Migration cơ sở dữ liệu: Bổ sung composite index trên bảng `traffic_logs`:
    * `(apiKeyId, timestamp)`
    * `(model, timestamp)`
  * Cập nhật `TrafficAuditService`: Loại bỏ giới hạn cứng 10.000 bản ghi; bổ sung engine tính toán thống kê tổng hợp (aggregations, time-series bucketing, top models, model breakdown) trực tiếp từ SQLite.
  * Bổ sung bảng giá model (Model Pricing Catalog) để tính toán ước tính chi phí sử dụng (USD).
  * Xây dựng GraphQL Schema (Code-first), Object Types, Input Types và `TokenAnalyticsResolver` bảo vệ bởi `AdminGuard`.
* **Frontend (`web/`)**:
  * Thêm helper gọi GraphQL query tại `web/src/api/client.ts` thông qua `fetch` (zero-dependency).
  * Tạo view mới `AnalyticsView.tsx`:
    * Bộ chọn mốc thời gian nhanh: `1h`, `24h`, `7d`, `30d`, `90d`, `1y` và `Custom` (từ ngày - đến ngày).
    * Bộ lọc API Key: Tất cả keys hoặc chọn key cụ thể.
    * Thẻ tóm tắt chỉ số: Tổng token, Prompt token, Completion token, Tổng requests, Chi phí ước tính (USD), Độ trễ trung bình.
    * Biểu đồ chuỗi thời gian (Time-series chart) thuần SVG/Tailwind hỗ trợ xem theo Token và Requests kèm hover tooltip.
    * Bảng Top Models (xếp hạng model được gọi nhiều nhất kèm % và chi phí).
    * Bảng phân bổ chi tiết Token theo Model.
    * Bảng phân bổ chi tiết Token theo API Key (kèm thanh progress trực quan).
    * Nút xuất dữ liệu báo cáo ra file CSV (Export CSV).
  * Cập nhật `DashboardView.tsx`: Bổ sung Token Usage Summary Widget 24h và shortcut dẫn tới trang Analytics.
  * Cập nhật `Sidebar.tsx` và `App.tsx`: Bổ sung điều hướng cho tab `Analytics`.
  * Cập nhật i18n: Song ngữ Anh - Việt cho toàn bộ màn hình và thông báo.

### 2.2. Ngoài phạm vi (Out-of-scope)
* Không lưu nội dung chat/prompt/completion vào database (duy trì bảo mật và dung lượng tối thiểu).
* Không thay đổi hoặc can thiệp vào các đường dẫn proxy AI cốt lõi (`/v1/chat/completions`, `/v1/messages`, `/v1beta/models/...`).
* Không cài đặt thư viện biểu đồ bên ngoài nặng nề (như Recharts hay Chart.js) vào frontend nhằm tránh xung đột React 19 và giữ ứng dụng siêu nhẹ.

---

## 3. Nguyên tắc bắt buộc (Invariants)

* **R1 (Bảo mật GraphQL)**: Endpoint `/graphql` cho tính năng analytics bắt buộc phải đi qua `AdminGuard` và kiểm tra quyền admin tương tự các API `/internal/*`.
* **R2 (Tương thích React 19 & Zero Dependency Charting)**: Toàn bộ biểu đồ trực quan hóa phải được viết bằng React + SVG thuần kết hợp Tailwind CSS, không cài thêm dependency biểu đồ bên thứ ba.
* **R3 (Không gián đoạn Database / Zero Downtime)**: Migration thêm index trên bảng `traffic_logs` sử dụng cú pháp `CREATE INDEX IF NOT EXISTS` an toàn, không được làm khóa bảng ghi log của proxy.
* **R4 (Xử lý an toàn dữ liệu rỗng)**: Khi hệ thống mới chạy hoặc không có dữ liệu trong khoảng thời gian được chọn, toàn bộ chỉ số phải hiển thị 0 an toàn, không xảy ra lỗi chia cho 0 (`NaN%`) hay làm sập giao diện người dùng.
* **R5 (Bảo toàn Audit Log)**: Việc mở rộng khả năng query thống kê không được làm ảnh hưởng đến chức năng hiển thị danh sách audit log phân trang hiện có trong tab `AuditLogsView`.

---

## 4. Quyết định thiết kế (Design Decisions)

### D1: Truy vấn thống kê trực tiếp từ Raw Log với SQLite Aggregations
* **Lựa chọn**: Sử dụng trực tiếp câu lệnh SQL tổng hợp (`SUM`, `COUNT`) và `GROUP BY` trên bảng `traffic_logs` của SQLite (`better-sqlite3`).
* **Lý do**: SQLite chạy in-process cực nhanh (vài millisecond). Dữ liệu tính toán luôn đồng bộ tức thì theo thời gian thực (real-time) với từng request vừa hoàn tất, không cần đồng bộ thêm bảng phụ.
* **Phương án bị loại bỏ**: Bảng tổng hợp Rollup phụ (gây phức tạp việc bảo trì dữ liệu khi xóa/sửa hoặc sửa đổi cấu trúc bảng).

### D2: Gỡ bỏ giới hạn cắt tỉa cứng 10.000 bản ghi
* **Lựa chọn**: Loại bỏ câu lệnh ngẫu nhiên xóa sau 10.000 log trong `TrafficAuditService.recordTraffic`. Thêm cấu hình số ngày lưu trữ (`retentionDays`, mặc định giữ 365 ngày hoặc không giới hạn) để phục vụ mốc xem 1 năm.
* **Lý do**: Lưu 10.000 bản ghi không đủ dữ liệu để thống kê mốc 30 ngày hoặc 1 năm đối với hệ thống chạy thực tế.
* **Phương án bị loại bỏ**: Giữ nguyên giới hạn 10k log (sẽ làm sai lệch hoàn toàn thống kê thời gian dài).

### D3: Tối ưu hóa hiệu năng bằng Composite Indexes
* **Lựa chọn**: Tạo 2 composite index mới trên SQLite:
  1. `IDX_traffic_logs_apiKeyId_timestamp` trên `(apiKeyId, timestamp)`: Phục vụ lọc theo key cụ thể trong khoảng thời gian.
  2. `IDX_traffic_logs_model_timestamp` trên `(model, timestamp)`: Phục vụ nhóm dữ liệu theo model trong khoảng thời gian.
* **Lý do**: Giúp SQLite nhảy trực tiếp đến dải bản ghi cần tính toán theo B-Tree, giữ tốc độ truy vấn ổn định kể cả khi bảng có hàng trăm nghìn dòng.

### D4: Động hóa khoảng chia thời gian (Dynamic Time-series Bucketing)
* **Lựa chọn**: Tự động xác định bước nhảy (bucket size) dựa theo mốc thời gian:
  * `1h`: Bước 5 phút (12 điểm).
  * `24h`: Bước 1 giờ (24 điểm).
  * `7d`: Bước 6 giờ hoặc 1 ngày (28 hoặc 7 điểm).
  * `30d`: Bước 1 ngày (30 điểm).
  * `90d`: Bước 3 ngày hoặc 1 tuần.
  * `1y`: Bước 1 tháng (12 điểm).
  * `custom`: Tự động tính toán (<= 2 ngày chia theo giờ, <= 60 ngày chia theo ngày, > 60 ngày chia theo tháng).
* **Lý do**: Đảm bảo biểu đồ luôn có số lượng điểm tối ưu (từ 12 đến 31 điểm), tránh quá tải trình duyệt và hiển thị trực quan đẹp mắt.

### D5: Sử dụng GraphQL với NestJS Fastify Mercurius
* **Lựa chọn**: Sử dụng `@nestjs/graphql` và `@nestjs/mercurius`.
* **Lý do**: Mercurius là GraphQL adapter tối ưu và chính thống nhất cho Fastify trong NestJS; cho phép client chỉ lấy đúng các trường dữ liệu cần thiết (summary, timeSeries, byModel, byApiKey).
* **Phía Frontend**: Sử dụng trực tiếp `fetch` qua hàm `graphqlRequest()` trong `api/client.ts`, không cần cài thêm Apollo Client hay Relay, giữ web cực nhẹ.

### D6: Bảng giá quy đổi chi phí (Model Pricing Catalog)
* **Lựa chọn**: Định nghĩa bảng giá tham chiếu (USD / 1 triệu tokens) cho các dòng model phổ biến (Gemini 2.5/3.0/3.7, Claude 3.5/3.7/Sonnet/Opus, GPT-4o/o3-mini...) và mức giá mặc định cho model tùy chỉnh.
* **Lý do**: Giúp quản trị viên kiểm soát chi phí thực tế phát sinh của từng API Key và từng Model.

### D7: Xuất báo cáo CSV phía Client (Client-side Export)
* **Lựa chọn**: Sinh và tải file CSV trực tiếp từ dữ liệu GraphQL đã tải về trình duyệt người dùng.
* **Lý do**: Không tốn tài nguyên xử lý file của máy chủ proxy, tải về ngay lập tức không có độ trễ.

### D8: Giao diện kép (Dashboard Summary Widget + Tab Analytics chuyên sâu)
* **Lựa chọn**: Đặt 1 widget tóm tắt trên trang Dashboard và toàn bộ trang biểu đồ / bộ lọc phân tích tại Tab riêng trên Sidebar.
* **Lý do**: Người dùng vừa nắm bắt nhanh tình hình ngay tại Dashboard, vừa có không gian rộng rãi để đào sâu số liệu tại trang Analytics.

---

## 5. Data Model & Migrations

### 5.1. Database Migration (`src/modules/database/migrations/1790640000000-AddTrafficLogsAnalyticsIndexes.ts`)
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrafficLogsAnalyticsIndexes1790640000000 implements MigrationInterface {
  name = 'AddTrafficLogsAnalyticsIndexes1790640000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_traffic_logs_apiKeyId_timestamp" ON "traffic_logs" ("apiKeyId", "timestamp")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_traffic_logs_model_timestamp" ON "traffic_logs" ("model", "timestamp")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_traffic_logs_model_timestamp"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_traffic_logs_apiKeyId_timestamp"`);
  }
}
```

---

## 6. Điểm enforce & GraphQL API Schema

### 6.1. GraphQL Types & Schema
Endpoint: `POST /graphql` (Header: `Authorization: Bearer <ADMIN_KEY>`)

```graphql
enum TimeRangePreset {
  ONE_HOUR      # 1h
  TWENTY_FOUR_HOURS # 24h
  SEVEN_DAYS    # 7d
  THIRTY_DAYS   # 30d
  NINETY_DAYS   # 90d
  ONE_YEAR      # 1y
  CUSTOM        # custom range
}

input TokenStatsFilterInput {
  range: TimeRangePreset!
  from: Float # Epoch timestamp (ms)
  to: Float   # Epoch timestamp (ms)
  apiKeyId: String # Lọc theo 1 key cụ thể (null: tất cả)
}

type TokenStatsSummary {
  totalTokens: Float!
  promptTokens: Float!
  completionTokens: Float!
  totalRequests: Int!
  successfulRequests: Int!
  failedRequests: Int!
  avgLatencyMs: Float!
  estimatedCostUsd: Float!
}

type TimeSeriesDataPoint {
  timestamp: Float!
  label: String!
  promptTokens: Float!
  completionTokens: Float!
  totalTokens: Float!
  requestCount: Int!
  estimatedCostUsd: Float!
}

type ApiKeyTokenUsage {
  apiKeyId: String!
  name: String!
  keyPreview: String!
  promptTokens: Float!
  completionTokens: Float!
  totalTokens: Float!
  requestCount: Int!
  percentage: Float!
  estimatedCostUsd: Float!
}

type ModelTokenUsage {
  model: String!
  promptTokens: Float!
  completionTokens: Float!
  totalTokens: Float!
  requestCount: Int!
  percentage: Float!
  estimatedCostUsd: Float!
}

type TopModelRanking {
  rank: Int!
  model: String!
  totalTokens: Float!
  requestCount: Int!
  percentage: Float!
  estimatedCostUsd: Float!
}

type TokenUsageStatsResponse {
  range: String!
  from: Float!
  to: Float!
  summary: TokenStatsSummary!
  timeSeries: [TimeSeriesDataPoint!]!
  byApiKey: [ApiKeyTokenUsage!]!
  byModel: [ModelTokenUsage!]!
  topModels: [TopModelRanking!]!
}

type Query {
  tokenUsageStats(filter: TokenStatsFilterInput!): TokenUsageStatsResponse!
}
```

### 6.2. Model Pricing Reference Catalog
| Dòng Model | Giá Prompt Token ($/1M tokens) | Giá Completion Token ($/1M tokens) |
|---|---|---|
| `claude-3-7-sonnet*` / `claude-sonnet-4*` | $3.00 | $15.00 |
| `claude-3-5-haiku*` | $0.80 | $4.00 |
| `claude-3-opus*` | $15.00 | $75.00 |
| `gemini-2.5-pro` / `gemini-3.1-pro*` | $1.25 | $5.00 |
| `gemini-2.5-flash` / `gemini-3-flash*` | $0.15 | $0.60 |
| `gpt-4o` | $2.50 | $10.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| Mặc định (Khác / Unknown) | $1.00 | $3.00 |

---

## 7. Danh sách Đầu việc (Work Items)

| Mã việc | Repository & File cần xử lý | Tiêu chí hoàn thành (Done Criterion) | Trực thuộc Quyết định |
|---|---|---|---|
| **W1** | `package.json`, `src/server/app.module.ts` | Cài đặt `@nestjs/graphql`, `@nestjs/mercurius`, `mercurius`. Khai báo `GraphQLModule.forRoot<MercuriusDriverConfig>` hỗ trợ code-first schema tại `/graphql`. | D4, D5 |
| **W2** | `src/modules/database/migrations/1790640000000-AddTrafficLogsAnalyticsIndexes.ts`, `src/modules/database/database.config.ts` | Tạo migration thêm composite indexes cho `traffic_logs`, chạy migration thành công trên SQLite. | D3 |
| **W3** | `src/modules/proxy-gateway/audit/traffic-audit.service.ts` | Bỏ giới hạn cứng 10.000 log. Triển khai phương thức `getTokenUsageStats(filter)` truy vấn `traffic_logs` bằng SQL aggregate, chia bucket time-series, gom nhóm theo model & API Key, và áp dụng bảng giá tính `estimatedCostUsd`. | D1, D2, D4, D6 |
| **W4** | `src/modules/proxy-gateway/server/modules/observability/token-analytics.resolver.ts`, `dto/token-analytics.dto.ts` | Tạo Resolver và DTO Types cho GraphQL, áp dụng `AdminGuard` cho Query `tokenUsageStats`. | D5, R1 |
| **W5** | `web/src/api/client.ts`, `web/src/components/charts/TimeSeriesChart.tsx` | Viết hàm `fetchTokenStatsGraphQL(filter)`. Xây dựng component biểu đồ chuỗi thời gian thuần SVG + Tailwind (hỗ trợ chuyển đổi hiển thị Token/Request, hover tooltip, responsive). | R2, D8 |
| **W6** | `web/src/views/AnalyticsView.tsx`, `web/src/lib/exportCsv.ts` | Tạo màn hình Analytics: bộ lọc mốc thời gian (1h, 24h, 7d, 30d, 90d, 1y, custom), bộ lọc API Key, thẻ tổng quan, biểu đồ time-series, Top Models, bảng Token theo Model, bảng Token theo API Key, và tính năng tải file CSV. | D4, D7, R4 |
| **W7** | `web/src/views/DashboardView.tsx`, `web/src/components/Sidebar.tsx`, `web/src/App.tsx`, `web/src/i18n/locales/{vi,en}.ts` | Bổ sung widget Token Usage 24h trên Dashboard chính, thêm tab `Analytics` (icon `BarChart3`) vào Sidebar, liên kết định tuyến trong `App.tsx`, và hoàn thiện từ khóa i18n Anh - Việt. | D8, R5 |

---

## 8. Thứ tự triển khai

```text
[W1: GraphQL Modules & Config] ───► [W2: DB Indexes Migration] ───► [W3: Audit Aggregation Service Engine]
                                                                                │
                                                                                ▼
[W5: Frontend SVG Chart & API] ◄─── [W4: GraphQL Resolver & Guard] ◄────────────┘
         │
         ▼
[W6: AnalyticsView & CSV Export] ───► [W7: Dashboard Widget, Sidebar & i18n] ───► Hoàn tất
```

1. **Bước 1**: Cài đặt thư viện GraphQL và chạy Migration database (`W1`, `W2`).
2. **Bước 2**: Triển khai logic tính toán thống kê và bảng giá tại backend (`W3`).
3. **Bước 3**: Tạo GraphQL Resolver, DTOs và tích hợp `AdminGuard` (`W4`).
4. **Bước 4**: Xây dựng client gọi GraphQL và component biểu đồ SVG thuần (`W5`).
5. **Bước 5**: Xây dựng toàn bộ giao diện `AnalyticsView` cùng chức năng xuất file CSV (`W6`).
6. **Bước 6**: Ghép nối Widget trên Dashboard, cập nhật Sidebar, định tuyến và đa ngôn ngữ (`W7`).

---

## 9. Rủi ro & Giải pháp giảm thiểu

| Rủi ro | Mức độ | Biện pháp giảm thiểu |
|---|---|---|
| Kích thước cơ sở dữ liệu SQLite phình to khi không xóa log sau 10.000 dòng | Trung bình | `traffic_logs` chỉ lưu metadata (không lưu nội dung prompt/response), mỗi bản ghi ~200 bytes. 1 triệu request chỉ chiếm ~200MB disk. Cung cấp thiết lập số ngày lưu trữ (`retentionDays`) để quản trị viên có thể dọn dẹp nếu muốn. |
| Xung đột thư viện hoặc hiệu năng GraphQL trên Fastify | Thấp | Sử dụng `@nestjs/mercurius`, bộ điều hợp Fastify chính thức được tối ưu riêng cho Fastify. |
| Thời gian truy vấn mốc 1 năm trên SQLite bị chậm | Thấp | Nhờ có composite indexes `(apiKeyId, timestamp)` và `(model, timestamp)`, SQLite quét index cực nhanh thay vì scan toàn bảng. |
| Tính toán phần trăm khi không có request bị lỗi `NaN%` | Thấp | Kiểm tra mẫu số: nếu `totalTokens === 0` thì trả về `0%`. |

---

## 10. Trạng thái tài liệu

* **Hiện tại:** `ĐÃ CHỐT 2026-10-19` (Đã được người dùng phê duyệt toàn bộ).

---

## 11. Câu hỏi cần chốt

*Hiện tại không có câu hỏi chặn nào đang mở. Tất cả các quyết định kiến trúc P0 và P1 đã được thống nhất.*
