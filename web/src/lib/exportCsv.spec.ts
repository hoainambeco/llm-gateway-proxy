import type { TokenUsageStatsResponse } from '../types';
import { exportTokenAnalyticsCsv } from './exportCsv';

describe('exportTokenAnalyticsCsv', () => {
  let originalDocument: typeof globalThis.document | undefined;
  let originalCreateObjectURL: typeof URL.createObjectURL | undefined;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined;

  let createObjectURLMock: jest.Mock<string, [Blob]>;
  let revokeObjectURLMock: jest.Mock<void, [string]>;
  let appendedLink: HTMLAnchorElement | null;

  const recordClick = () => {
    clicks += 1;
  };
  let clicks = 0;

  beforeAll(() => {
    originalDocument = globalThis.document;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
  });

  beforeEach(() => {
    appendedLink = null;
    clicks = 0;
    createObjectURLMock = jest.fn((blob: Blob) => `blob:mock:${blob.size}`);
    revokeObjectURLMock = jest.fn();

    const body: { children: HTMLAnchorElement[] } = { children: [] };
    globalThis.document = {
      createElement: ((tagName: string) => {
        if (tagName !== 'a') {
          throw new Error(`unexpected element request: ${tagName}`);
        }
        return {
          attrs: {} as Record<string, string>,
          clicks: 0,
          setAttribute(name: string, value: string) {
            this.attrs[name] = value;
          },
          getAttribute(name: string) {
            return this.attrs[name];
          },
          click() {
            recordClick();
          },
        };
      }) as unknown as typeof document.createElement,
      body: {
        appendChild(child: HTMLAnchorElement) {
          body.children = [child];
          appendedLink = child;
        },
        removeChild(child: HTMLAnchorElement) {
          body.children = body.children.filter((entry) => entry !== child);
        },
      } as unknown as HTMLElement,
    } as unknown as Document;

    URL.createObjectURL = createObjectURLMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURLMock as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete (globalThis as { document?: Document }).document;
    }
    if (originalCreateObjectURL) {
      URL.createObjectURL = originalCreateObjectURL;
    } else {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
    }
    if (originalRevokeObjectURL) {
      URL.revokeObjectURL = originalRevokeObjectURL;
    } else {
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
    }
  });

  function buildStats(): TokenUsageStatsResponse {
    return {
      range: 'SEVEN_DAYS',
      from: Date.UTC(2026, 9, 1, 0, 0, 0),
      to: Date.UTC(2026, 9, 8, 0, 0, 0),
      summary: {
        totalTokens: 1000,
        promptTokens: 400,
        completionTokens: 600,
        totalRequests: 10,
        successfulRequests: 9,
        failedRequests: 1,
        avgLatencyMs: 250.5,
        estimatedCostUsd: 1.5,
      },
      timeSeries: [
        {
          timestamp: Date.UTC(2026, 9, 1),
          label: 'Day 1',
          promptTokens: 100,
          completionTokens: 150,
          totalTokens: 250,
          requestCount: 3,
          estimatedCostUsd: 0.5,
        },
        {
          timestamp: Date.UTC(2026, 9, 2),
          label: 'Day 2',
          promptTokens: 300,
          completionTokens: 450,
          totalTokens: 750,
          requestCount: 7,
          estimatedCostUsd: 1.0,
        },
      ],
      byModel: [
        {
          model: 'gemini-2.0-flash',
          promptTokens: 200,
          completionTokens: 300,
          totalTokens: 500,
          requestCount: 5,
          percentage: 50,
          estimatedCostUsd: 0.75,
        },
      ],
      byApiKey: [
        {
          apiKeyId: 'key-1',
          name: 'Primary key',
          keyPreview: 'goog-***abcd',
          promptTokens: 400,
          completionTokens: 600,
          totalTokens: 1000,
          requestCount: 10,
          percentage: 100,
          estimatedCostUsd: 1.5,
        },
      ],
      topModels: [],
    };
  }

  async function extractCsvFromBlob(): Promise<string> {
    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const blob = createObjectURLMock.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv;charset=utf-8;');
    return blob.text();
  }

  it('builds a csv blob with a title line and the period row', async () => {
    exportTokenAnalyticsCsv(buildStats());

    const csv = await extractCsvFromBlob();
    const lines = csv.split('\n');

    expect(lines[0]).toBe('Token Usage Analytics Report - Range: SEVEN_DAYS');
    expect(lines[1]).toBe(
      'From,2026-10-01T00:00:00.000Z,To,2026-10-08T00:00:00.000Z',
    );
    expect(lines[2]).toBe('');
  });

  const countDataRows = (lines: string[], sectionHeader: string) => {
    // Skip the section header and its column header line, then count rows
    // until the next blank line or section marker.
    let count = 0;
    for (let i = lines.indexOf(sectionHeader) + 2; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === '' || line.startsWith('---')) {
        break;
      }
      count += 1;
    }
    return count;
  };

  it('renders all three sections and row counts matching the input', async () => {
    exportTokenAnalyticsCsv(buildStats());

    const csv = await extractCsvFromBlob();
    const lines = csv.split('\n');

    expect(lines).toContain('--- SUMMARY ---');
    expect(lines).toContain('--- TIME SERIES DATA ---');
    expect(lines).toContain('--- MODEL USAGE BREAKDOWN ---');
    expect(lines).toContain('--- API KEY BREAKDOWN ---');

    expect(countDataRows(lines, '--- TIME SERIES DATA ---')).toBe(2);
    expect(countDataRows(lines, '--- MODEL USAGE BREAKDOWN ---')).toBe(1);
    expect(countDataRows(lines, '--- API KEY BREAKDOWN ---')).toBe(1);
  });

  it('formats every cost value with exactly four decimal places', async () => {
    exportTokenAnalyticsCsv(buildStats());

    const csv = await extractCsvFromBlob();
    const lines = csv.split('\n');

    const summaryLine = lines.find((line) => line.startsWith('1000,400,600'));
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toContain('1.5000');

    expect(countDataRows(lines, '--- TIME SERIES DATA ---')).toBe(2);
    const timeSeriesLines = lines.filter((line) => line.startsWith('"2026-10-0'));
    expect(timeSeriesLines).toHaveLength(2);
    expect(timeSeriesLines[0]).toContain(',0.5000');
    expect(timeSeriesLines[1]).toContain(',1.0000');

    const byModelLine = lines.find((line) => line.startsWith('"gemini-2.0-flash"'));
    expect(byModelLine).toBeDefined();
    expect(byModelLine).toContain(',0.7500');

    const byApiKeyLine = lines.find((line) => line.startsWith('"key-1"'));
    expect(byApiKeyLine).toBeDefined();
    expect(byApiKeyLine).toContain(',1.5000');
  });

  it('rounds cost values to four decimal places', async () => {
    const stats = buildStats();
    stats.summary.estimatedCostUsd = 2.34999;
    stats.timeSeries[1].estimatedCostUsd = 0.005;

    exportTokenAnalyticsCsv(stats);

    const csv = await extractCsvFromBlob();
    const lines = csv.split('\n');

    const summaryLine = lines.find((line) => line.startsWith('1000,400,600'));
    expect(summaryLine).toContain('2.3500');
    const secondPointLine = lines.find((line) => line.startsWith('"2026-10-02'));
    expect(secondPointLine).toContain(',0.0050');
  });

  it('triggers a single download via an anchor appended to document.body and revokes the url', () => {
    exportTokenAnalyticsCsv(buildStats());

    expect(appendedLink).not.toBeNull();
    expect(clicks).toBe(1);
    expect(appendedLink?.getAttribute('href')).toMatch(/^blob:mock:\d+$/);
    expect(appendedLink?.getAttribute('download')).toBe(
      `token-analytics-seven_days-${new Date().toISOString().slice(0, 10)}.csv`,
    );
    expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith(
      createObjectURLMock.mock.results[0]?.value,
    );
  });

  it('handles empty datasets with headers intact', async () => {
    const stats = buildStats();
    stats.timeSeries = [];
    stats.byModel = [];
    stats.byApiKey = [];

    exportTokenAnalyticsCsv(stats);

    const csv = await extractCsvFromBlob();
    expect(csv).toContain('--- TIME SERIES DATA ---');
    expect(csv).toContain('Timestamp,Label,Prompt Tokens,Completion Tokens,Total Tokens,Requests,Estimated Cost (USD)');
    expect(csv).toContain('--- MODEL USAGE BREAKDOWN ---');
    expect(csv).toContain('--- API KEY BREAKDOWN ---');
  });
});
