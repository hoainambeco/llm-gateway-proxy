import { expect, loginAsAdmin, test } from './fixtures';

test.describe('Playground Studio Deep Interactions', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await loginAsAdmin(page);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /playground/i })
      .click();
  });

  test('executes full interactive chat workflow with mocked streaming and parameter adjustments', async ({
    page,
  }) => {
    // 1. Verify main sections are loaded
    await expect(
      page.getByRole('heading', { name: /model playground/i }).first(),
    ).toBeVisible();

    // 2. Adjust temperature slider to 0.2 (more precise)
    const tempSlider = page.locator('input[type="range"]').first();
    await expect(tempSlider).toBeVisible();
    await tempSlider.fill('0.2');

    // 3. Open System Prompt section and enter a custom system prompt
    const systemPromptBtn = page.getByRole('button', { name: /system prompt/i });
    await systemPromptBtn.click();
    const systemPromptTextarea = page.locator('textarea').first();
    await expect(systemPromptTextarea).toBeVisible();
    await systemPromptTextarea.fill('You are a specialized TypeScript software architect.');

    // 4. Verify code sample updates immediately to include the system prompt and new temperature
    const codeBlock = page.locator('pre').last();
    await expect(codeBlock).toContainText('You are a specialized TypeScript software architect');
    await expect(codeBlock).toContainText('"temperature": 0.2');

    // 5. Mock the /v1/chat/completions endpoint for real user interaction
    await page.route('**/v1/chat/completions', async (route) => {
      const sseStream =
        'data: {"id":"chatcmpl-test","choices":[{"delta":{"content":"Hello! How can I assist you with TypeScript architecture today?"}}]}\n\n' +
        'data: {"id":"chatcmpl-test","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":10,"total_tokens":22}}\n\n' +
        'data: [DONE]\n\n';

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseStream,
      });
    });

    // 6. Type a prompt into the message box
    const messageInput = page.getByRole('textbox', {
      name: /type your prompt|nhập/i,
    });
    await expect(messageInput).toBeVisible();
    await messageInput.fill('Design a clean architecture repository pattern.');

    // 7. Click the Send button
    const sendButton = page.getByRole('button', { name: /send|gửi/i });
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // 8. Verify the User message is displayed in the chat transcript
    await expect(
      page.getByText('Design a clean architecture repository pattern.', { exact: true }),
    ).toBeVisible();

    // 9. Verify the Assistant response appears in the chat transcript
    await expect(
      page.getByText('Hello! How can I assist you with TypeScript architecture today?', { exact: true }),
    ).toBeVisible();

    // 10. Switch code language tabs and verify copy code action
    const pythonTab = page.getByRole('button', { name: /python/i });
    await pythonTab.click();
    await expect(codeBlock).toContainText('from openai import OpenAI');

    // 11. Click "Copy Code" button and assert toast confirmation appears
    const copyButton = page.getByRole('button', { name: /copy code|sao chép/i });
    await copyButton.click();
    await expect(
      page.getByText(/copied|đã sao chép/i).first(),
    ).toBeVisible();

    // 12. Clear the conversation and verify transcript is reset
    const clearBtn = page.getByRole('button', { name: /clear chat|xóa/i });
    await clearBtn.click();
    await expect(
      page.getByText('Hello! How can I assist you with TypeScript architecture today?', { exact: true }),
    ).not.toBeVisible();
  });
});
