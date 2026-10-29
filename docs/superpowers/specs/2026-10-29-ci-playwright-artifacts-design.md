# Thiết kế: Cấu hình Playwright CI/CD Artifacts & Graceful Failure

Ngày: 2026-10-29
Trạng thái: Đang chờ duyệt
Phạm vi: `.github/workflows/ci.yml`, `playwright.config.ts`

---

## 1. Bối cảnh & Mục tiêu

Khi chạy Playwright E2E tests trên GitHub Actions CI/CD:
- Hiện tại nếu test fail, toàn bộ pipeline CI/CD sẽ bị đánh trượt (đỏ pipeline), cản trở việc release hoặc kiểm tra các bước build khác.
- Việc thiếu file Trace Viewer hoặc chỉ lưu khi retry khiến việc debug các test trượt ở lần chạy đầu tiên gặp khó khăn.
- Cần thu thập đầy đủ báo cáo HTML và file Trace chỉ cho các test case bị fail (để tối ưu dung lượng lưu trữ artifact).

### Mục tiêu (Goals):
1. **Không làm chết CI/CD**: Khi có test Playwright bị fail, pipeline CI vẫn tiếp tục và kết thúc thành công (`continue-on-error: true`), step test hiển thị cảnh báo (warning) để dev chú ý.
2. **HTML Report**: Luôn luôn được lưu trữ và đính kèm vào GitHub Actions Artifacts dù test pass hay fail (`if: always()`).
3. **Trace Viewer chỉ cho các test bị fail**: Cấu hình `trace: 'retain-on-failure'` để Playwright chỉ ghi và lưu file `trace.zip` cho các test case trượt.
4. **Unified Artifact**: Đóng gói cả `playwright-report/` (chứa `index.html`) và `test-results/` (chứa các file trace zip của các test fail) vào cùng một artifact `playwright-report-and-traces`.

### Non-goals:
- Không thay đổi logic test bên trong các file spec Playwright (`test/playwright/*.spec.ts`).
- Không xuất bản trực tiếp lên GitHub Pages (lưu trữ dưới dạng GitHub Actions Artifacts theo yêu cầu).

---

## 2. Các phương án & Lựa chọn

### Phương án 1: Step-level Graceful Failure & Unified Artifact Bundle (ĐÃ CHỌN)
- `playwright.config.ts`: Đặt `trace: 'retain-on-failure'`.
- `.github/workflows/ci.yml`: Thêm `continue-on-error: true` vào step test và `if: always()` cho step upload artifact chứa cả `playwright-report/` và `test-results/`.
- **Ưu điểm**: Đạt 100% đúng 3 yêu cầu (có report, có trace cho test fail, không chết CI), chỉ cần tải 1 file artifact zip duy nhất là có đủ mọi dữ liệu debug.

### Phương án 2: Tách thành 2 Artifacts riêng biệt
- Tách thành 2 bước upload riêng: 1 artifact chỉ chứa HTML report và 1 artifact chỉ chứa traces.
- **Bị loại bỏ**: Gây phiền phức vì phải tải 2 file riêng khi cần đối chiếu kết quả.

---

## 3. Chi tiết triển khai

### 3.1 Cập nhật `playwright.config.ts`
```typescript
use: {
  baseURL: 'http://127.0.0.1:8046',
  timezoneId: 'UTC',
  trace: 'retain-on-failure',        // Chỉ lưu trace khi test fail
  screenshot: 'only-on-failure',    // Chụp màn hình khoảnh khắc fail
  video: 'retain-on-failure',        // Quay video khi test fail
}
```

### 3.2 Cập nhật `.github/workflows/ci.yml`
```yaml
  playwright:
    name: Playwright
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm --prefix web install
      - run: npx playwright install --with-deps chromium
      - name: Run Playwright Tests
        run: npm run test:playwright
        continue-on-error: true
      - name: Upload Playwright Report & Traces
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-and-traces
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

---

## 4. Kế hoạch Kiểm thử & Xác thực
1. Kiểm tra cú pháp YAML của `.github/workflows/ci.yml`.
2. Chạy thử nghiệm cục bộ Playwright config để đảm bảo cấu hình `retain-on-failure` hợp lệ và không gây lỗi cú pháp TypeScript: `npm run type-check`.
3. Kiểm tra artifact path và các file được sinh ra khi chạy test.
