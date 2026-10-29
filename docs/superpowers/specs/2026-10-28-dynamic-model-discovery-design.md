# Thiết kế: Danh sách Model 100% Dynamic từ Upstream API (Loại bỏ Hardcode)

Ngày: 2026-10-28
Trạng thái: Đang chờ duyệt
Phạm vi: Backend routing & catalog (`ModelMapping`, `ModelSpecs`, `AccountLease`), Frontend UI (`ModelsView`)

---

## 1. Bối cảnh & Lý do

Hiện tại, hệ thống LLM Gateway Proxy sử dụng một tập hợp model được khai báo cứng (hardcoded) trong mã nguồn (`PUBLIC_SUPPORTED_MODELS` trong `ModelMapping.ts` và `modelSpecsJson` trong `model-specs.ts`).

Hạn chế của thiết kế cũ:
1. **Model lỗi thời vẫn hiển thị**: Nhiều model cũ mà Google hoặc upstream providers đã ngưng hỗ trợ hoặc tài khoản không có quyền truy cập (ví dụ: `gemini-3.6-flash`, `gemini-3.7-flash`, `claude-*-4-6`) vẫn luôn xuất hiện trên Web UI và endpoint `/v1/models`.
2. **Model mới không tự động xuất hiện**: Khi tài khoản người dùng được cấp quyền truy cập các model mới từ upstream (ví dụ: model reasoning mới như Argon, các phiên bản Gemini/Claude mới), hệ thống không tự động công bố ra `/v1/models` nếu không sửa code để thêm vào danh sách hardcode.
3. **Mất tính linh hoạt theo tài khoản**: Danh sách model công bố không phản ánh đúng năng lực thực tế (capabilities & quotas) của các tài khoản đang kết nối.

Mục tiêu: Chuyển toàn bộ danh mục model (`/v1/models`, `/internal/model-specs`, Web UI Models) sang cơ chế **100% Dynamic** lấy từ upstream API (`fetchAvailableModels` của Google và `ProviderModelDiscoveryService` của Anthropic/OpenAI/Copilot). Loại bỏ hoàn toàn việc hardcode danh sách model tĩnh.

---

## 2. Mục tiêu, Non-goals & Anti-goals

### Mục tiêu (Goals)
1. **100% Dynamic Discovery**: Danh sách model trả về tại `/v1/models` và hiển thị trên Web UI chỉ bao gồm các model thực tế được phát hiện từ các tài khoản đang active trong hệ thống (cộng với các custom mapping do người dùng cấu hình qua `routing.json` nếu có).
2. **Loại bỏ hardcode**: Không còn mảng `PUBLIC_SUPPORTED_MODELS` hay danh sách dự phòng tĩnh ép buộc hiển thị các model không tồn tại.
3. **Tự động thích ứng**: Khi tài khoản được cấp model mới (như Argon, Claude mới, Gemini mới), model sẽ tự động xuất hiện sau khi sync quota mà không cần can thiệp code. Khi model bị upstream thu hồi/ngưng hỗ trợ, model sẽ tự động biến mất.
4. **Metadata & Specs động**: Thông số `maxOutputTokens`, `thinkingBudget`, `isThinking`, `displayName` được lấy trực tiếp từ metadata upstream (`CloudQuotaModelInfo`).
5. **Giao diện thân thiện khi trống**: Khi chưa có tài khoản nào được kết nối (hoặc tất cả tài khoản bị disabled/hết hạn), Web UI hiển thị thông báo Empty State rõ ràng hướng dẫn liên kết tài khoản thay vì hiển thị bảng rỗng hoặc lỗi.

### Non-goals
- Không can thiệp vào cơ chế xoay vòng tài khoản hoặc token lease (`AccountLeaseService`).
- Không thay đổi giao thức API chuẩn của OpenAI (`/v1/models`, `/v1/models/:model`).
- Không xoá bỏ tính năng custom alias / custom routing trong `routing.json` (người dùng vẫn có quyền tự tạo alias tùy ý trỏ đến model thực tế).

### Anti-goals
- Không fallback về một danh sách model giả định khi tài khoản trống để tránh gây hiểu lầm cho người dùng rằng hệ thống đang hỗ trợ những model đó.

---

## 3. Các hướng tiếp cận đã xem xét (Approaches)

### Hướng 1: Thuần Dynamic 100% từ API tài khoản (Đã chọn)
- **Cơ chế**:
  - `getAllDynamicModels()` trong `ModelMapping.ts` chỉ thu thập model từ `dynamicModelIds` (được lấy từ `AccountLeaseService.getAllCollectedModels()`) + `customMapping` từ người dùng.
  - Xoá bỏ việc tự động duyệt `PUBLIC_SUPPORTED_MODELS` đưa vào kết quả.
  - Khi chưa có tài khoản nào kết nối: `/v1/models` trả về danh sách rỗng (hoặc chỉ gồm custom mapping), Web UI hiển thị hướng dẫn kết nối tài khoản.
- **Đánh đổi**: Cần có ít nhất một tài khoản hoạt động để có danh sách model.
- **Lý do chọn**: Đáp ứng chính xác yêu cầu của người dùng ("dùng 100% từ API chứ k cần phải hard code"), loại bỏ triệt để model rác/cũ và tự động nhận diện model mới (Argon).

### Hướng 2: Ưu tiên API, fallback danh sách mẫu khi chưa có tài khoản
- **Cơ chế**: Nếu có tài khoản thì lấy 100% API; nếu chưa có tài khoản thì hiển thị danh sách mẫu.
- **Đánh đổi**: Vẫn phải duy trì một danh sách hardcode trong codebase, dễ bị lỗi thời theo thời gian. Người dùng đã từ chối hướng này.

---

## 4. Chi tiết kỹ thuật & Xử lý câu hỏi kiến trúc

### 4.1 Khám phá model đa Provider (Multi-Provider Discovery)
- **Google Cloud Code**: Sử dụng `GoogleAPIService.fetchQuota()` gọi `https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels`. Trả về chi tiết `displayName`, `supportsThinking`, `thinkingBudget`, `maxOutputTokens`.
- **Non-Google Providers (Anthropic, OpenAI, Copilot)**: Đã có sẵn service `ProviderModelDiscoveryService` khám phá qua token runtime. `AccountLeaseService.getAllCollectedModels()` đã tích hợp sẵn cả 2 nguồn này.

### 4.2 Định tuyến tương thích (Routing & Alias Compatibility)
- Khi client (Cursor, Claude Code) gửi request với model chuẩn (ví dụ `claude-3-5-sonnet`, `gpt-4o`):
  - Hệ thống vẫn giữ các rule alias tương thích (`CLAUDE_TO_GEMINI`, `OPENAI_TO_GEMINI`, rule trong `routing.json`) để trỏ request về model upstream phù hợp.
  - Tuy nhiên, danh mục công bố ra `/v1/models` sẽ chỉ chứa các model thực tế mà tài khoản sở hữu.

### 4.3 Sinh biến thể Thinking Budget (-low, -medium, -high)
- Nếu upstream đã định nghĩa sẵn các biến thể riêng (như `claude-sonnet-5-5-high`, `claude-sonnet-5-5-low`), hệ thống giữ nguyên trực tiếp.
- Đối với model có `supportsThinking = true` chưa có suffix variant:
  - Nếu upstream có cung cấp `thinkingBudget`, chia theo các mức tỷ lệ: low (1000/1024), medium (4000/4096), high (`thinkingBudget`).
  - Nếu không có thông số budget từ upstream, dùng mức an toàn: low (1024), medium (4096), high (16384).

### 4.4 Trạng thái khi chưa có tài khoản active
- `GET /v1/models` trả về `{ object: "list", data: [] }` (hoặc chỉ chứa model định nghĩa thủ công trong custom mapping).
- `GET /internal/model-specs` trả về `{ success: true, data: [] }`.
- Web UI `ModelsView` kích hoạt Empty State rõ ràng.

---

## 5. Kế hoạch kiểm thử (Testing Strategy)

1. **Unit tests (`ModelMapping.spec.ts`, `openai-operations.service.spec.ts`)**:
   - Test `getAllDynamicModels` khi truyền vào `dynamicModelIds`: chỉ trả về đúng các model đó + custom mapping, không chứa các model trong mảng tĩnh cũ.
   - Test khi `dynamicModelIds` rỗng: trả về mảng rỗng `[]`.
   - Test tự động mở rộng `-low`, `-medium`, `-high` cho thinking model động.
2. **E2E API (`proxy-openai.e2e-spec.ts`, `models.e2e-spec.ts`)**:
   - Kiểm tra `GET /v1/models` với server có account seed: trả về chính xác danh sách model từ quota seed.
   - Kiểm tra `GET /internal/model-specs`: trả về specs động tương ứng.
3. **TypeScript & Linting**:
   - Chạy `npm run type-check` (0 errors) và `npm run lint` (oxlint sạch).

---

## 6. Việc để Builder quyết định (Left to Builder)
- Tên và nội dung văn bản cụ thể cho Empty State trên giao diện (hỗ trợ song ngữ EN/VI qua i18n context).
- Đảm bảo chuẩn hoá case-insensitive khi so khớp model ID giữa client request và upstream quota.
