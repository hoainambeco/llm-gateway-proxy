# Tài liệu Hướng dẫn Toàn diện: LLM Gateway Proxy Standalone

**LLM Gateway Proxy** là một cổng chuyển tiếp (LLM Proxy Gateway) hiệu năng cao, độc lập, được trích xuất từ lõi NestJS/Fastify của dự án AntigravityManager. 

Dự án cho phép bạn sử dụng các tài khoản **Google Cloud Code / Antigravity**, **GitHub Copilot**, **Claude.ai**, **ChatGPT** và **OpenAI** thông qua các giao thức phổ biến: **OpenAI**, **Anthropic Messages** và **Gemini API** với cơ chế tự động xoay vòng tài khoản (Multi-Account Pooling), tự động phục hồi Thought Signatures và chuyển tài khoản khi gặp lỗi giới hạn tốc độ (Rate Limit 429).

---

## Mục lục
1. [Điểm nổi bật của dự án](#1-điểm-nổi-bật-của-dự-án)
2. [Kiến trúc và Cơ chế hoạt động](#2-kiến-trúc-và-cơ-chế-hoạt-động)
3. [Cài đặt và Yêu cầu môi trường](#3-cài-đặt-và-yêu-cầu-môi-trường)
4. [Quản lý Tài khoản (Thêm nhiều tài khoản)](#4-quản-lý-tài-khoản-thêm-nhiều-tài-khoản)
5. [Cấu hình hệ thống (.env)](#5-cấu-hình-hệ-thống-env)
6. [Khởi chạy Server (NestJS CLI & Docker)](#6-khởi-chạy-server-nestjs-cli--docker)
7. [Hướng dẫn kết nối các Client (Cursor, Claude Code, Cline, OpenCode)](#7-hướng-dẫn-kết-nối-các-client)
8. [Danh sách Endpoints và Models hỗ trợ](#8-danh-sách-endpoints-và-models-hỗ-trợ)
9. [Xử lý lỗi thường gặp (Troubleshooting)](#9-xử-lý-lỗi-thường-gặp-troubleshooting)

---

## 1. Điểm nổi bật của dự án

- **Hoàn toàn độc lập (Headless):** Loại bỏ hoàn toàn Electron, React UI, và các thư viện C++ native (`better-sqlite3`, `keytar`). Không yêu cầu trình biên dịch khi cài đặt.
- **Đa giao thức (Multi-Protocol):**
  - Giả lập OpenAI API (`/v1/chat/completions`, `/v1/models`, `/v1/responses`, `/v1/images/generations`).
  - Giả lập Anthropic API (`/v1/messages`).
  - Hỗ trợ giao thức gốc Gemini (`/v1beta/models/...`).
- **Quản lý Pool tài khoản (Account Leasing):**
  - Hỗ trợ không giới hạn số lượng tài khoản Google Cloud.
  - Phân phối tải theo cơ chế **Round-Robin** (xoay vòng đều) hoặc **Sticky Session** (giữ nguyên tài khoản trong cùng phiên chat để tối ưu bộ nhớ đệm Context Cache).
  - Tự động phát hiện lỗi `429 Rate Limit` để đưa tài khoản vào thời gian nghỉ (Cooldown) và failover mượt mà sang tài khoản tiếp theo mà không làm gián đoạn request của người dùng.
- **Thought Signature Recovery:** Tự động khôi phục và duy trì chuỗi suy luận (Reasoning Trace / Signature) cho các mô hình suy nghĩ như **Claude 3.7 Sonnet (Thinking)** và **Gemini 2.0 Flash / Pro**, loại bỏ triệt để lỗi `400 Invalid Argument` do rụng signature khi gọi function calling/tools.
- **Tiêu chuẩn NestJS CLI & Web Dashboard:** Hỗ trợ đầy đủ các lệnh phát triển NestJS, tích hợp sẵn **Web UI Dashboard** hiện đại (React + Vite + TailwindCSS) tại `http://localhost:8044/` để quản lý trực quan tài khoản, quota models, API keys và traffic logs.

---

## 2. Kiến trúc và Cơ chế hoạt động

```plaintext
   +-------------------------------------------------------------+
   | Client (Cursor, Claude Code CLI, Cline, Roo Code, OpenCode)  |
   +-------------------------------------------------------------+
                                  |
                                  | HTTP (OpenAI / Anthropic / Gemini formats)
                                  v
   +-------------------------------------------------------------+
   |                LLM Gateway Proxy (Fastify)                  |
   |                                                             |
   |  [Guards & Auth] -> Xác thực API Key động (SQLite)          |
   |  [Mappers]       -> Chuẩn hóa Request sang định dạng Google |
   |  [Thought Store] -> Quản lý & phục hồi thought signatures   |
   |  [Account Lease] -> Xoay vòng tài khoản & Cooldown 429      |
   +-------------------------------------------------------------+
                                  |
                                  | Upstream HTTPS (Cloud Code Internal API)
                                  v
   +-------------------------------------------------------------+
   |        Google Cloud Code / Antigravity Upstream APIs        |
   +-------------------------------------------------------------+
```

1. **Client gửi Request:** Ví dụ Cursor gửi request dạng OpenAI `/v1/chat/completions` với model `claude-3-7-sonnet`.
2. **Account Selection:** Module `AccountLeaseService` kiểm tra danh sách tài khoản trong `accounts.json`, loại bỏ các tài khoản đang trong trạng thái cooldown 429, sau đó chọn tài khoản thích hợp nhất.
3. **Token Hydration:** Nếu `access_token` của tài khoản đã hết hạn, hệ thống tự động gọi Google OAuth để đổi `refresh_token` lấy `access_token` mới và ghi lại vào `accounts.json`.
4. **Protocol Translation:** Request được dịch sang định dạng Google Cloud Code Internal API (`loadCodeAssist` / `v1internal`). Nếu là model có thinking, proxy sẽ tự động kiểm tra và chèn thought signature phù hợp.
5. **Streaming Response:** Phản hồi từ Google được chuyển đổi ngược về dạng Server-Sent Events (SSE) theo chuẩn OpenAI / Anthropic và stream trực tiếp về client với độ trễ thấp nhất.

---

## 3. Cài đặt và Yêu cầu môi trường

### Yêu cầu
- **Node.js:** Phiên bản `>= 20.x` hoặc `>= 22.x`.
- **NPM:** Phiên bản `>= 9.x`.

### Các bước cài đặt
```bash
# 1. Clone và di chuyển vào thư mục dự án
git clone https://github.com/hoainambeco/llm-gateway-proxy.git
cd llm-gateway-proxy

# 2. Cài đặt các gói phụ thuộc
npm install

# 3. Tạo file cấu hình môi trường
cp .env.example .env
```

---

## 4. Quản lý Tài khoản Đa Nền Tảng (Multi-Provider)

Hệ thống hỗ trợ gộp đồng thời nhiều loại tài khoản: **Google Antigravity**, **Anthropic Claude**, và **OpenAI / GitHub Copilot**.

### Cách 1: Thêm tài khoản qua Terminal CLI 🚀
```bash
# 1. Thêm tài khoản Google Cloud / Antigravity (Đăng nhập tự động qua OAuth):
npm run add-account

# 2. Thêm Anthropic API Key (sk-ant-api03-...):
npm run add-account -- --provider anthropic --key sk-ant-api03-... --email user@example.com

# 3. Thêm Claude.ai Web Session (Cookie sk-ant-sid01-...):
npm run add-account -- --provider anthropic --session sk-ant-sid01-... --email user@example.com

# 4. Thêm GitHub Copilot Token (ghu_...):
npm run add-account -- --provider copilot --token ghu_... --email user@example.com

# 5. Thêm OpenAI Platform API Key (sk-proj-...):
npm run add-account -- --provider openai --key sk-proj-... --email user@example.com
```

### Cách 2: Điền thủ công vào file `accounts.json`
```json
[
  {
    "id": "agy-1",
    "provider": "google",
    "email": "user1@gmail.com",
    "token": {
      "refresh_token": "1//04_REFRESH_TOKEN",
      "access_token": "",
      "project_id": "your-gcp-project-1"
    }
  },
  {
    "id": "claude-1",
    "provider": "anthropic",
    "auth_type": "api_key",
    "email": "claude@example.com",
    "api_key": "sk-ant-api03-..."
  },
  {
    "id": "copilot-1",
    "provider": "copilot",
    "auth_type": "copilot_token",
    "email": "copilot@example.com",
    "github_token": "ghu_..."
  }
]
```

### Cấu hình Rule-Based Routing (`routing.json`)
Bạn có thể cấu hình thứ tự ưu tiên (pipeline) và tự động chuyển nguồn khi gặp lỗi rate-limit (429) trong file `routing.json`:
```json
{
  "rules": [
    {
      "pattern": "^(claude-3-7-sonnet|claude-3-5-sonnet)",
      "pipeline": ["google", "anthropic_api", "anthropic_oauth", "anthropic_web"],
      "description": "Ưu tiên dùng Antigravity (miễn phí), dính 429 thì fallback sang pool Claude"
    },
    {
      "pattern": "^(gpt-4o|o1|o3|codex)",
      "pipeline": ["copilot", "openai_api", "chatgpt_web", "google"],
      "description": "Ưu tiên Copilot & OpenAI, fallback sang Google transpile"
    },
    {
      "pattern": "^(gemini-|imagen)",
      "pipeline": ["google"]
    }
  ],
  "default_pipeline": ["google", "anthropic_api", "copilot", "openai_api"]
}
```
> **Ghi chú:** `access_token` có thể để trống `""`. Khi server chạy, nó sẽ tự động dùng `refresh_token` để lấy access token mới.
>
> Nếu bạn **tự điền** `access_token`, phải điền kèm `expiry_timestamp` tính bằng **giây** (Unix seconds, ví dụ `1740000000`), không phải milliseconds. Điền sai đơn vị thì token bị coi như còn hiệu lực hàng nghìn năm và cơ chế tự refresh sẽ không bao giờ chạy. Xem `accounts.json.example` để có bản đầy đủ mọi field.

---

## 4.1. Quản lý Đa API Key (TypeORM + SQLite)

Hệ thống hỗ trợ tạo, quản lý và thu hồi nhiều API Key linh hoạt được lưu trữ an toàn trong SQLite thông qua TypeORM. Các client (Cursor, Claude Code, Cline, OpenCode...) có thể dùng các API Key riêng biệt.

### Quản lý qua CLI Terminal:

```bash
# 1. Liệt kê danh sách API Key:
npm run api-key list

# 2. Tạo API Key mới (tự sinh sk-ag-...):
npm run api-key create "Cursor của Nam"

# 3. Tạo API Key với quyền Admin (để gọi các internal API):
npm run api-key create "Admin Dashboard" -- --role admin

# 4. Tạo API Key với chuỗi tuỳ chọn hoặc ngày hết hạn:
npm run api-key create "Key Đối Tác" -- --key sk-my-custom-key-123 --expires 2026-12-31

# 5. Tạm thời vô hiệu hoá (Pause / Resume) một API Key:
npm run api-key toggle "Cursor của Nam"

# 6. Xoá bỏ một API Key:
npm run api-key delete "Cursor của Nam"
# hoặc xoá bằng ID:
npm run api-key delete a987c4a3
```

### Quản lý qua REST API (Dành cho Admin):

Các endpoint nằm tại `/internal/api-keys` và được bảo vệ bởi `AdminGuard` (yêu cầu gửi header `Authorization: Bearer <ADMIN_OR_MASTER_KEY>`):
- `GET /internal/api-keys`: Danh sách các key (key được che bớt).
- `POST /internal/api-keys`: Tạo key mới (body: `{ "name": "...", "role": "client" | "admin", "customKey"?: "...", "expiresAt"?: "..." }`).
- `GET /internal/api-keys/:id`: Chi tiết key.
- `PATCH /internal/api-keys/:id`: Bật/tắt hoặc đổi tên key (body: `{ "isActive": false, "name": "..." }`).
- `DELETE /internal/api-keys/:id`: Xoá vĩnh viễn key.

### Quản lý Migration Database (TypeORM):

Hệ thống **tắt `synchronize: false`** để bảo đảm an toàn dữ liệu và sử dụng cơ chế migration tự động (`migrationsRun: true` khi khởi động server):

```bash
# Tự động so sánh Entity với Database để sinh file migration mới:
npm run migration:generate -- src/modules/database/migrations/<TenMigration>

# Chạy migration còn thiếu:
npm run migration:run

# Hoàn tác (Rollback) migration gần nhất:
npm run migration:revert

# Tạo file migration rỗng:
npm run migration:create -- src/modules/database/migrations/<TenMigration>
```

---

## 5. Cấu hình hệ thống (.env)

Mở file `.env` để tuỳ chỉnh các tham số:

| Biến môi trường | Mặc định | Ý nghĩa |
| :--- | :--- | :--- |
| `ANTIGRAVITY_OAUTH_CLIENT_ID` | *(trống)* | **Bắt buộc.** Client ID của OAuth client. Xem mục 9.4 nếu chưa có. |
| `ANTIGRAVITY_OAUTH_CLIENT_SECRET` | *(trống)* | **Bắt buộc.** Client secret, phải đặt cùng lúc với biến trên. |
| `ANTIGRAVITY_OAUTH_CLIENTS` | *(trống)* | Tuỳ chọn. Khai báo thêm client theo dạng `key\|client_id\|client_secret[\|label]`, nhiều entry cách nhau bằng `;`. Dùng khi muốn có client dự phòng để failover. |
| `ANTIGRAVITY_OAUTH_CLIENT_KEY` | `antigravity_enterprise` | Tuỳ chọn. Chọn client nào active lúc khởi động. Gõ sai key thì hệ thống lặng lẽ dùng client đầu tiên. |
| `PORT` | `8045` | Cổng HTTP mà proxy sẽ lắng nghe. |
| `HOST` | `0.0.0.0` | Địa chỉ host binding (`0.0.0.0` cho phép truy cập từ mạng LAN/Docker). |
| `SQLITE_DB_PATH` | `./data/antigravity.sqlite` | Đường dẫn file SQLite database lưu danh sách API Key. |
| `ACCOUNTS_FILE` | `./accounts.json` | Đường dẫn đến file lưu trữ danh sách tài khoản. |
| `ROUTING_STRATEGY` | `balance` | Chế độ xoay vòng: `balance` (xoay đều), `cache-first` (ưu tiên context cache), `performance-first`. |

---

## 6. Khởi chạy Server (NestJS CLI & Docker)

### 1. Khởi chạy bằng Node / NPM

```bash
# Chế độ phát triển (Tự reload khi sửa code):
npm run start:dev

# Biên dịch dự án (Build dist/):
npm run build

# Chạy bản Production đã build:
npm run start:prod
```

### 2. Chạy dưới dạng Daemon bằng PM2 (cho VPS/Server)
```bash
# Cài PM2 toàn cục (nếu chưa có)
npm install -g pm2

# Build và khởi chạy
npm run build
pm2 start dist/main.js --name llm-gateway-proxy

# Lưu trạng thái tự khởi động lại khi reboot VPS:
pm2 save
pm2 startup
```

### 3. Khởi chạy bằng Docker
File `Dockerfile` đã được tối ưu hóa multi-stage build:
```bash
# Build Docker image
docker build -t llm-gateway-proxy .

# Chạy container và mount file accounts.json
docker run -d \
  --name llm-gateway-proxy \
  -p 8045:8045 \
  -v $(pwd)/accounts.json:/app/data/accounts.json \
  -e PORT=8045 \
  --restart always \
  llm-gateway-proxy
```

---

## 7. Hướng dẫn kết nối các Client

Khi khởi động server lần đầu với database trống, hệ thống sẽ tự động tạo một bootstrap Admin Key (`sk-ag-...`) và in ra log console một lần duy nhất (hoặc cấu hình sẵn qua biến môi trường `INITIAL_ADMIN_KEY`). Bạn dùng key này để đăng nhập vào Web Dashboard (`http://localhost:8045/`) và tạo các API Key riêng cho từng client:
```bash
# Hoặc tạo trực tiếp qua CLI:
npm run api-key create "Cursor của Nam"
# Lấy key có dạng: sk-ag-xxxxxxxxxxxxxxxxxxxxxxxx
```

---

### A. Cursor IDE
1. Mở **Cursor Settings** (phím tắt `Ctrl + Shift + J` hoặc `Cmd + Shift + J`) -> chọn tab **Models**.
2. Thêm các model bạn muốn sử dụng vào danh sách:
   - `claude-3-7-sonnet` (hoặc `claude-3-7-sonnet-thought`)
   - `claude-3-5-sonnet-20241022`
   - `gemini-2.5-pro`
   - `gemini-2.0-flash-exp`
3. Cuộn xuống mục **OpenAI API Key**:
   - Bật gạt **Override OpenAI Base URL**.
   - **Base URL:** `http://localhost:8045/v1`
   - **API Key:** Nhập API Key bạn vừa tạo (`sk-ag-...`) từ Dashboard hoặc CLI.
4. Nhấn **Verify** để kiểm tra kết nối (hiển thị tích xanh là thành công).

---

### B. OpenCode CLI
OpenCode hỗ trợ kết nối thông qua file cấu hình `opencode.json` (tại thư mục project hoặc `~/.config/opencode/opencode.json`) hoặc thông qua biến môi trường:

#### Cách 1: Cấu hình `opencode.json` (Khuyên dùng)
Tạo hoặc chỉnh sửa file `opencode.json`:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "antigravity": {
      "npm": "@ai-sdk/openai",
      "options": {
        "baseURL": "http://localhost:8045/v1",
        "apiKey": "sk-ag-YOUR_API_KEY"
      },
      "models": {
        "claude-3-7-sonnet": {
          "name": "Claude 3.7 Sonnet (Proxy)"
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro (Proxy)"
        },
        "gemini-2.0-flash-exp": {
          "name": "Gemini 2.0 Flash (Proxy)"
        }
      }
    }
  }
}
```

#### Cách 2: Biến môi trường
```bash
export OPENAI_BASE_URL="http://localhost:8045/v1"
export OPENAI_API_KEY="sk-ag-YOUR_API_KEY"

# Khởi chạy opencode với model tuỳ chọn
opencode --model openai/claude-3-7-sonnet
```

---

### C. Claude Code CLI (Official Anthropic CLI)
Claude Code sử dụng trực tiếp giao thức Anthropic Messages API (`/v1/messages`) được LLM Gateway Proxy giả lập chuẩn 100%:

```bash
# Thiết lập biến môi trường
export ANTHROPIC_BASE_URL="http://localhost:8045"
export ANTHROPIC_API_KEY="sk-ag-YOUR_API_KEY"

# Chạy Claude Code
claude
```
> **Mẹo:** Proxy hỗ trợ đầy đủ tính năng suy luận sâu (Thinking / Extended Reasoning) của Claude 3.7 Sonnet mà không lo rụng Thought Signature khi tool execution.

---

### D. OpenAI Codex / OpenAI SDK / ChatGPT Apps
Bất kỳ công cụ hoặc SDK nào hỗ trợ OpenAI đều có thể trỏ thẳng vào LLM Gateway Proxy:

#### Node.js / TypeScript (OpenAI SDK):
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'http://localhost:8045/v1',
  apiKey: 'sk-ag-YOUR_API_KEY',
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'claude-3-7-sonnet',
    messages: [{ role: 'user', content: 'Xin chào!' }],
  });
  console.log(completion.choices[0].message.content);
}
main();
```

#### Python (OpenAI SDK):
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8045/v1",
    api_key="sk-ag-YOUR_API_KEY",
)

response = client.chat.completions.create(
    model="claude-3-7-sonnet",
    messages=[{"role": "user", "content": "Hello world"}],
)
print(response.choices[0].message.content)
```

#### Codex WebSocket Responses (`/v1/responses`):
LLM Gateway Proxy hỗ trợ endpoint WebSocket chuẩn `/v1/responses` của OpenAI Responses API dành cho các agent Codex tương tác thời gian thực hai chiều.

---

### E. Cline & Roo Code (VS Code Extension)
1. Mở extension **Cline** hoặc **Roo Code** trong VS Code, nhấn vào biểu tượng bánh răng **Settings**.
2. Chọn **API Provider**:
   - **Cách 1 - Chuẩn OpenAI Compatible:**
     - **API Provider:** `OpenAI Compatible`
     - **Base URL:** `http://localhost:8045/v1`
     - **API Key:** `sk-ag-YOUR_API_KEY`
     - **Model ID:** `claude-3-7-sonnet` (hoặc `gemini-2.5-pro`)
   - **Cách 2 - Chuẩn Anthropic:**
     - **API Provider:** `Anthropic`
     - **Base URL:** `http://localhost:8045`
     - **API Key:** `sk-ag-YOUR_API_KEY`
     - **Model ID:** `claude-3-7-sonnet`

---

### F. Aider & Continue.dev
#### Aider (Terminal AI Pair Programmer):
```bash
aider --openai-api-base http://localhost:8045/v1 \
      --openai-api-key sk-ag-YOUR_API_KEY \
      --model openai/claude-3-7-sonnet
```

#### Continue.dev (`~/.continue/config.json`):
```json
{
  "models": [
    {
      "title": "Antigravity Claude 3.7",
      "provider": "openai",
      "model": "claude-3-7-sonnet",
      "apiBase": "http://localhost:8045/v1",
      "apiKey": "sk-ag-YOUR_API_KEY"
    },
    {
      "title": "Antigravity Gemini 2.5 Pro",
      "provider": "openai",
      "model": "gemini-2.5-pro",
      "apiBase": "http://localhost:8045/v1",
      "apiKey": "sk-ag-YOUR_API_KEY"
    }
  ]
}
```

---

## 8. Danh sách Endpoints và Models hỗ trợ

### Các Endpoints chính
| Endpoint | Giao thức | Mô tả |
| :--- | :--- | :--- |
| `POST /v1/chat/completions` | OpenAI | Sinh phản hồi chat (hỗ trợ SSE stream & tools) |
| `GET /v1/models` | OpenAI | Liệt kê danh sách các models đang sẵn sàng |
| `POST /v1/messages` | Anthropic | Chuẩn Messages API (hỗ trợ SSE stream & tools) |
| `POST /v1beta/models/:model:generateContent` | Gemini | Chuẩn sinh nội dung Gemini gốc |
| `POST /v1beta/models/:model:streamGenerateContent` | Gemini | Chuẩn SSE streaming Gemini gốc |

### Danh sách Model tiêu biểu
- **Anthropic Claude Family:**
  - `claude-3-7-sonnet` / `claude-3-7-sonnet-thought`
  - `claude-3-5-sonnet-20241022`
  - `claude-sonnet-4-6-thinking`
  - `claude-opus-4-6-thinking`
- **Google Gemini Family:**
  - `gemini-2.5-pro`
  - `gemini-2.5-flash`
  - `gemini-2.0-flash-exp`
  - `gemini-3-flash`
  - `gemini-3.7-flash`
- **Mã nguồn mở:**
  - `gpt-oss-120b-medium`

---

## 9. Chạy Bộ Test (Unit, E2E & Playwright)

Hệ thống đi kèm bộ kiểm thử tự động toàn diện:
```bash
# Chạy toàn bộ Unit test và E2E API test:
npm test

# Chạy riêng Unit test:
npm run test:unit

# Chạy riêng E2E API test:
npm run test:e2e

# Chạy Playwright E2E browser test:
npm run test:playwright

# Chạy tất cả các tầng test:
npm run test:all
```
Chi tiết về kiến trúc test, xem thêm tại file [TESTING.md](TESTING.md).

---

## 10. Xử lý lỗi thường gặp (Troubleshooting)

### 1. Lỗi `address already in use` hoặc `EADDRINUSE: 8045`
- **Nguyên nhân:** Cổng 8045 đang bị một tiến trình khác (hoặc app AntigravityManager chính) chiếm dụng.
- **Cách khắc phục:** 
  - Đổi biến `PORT=8046` trong file `.env`.
  - Hoặc tắt tiến trình cũ: `lsof -i :8045` -> `kill -9 <PID>`.

### 2. Lỗi `429 Too Many Requests`
- **Nguyên nhân:** Tài khoản hiện tại đã dùng hết hạn mức phút hoặc ngày của Google Cloud.
- **Cách khắc phục:** 
  - Proxy sẽ **tự động cooldown** tài khoản này và chuyển sang tài khoản khác trong `accounts.json`.
  - Để tránh gián đoạn, hãy thêm ít nhất 2 - 3 tài khoản Google Cloud bằng lệnh `npm run add-account`.

### 3. Lỗi `invalid_grant` khi refresh token
- **Nguyên nhân:** Refresh token của tài khoản đã bị người dùng thu hồi quyền hoặc hết hạn (thường sau 6 tháng nếu chưa xác minh ứng dụng).
- **Cách khắc phục:** Chạy lại lệnh `npm run add-account` để đăng nhập lại cho tài khoản đó.

### 4. Lỗi `No OAuth client configured`
- **Nguyên nhân:** Chưa cấu hình OAuth Client. Source code **không kèm** credential mặc định nào, nên đây là lỗi bắt buộc gặp khi mới clone về.
- **Cách khắc phục:** Đặt **cả hai** biến sau trong `.env` rồi khởi động lại:
  ```bash
  ANTIGRAVITY_OAUTH_CLIENT_ID=<client id>
  ANTIGRAVITY_OAUTH_CLIENT_SECRET=<client secret>
  ```
  Thiếu một trong hai thì proxy bỏ qua cả cặp và vẫn báo lỗi này (log sẽ có dòng `must be set together`).
- **Lấy credential ở đâu:** Trích từ bản Antigravity cài trên máy bạn. Client tự tạo trong GCP project riêng **không dùng được**, vì proxy cần các scope nội bộ của Google (`auth/aicode`, `auth/cclog`, `auth/experimentsandconfigs`) mà Google chỉ cấp cho first-party client. Xem mục "OAuth Client Credentials" trong `README.md`.
