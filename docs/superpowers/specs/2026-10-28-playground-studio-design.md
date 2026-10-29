# Thiết kế: Playground Studio & Code Sample Generator

Ngày: 2026-10-28
Trạng thái: Đang chờ duyệt
Phạm vi: Frontend (`web/src/views/PlaygroundView.tsx`, `Sidebar`, `App`, `i18n`, `lib/codeSamples.ts`)

---

## 1. Bối cảnh & Lý do

Người dùng sử dụng **LLM Gateway Proxy** thường xuyên cần:
1. Thử nghiệm trực tiếp các model được phát hiện động từ tài khoản (như Gemini 2.5 Pro, Gemini 3.8 Flash, Claude Sonnet/Opus, Argon...) để kiểm tra chất lượng câu trả lời, khả năng suy nghĩ (thinking/reasoning) và độ trễ.
2. Lấy ngay các đoạn mã mẫu (code samples) chuẩn xác theo đúng model và tham số đang thử nghiệm để nhúng vào script hoặc tool ngoài (Cursor, Cline, Python backend, Node.js bot...).

Hiện tại, Web UI có tab `Agent Setup` để xuất cấu hình IDE, nhưng thiếu một môi trường Playground tương tác trực tiếp để gửi nhận tin nhắn theo thời gian thực.

---

## 2. Mục tiêu, Non-goals & Anti-goals

### Mục tiêu (Goals)
1. **Interactive Chat Playground**:
   - Giao diện chat nhiều lượt (multi-turn), có ô nhập System Prompt và tin nhắn User.
   - Hỗ trợ gửi request tới `/v1/chat/completions` của proxy bằng API key đã lưu trong session hiện tại.
   - Hỗ trợ cả **SSE Streaming** (hiển thị câu trả lời từng từ một theo thời gian thực) lẫn Non-streaming.
   - Hiển thị khối Thinking (nếu model trả về nội dung suy nghĩ hoặc reasoning tokens).
   - Đo lường và hiển thị thời gian phản hồi (latency tính bằng mili-giây) và số token tiêu thụ.
2. **Real-time Code Sample Generator**:
   - Tự động sinh code mẫu đồng bộ theo model, system prompt, user prompt, temperature, max_tokens, stream đang thiết lập.
   - Cung cấp các tab chuyển đổi ngôn ngữ:
     - **cURL**: Lệnh bash hoàn chỉnh với header `Authorization` và URL proxy `http://localhost:<port>/v1/chat/completions`.
     - **Python**: Dùng SDK `openai` chính thức (`from openai import OpenAI`).
     - **Node.js / TypeScript**: Dùng package `openai` (`import OpenAI from "openai"`).
     - **Fetch API**: JavaScript thuần sử dụng `fetch()`.
   - Nút Copy 1-click có thông báo toast phản hồi.
3. **Tích hợp liền mạch**:
   - Thêm tab `playground` vào Sidebar menu (`TabType`), icon `Sparkles` hoặc `Terminal`.
   - 100% key parity ngôn ngữ Anh/Việt (`en.ts`, `vi.ts`, `types.ts`).

### Non-goals
- Không lưu vĩnh viễn lịch sử chat của Playground vào database SQLite (chỉ lưu trong React state của phiên làm việc).
- Không tạo endpoint backend mới (tái sử dụng hoàn toàn `/v1/chat/completions` chuẩn OpenAI sẵn có).

### Anti-goals
- Không gửi trực tiếp request ra ngoài Internet từ trình duyệt mà luôn gọi qua proxy gateway cục bộ để đảm bảo tuân thủ cơ chế xoay vòng tài khoản và lease quota.

---

## 3. Các hướng tiếp cận (Approaches)

### Phương án 1: Studio Hội thoại & Xuất Code 2 Cột (Đã chọn)
- Cột trái: Khung chat tương tác, bộ chọn model động, thanh điều khiển thông số (Temperature, Max Output Tokens, Stream), ô System Prompt.
- Cột phải: Khung hiển thị code mẫu đa ngôn ngữ, tự động cập nhật ngay khi người dùng gõ prompt hoặc chỉnh slider.
- Lý do chọn: Đáp ứng trọn vẹn cả nhu cầu kiểm thử model trực tiếp lẫn nhu cầu copy code mẫu vào tool ngoài.

### Phương án 2: Biểu mẫu Đơn lượt (Single-turn Form)
- Form 1 cột đơn giản, chỉ gửi 1 prompt và in ra JSON. Không hỗ trợ chat stream đa lượt.
- Bị loại bỏ vì trải nghiệm kém và không test được các tình huống hội thoại thực tế.

---

## 4. Chi tiết Kiến trúc & Triển khai

### 4.1 Thư viện sinh Code Samples (`web/src/lib/codeSamples.ts`)
Tạo module thuần túy (pure functions) nhận vào cấu hình:
```typescript
export interface PlaygroundConfig {
  baseUrl: string; // e.g. http://localhost:8045/v1
  apiKey: string;  // Bearer token
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens?: number;
  stream: boolean;
}
```
Và xuất ra các hàm:
- `generateCurl(config: PlaygroundConfig): string`
- `generatePython(config: PlaygroundConfig): string`
- `generateNode(config: PlaygroundConfig): string`
- `generateFetch(config: PlaygroundConfig): string`

### 4.2 Luồng xử lý Chat & Streaming trong `PlaygroundView.tsx`
- Đọc `apiKey` từ `getAdminKey()`.
- Gửi `POST /v1/chat/completions`.
- Nếu `stream: true`:
  - Dùng `ReadableStreamDefaultReader` đọc qua `TextDecoder`.
  - Phân tích cú pháp các dòng `data: {...}` của SSE.
  - Cập nhật message của assistant theo từng chunk text để hiển thị mượt mà.
- Nếu `stream: false`:
  - Đọc toàn bộ JSON response, trích xuất `choices[0].message.content` và `usage`.

### 4.3 Tích hợp Sidebar & App Routing
- `web/src/components/Sidebar.tsx`: Thêm mục `{ id: 'playground', label: t('navigation.playground'), icon: Sparkles }`.
- `web/src/App.tsx`:
  - Cập nhật `TabType = ... | 'playground'`.
  - Render `<PlaygroundView models={models} defaultPort={status?.port} />` khi `activeTab === 'playground'`.

---

## 5. Kế hoạch Kiểm thử (Testing)
1. **Unit test cho Code Generator**: `web/src/lib/codeSamples.spec.ts` kiểm tra tính chính xác của cú pháp code sinh ra cho cả 4 ngôn ngữ, bao gồm trường hợp có/không có system prompt, stream true/false.
2. **i18n Parity Test**: `web/src/lib/i18n-parity.spec.ts` đảm bảo tất cả key dịch mới trong `playground` đồng bộ 100% giữa EN và VI.
3. **Build Check**: `npm --prefix web run build` và `npm run type-check` pass với 0 lỗi.
