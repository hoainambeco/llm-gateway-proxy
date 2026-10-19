import React, { useState, useMemo } from 'react';
import type { TimeSeriesDataPoint } from '../../types';

interface TimeSeriesChartProps {
  data: TimeSeriesDataPoint[];
  metric?: 'tokens' | 'requests';
  onMetricChange?: (metric: 'tokens' | 'requests') => void;
  height?: number;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toLocaleString();
}

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  data,
  metric: externalMetric,
  onMetricChange,
  height = 260,
}) => {
  const [internalMetric, setInternalMetric] = useState<'tokens' | 'requests'>('tokens');
  const metric = externalMetric ?? internalMetric;
  const setMetric = onMetricChange ?? setInternalMetric;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // SVG coordinate configuration
  const padding = { top: 20, right: 24, bottom: 36, left: 54 };
  const width = 800; // virtual SVG units
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map((d) => ({
      val: metric === 'tokens' ? d.totalTokens : d.requestCount,
      ...d,
    }));
  }, [data, metric]);

  const maxVal = useMemo(() => {
    if (points.length === 0) return 10;
    const m = Math.max(...points.map((p) => p.val));
    return m <= 0 ? 10 : Math.ceil(m * 1.15);
  }, [points]);

  // Compute SVG coordinates
  const coords = useMemo(() => {
    if (points.length === 0) return [];
    const step = points.length > 1 ? chartWidth / (points.length - 1) : 0;
    return points.map((p, i) => {
      const x = padding.left + (points.length === 1 ? chartWidth / 2 : i * step);
      const ratio = p.val / maxVal;
      const y = padding.top + (chartHeight - ratio * chartHeight);
      return { x, y, data: p };
    });
  }, [points, chartWidth, chartHeight, padding.left, padding.top, maxVal]);

  const linePath = useMemo(() => {
    if (coords.length === 0) return '';
    return coords.reduce((acc, curr, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${curr.x.toFixed(1)},${curr.y.toFixed(1)}`, '');
  }, [coords]);

  const areaPath = useMemo(() => {
    if (coords.length === 0) return '';
    const bottomY = padding.top + chartHeight;
    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    return `${linePath} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;
  }, [linePath, coords, padding.top, chartHeight]);

  // Y-axis grid levels (4 ticks)
  const yTicks = useMemo(() => {
    return [0, 0.33, 0.66, 1].map((ratio) => {
      const val = Math.round(maxVal * ratio);
      const y = padding.top + (chartHeight - ratio * chartHeight);
      return { val, y };
    });
  }, [maxVal, chartHeight, padding.top]);

  // X-axis sampled labels (max 6 labels)
  const xLabels = useMemo(() => {
    if (coords.length === 0) return [];
    const step = Math.max(1, Math.floor(coords.length / 6));
    const labels: Array<{ label: string; x: number }> = [];
    for (let i = 0; i < coords.length; i += step) {
      labels.push({ label: coords[i].data.label, x: coords[i].x });
    }
    // Always include the last one
    if (labels[labels.length - 1]?.x !== coords[coords.length - 1].x) {
      labels.push({
        label: coords[coords.length - 1].data.label,
        x: coords[coords.length - 1].x,
      });
    }
    return labels;
  }, [coords]);

  const activePoint = hoverIndex !== null && coords[hoverIndex] ? coords[hoverIndex] : null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 shadow-sm">
      {/* Header with metric switcher */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            {metric === 'tokens' ? 'Token Usage Over Time' : 'Request Volume Over Time'}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {metric === 'tokens'
              ? 'Aggregated prompt and completion tokens'
              : 'Number of processed requests'}
          </p>
        </div>

        <div className="flex bg-zinc-800/80 p-0.5 rounded-lg border border-zinc-700/60 text-xs">
          <button
            type="button"
            onClick={() => setMetric('tokens')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              metric === 'tokens'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Tokens
          </button>
          <button
            type="button"
            onClick={() => setMetric('requests')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              metric === 'requests'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Requests
          </button>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full select-none" style={{ height: `${height}px` }}>
        {data.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 text-sm">
            <p>No activity recorded in this period</p>
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-full overflow-visible"
              preserveAspectRatio="none"
              onMouseLeave={() => setHoverIndex(null)}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const mouseX = ((e.clientX - rect.left) / rect.width) * width;
                let closestIdx = 0;
                let minDist = Infinity;
                coords.forEach((c, idx) => {
                  const dist = Math.abs(c.x - mouseX);
                  if (dist < minDist) {
                    minDist = dist;
                    closestIdx = idx;
                  }
                });
                setHoverIndex(closestIdx);
              }}
            >
              <defs>
                <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                  <stop offset="85%" stopColor="#10b981" stopOpacity="0.02" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Grid Lines and Y-Axis Labels */}
              {yTicks.map((tick) => (
                <g key={tick.y}>
                  <line
                    x1={padding.left}
                    y1={tick.y}
                    x2={width - padding.right}
                    y2={tick.y}
                    stroke="#27272a"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={padding.left - 10}
                    y={tick.y + 4}
                    textAnchor="end"
                    fill="#71717a"
                    fontSize="11"
                    fontFamily="monospace"
                  >
                    {formatNumber(tick.val)}
                  </text>
                </g>
              ))}

              {/* Area Fill */}
              {areaPath && <path d={areaPath} fill="url(#chartGradient)" />}

              {/* Main Line */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* X-Axis Labels */}
              {xLabels.map((lbl, i) => (
                <text
                  key={i}
                  x={lbl.x}
                  y={height - 12}
                  textAnchor="middle"
                  fill="#71717a"
                  fontSize="11"
                  fontFamily="sans-serif"
                >
                  {lbl.label}
                </text>
              ))}

              {/* Crosshair guide line and point */}
              {activePoint && (
                <g>
                  <line
                    x1={activePoint.x}
                    y1={padding.top}
                    x2={activePoint.x}
                    y2={padding.top + chartHeight}
                    stroke="#34d399"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={activePoint.x}
                    cy={activePoint.y}
                    r="5"
                    fill="#10b981"
                    stroke="#09090b"
                    strokeWidth="2"
                  />
                </g>
              )}
            </svg>

            {/* Hover Tooltip Overlay */}
            {activePoint && (() => {
              const isNearTop = activePoint.y < 95;
              const xPercent = (activePoint.x / width) * 100;

              let xAlignClass = '-translate-x-1/2';
              if (xPercent > 75) {
                xAlignClass = '-translate-x-full';
              } else if (xPercent < 25) {
                xAlignClass = 'translate-x-0';
              }

              const yAlignClass = isNearTop ? 'translate-y-3' : '-translate-y-full -translate-y-2';

              return (
                <div
                  className={`absolute z-30 pointer-events-none transform ${xAlignClass} ${yAlignClass} transition-all duration-75`}
                  style={{
                    left: `${xPercent}%`,
                    top: `${(activePoint.y / height) * 100}%`,
                  }}
                >
                  <div className="bg-zinc-950/95 border border-zinc-700/80 rounded-lg p-3 shadow-2xl backdrop-blur-md text-xs min-w-[180px] max-w-[240px] space-y-1.5">
                    <div className="font-semibold text-zinc-200 border-b border-zinc-800 pb-1 flex justify-between items-center">
                      <span>{activePoint.data.label}</span>
                      <span className="text-[10px] text-zinc-400 font-normal">
                        {new Date(activePoint.data.timestamp).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-zinc-300">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          Total Tokens:
                        </span>
                        <span className="font-mono font-medium text-emerald-400">
                          {activePoint.data.totalTokens.toLocaleString()}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-zinc-400 text-[11px] pl-3.5">
                        <span>Prompt:</span>
                        <span className="font-mono">{activePoint.data.promptTokens.toLocaleString()}</span>
                      </div>

                      <div className="flex justify-between items-center text-zinc-400 text-[11px] pl-3.5">
                        <span>Completion:</span>
                        <span className="font-mono">{activePoint.data.completionTokens.toLocaleString()}</span>
                      </div>

                      <div className="flex justify-between items-center text-zinc-300 pt-1 border-t border-zinc-800/80">
                        <span>Requests:</span>
                        <span className="font-mono font-medium text-zinc-200">
                          {activePoint.data.requestCount.toLocaleString()}
                        </span>
                      </div>

                      {activePoint.data.estimatedCostUsd > 0 && (
                        <div className="flex justify-between items-center text-zinc-300">
                          <span>Est. Cost:</span>
                          <span className="font-mono font-medium text-amber-400">
                            ${activePoint.data.estimatedCostUsd.toFixed(4)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
};
