import {
  detectAuditOutputModalities,
  mergeAuditOutputModalities,
} from './audit-output-modality';

describe('audit-output-modality', () => {
  describe('mergeAuditOutputModalities', () => {
    it('returns null if both are null', () => {
      expect(mergeAuditOutputModalities(null, null)).toBeNull();
    });

    it('returns non-null side if other is null', () => {
      const mod = { hasImage: true, hasText: false };
      expect(mergeAuditOutputModalities(mod, null)).toEqual(mod);
      expect(mergeAuditOutputModalities(null, mod)).toEqual(mod);
    });

    it('combines boolean flags with OR logic', () => {
      const left = { hasImage: true, hasText: false };
      const right = { hasImage: false, hasText: true };
      expect(mergeAuditOutputModalities(left, right)).toEqual({
        hasImage: true,
        hasText: true,
      });
    });
  });

  describe('detectAuditOutputModalities', () => {
    it('returns null for null, non-objects, or empty objects with unrecognized keys', () => {
      expect(detectAuditOutputModalities(null)).toBeNull();
      expect(detectAuditOutputModalities('plain-string')).toBeNull();
      expect(detectAuditOutputModalities({})).toBeNull();
    });

    it('detects text output in OpenAI choices', () => {
      const payload = {
        choices: [
          {
            message: {
              content: 'Hello from model!',
            },
          },
        ],
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: false,
        hasText: true,
      });
    });

    it('detects image in OpenAI data array (b64_json)', () => {
      const payload = {
        data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }],
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: true,
        hasText: false,
      });
    });

    it('detects text and image in Gemini candidates with inlineData', () => {
      const payload = {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Look at this picture:' },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: 'base64...',
                  },
                },
              ],
            },
          },
        ],
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: true,
        hasText: true,
      });
    });

    it('detects markdown inline data:image in text string', () => {
      const payload = {
        output: ['Here is the plot: ![chart](data:image/png;base64,xxxx)'],
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: true,
        hasText: true,
      });
    });

    it('detects raw data:image string as image only', () => {
      const payload = {
        content: ['data:image/jpeg;base64,/9j/4AAQSkZJRg...'],
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: true,
        hasText: false,
      });
    });

    it('ignores thought blocks, thinking, reasoning, and tool calls', () => {
      const payload = {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'Secret reasoning here' },
                { type: 'thinking', text: 'More thoughts' },
                { type: 'tool_use', name: 'calc' },
                { type: 'function_call', name: 'search' },
              ],
            },
          },
        ],
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: false,
        hasText: false,
      });
    });

    it('handles event streams and message wrappers', () => {
      const streamPayload = {
        events: [
          {
            type: 'content_block_delta',
            delta: { text: 'Streaming token' },
          },
          {
            type: 'image_generation_call',
          },
        ],
      };

      expect(detectAuditOutputModalities(streamPayload)).toEqual({
        hasImage: true,
        hasText: true,
      });
    });

    it('handles response.completed wrapper and message_start', () => {
      const payload = {
        type: 'response.completed',
        response: {
          output: [{ text: 'Done' }],
        },
      };

      expect(detectAuditOutputModalities(payload)).toEqual({
        hasImage: false,
        hasText: true,
      });

      const messageStartPayload = {
        type: 'message_start',
        message: {
          content: [{ text: 'Started' }],
        },
      };

      expect(detectAuditOutputModalities(messageStartPayload)).toEqual({
        hasImage: false,
        hasText: true,
      });
    });
  });
});
