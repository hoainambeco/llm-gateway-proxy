import type { TokenUsageStatsResponse } from '../types';

export function exportTokenAnalyticsCsv(data: TokenUsageStatsResponse) {
  const lines: string[] = [];

  // Title & Period
  lines.push(`Token Usage Analytics Report - Range: ${data.range}`);
  lines.push(`From,${new Date(data.from).toISOString()},To,${new Date(data.to).toISOString()}`);
  lines.push('');

  // Summary Metrics
  lines.push('--- SUMMARY ---');
  lines.push('Total Tokens,Prompt Tokens,Completion Tokens,Total Requests,Successful Requests,Failed Requests,Avg Latency (ms),Estimated Cost (USD)');
  lines.push(
    `${data.summary.totalTokens},${data.summary.promptTokens},${data.summary.completionTokens},${data.summary.totalRequests},${data.summary.successfulRequests},${data.summary.failedRequests},${data.summary.avgLatencyMs},${data.summary.estimatedCostUsd.toFixed(4)}`
  );
  lines.push('');

  // Section 1: Time Series
  lines.push('--- TIME SERIES DATA ---');
  lines.push('Timestamp,Label,Prompt Tokens,Completion Tokens,Total Tokens,Requests,Estimated Cost (USD)');
  for (const pt of data.timeSeries) {
    lines.push(
      `"${new Date(pt.timestamp).toISOString()}","${pt.label}",${pt.promptTokens},${pt.completionTokens},${pt.totalTokens},${pt.requestCount},${pt.estimatedCostUsd.toFixed(4)}`
    );
  }
  lines.push('');

  // Section 2: Model Breakdown
  lines.push('--- MODEL USAGE BREAKDOWN ---');
  lines.push('Model,Prompt Tokens,Completion Tokens,Total Tokens,Requests,Share (%),Estimated Cost (USD)');
  for (const m of data.byModel) {
    lines.push(
      `"${m.model}",${m.promptTokens},${m.completionTokens},${m.totalTokens},${m.requestCount},${m.percentage.toFixed(2)}%,${m.estimatedCostUsd.toFixed(4)}`
    );
  }
  lines.push('');

  // Section 3: API Key Breakdown
  lines.push('--- API KEY BREAKDOWN ---');
  lines.push('API Key ID,Name,Key Preview,Prompt Tokens,Completion Tokens,Total Tokens,Requests,Share (%),Estimated Cost (USD)');
  for (const k of data.byApiKey) {
    lines.push(
      `"${k.apiKeyId}","${k.name}","${k.keyPreview}",${k.promptTokens},${k.completionTokens},${k.totalTokens},${k.requestCount},${k.percentage.toFixed(2)}%,${k.estimatedCostUsd.toFixed(4)}`
    );
  }

  const csvContent = lines.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const filename = `token-analytics-${data.range.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
