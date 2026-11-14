import { useState } from 'react';

export interface ChartDatum {
  label: string;
  value: number;
  secondaryValue?: number;
  source?: string;
}

interface TrendLineChartProps {
  data: ChartDatum[];
  unit: string;
  secondaryUnit?: string;
  primaryLabel: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
  height?: number;
}

/**
 * Accessible, color-blind-safe SVG line chart with interactive crosshair hover tooltip.
 * Uses distinct stroke styles (solid vs dashed) when rendering a secondary series.
 */
export function TrendLineChart({
  data,
  unit,
  secondaryUnit,
  primaryLabel,
  secondaryLabel,
  primaryColor = '#69A3B5',
  secondaryColor = '#F59E0B',
  height = 220,
}: TrendLineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-[20px] border border-dashed border-slate-300 dark:border-white/[0.1] text-sm text-slate-500 dark:text-white/45">
        No telemetry recorded in this time range.
      </div>
    );
  }

  const width = 680;
  const padL = 46;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const vals = data.map((d) => d.value);
  const rawMin = Math.min(...vals);
  const rawMax = Math.max(...vals);
  const span = Math.max(rawMax - rawMin, 1);
  const minVal = rawMin - span * 0.12;
  const maxVal = rawMax + span * 0.12;

  const getX = (i: number) => (data.length === 1 ? padL + innerW / 2 : padL + (i / (data.length - 1)) * innerW);
  const getY = (v: number) => padT + innerH - ((v - minVal) / (maxVal - minVal)) * innerH;

  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${getY(d.value).toFixed(1)}`)
    .join(' ');

  const areaD = `${pathD} L ${getX(data.length - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${getX(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`;

  const secVals = data.map((d) => d.secondaryValue).filter((v): v is number => typeof v === 'number');
  const hasSecondary = secVals.length === data.length && secVals.length > 0;
  let secPathD = '';
  if (hasSecondary) {
    const sMin = Math.min(...secVals) - 2;
    const sMax = Math.max(...secVals) + 2;
    const sSpan = Math.max(sMax - sMin, 1);
    secPathD = data
      .map((d, i) => {
        const y = padT + innerH - (((d.secondaryValue ?? sMin) - sMin) / sSpan) * innerH;
        return `${i === 0 ? 'M' : 'L'} ${getX(i).toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  const ticks = [0, 0.5, 1].map((t) => {
    const val = minVal + (maxVal - minVal) * (1 - t);
    return { y: padT + t * innerH, label: val >= 100 ? Math.round(val).toString() : val.toFixed(1) };
  });

  const active = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-[#888888]">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
            <span className="inline-block h-0.5 w-4" style={{ backgroundColor: primaryColor }} />
            {primaryLabel}
          </span>
          {hasSecondary && secondaryLabel && (
            <span className="inline-flex items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
              <span
                className="inline-block h-0.5 w-4 border-t-2 border-dashed"
                style={{ borderColor: secondaryColor }}
              />
              {secondaryLabel}
            </span>
          )}
        </div>
        {active && (
          <div className="font-mono tabular-nums text-slate-900 dark:text-[#cde0e6]">
            {active.label} · {active.value} {unit}
            {typeof active.secondaryValue === 'number' && secondaryUnit
              ? ` · ${active.secondaryValue} ${secondaryUnit}`
              : ''}
            {active.source ? ` · ${active.source}` : ''}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full overflow-visible select-none cursor-crosshair"
        onMouseLeave={() => setHoverIdx(null)}
        role="img"
        aria-label={`${primaryLabel} trend chart`}
      >
        <defs>
          <linearGradient id={`grad-${primaryLabel.replace(/\s+/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.24" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {ticks.map((tick, idx) => (
          <g key={idx}>
            <line
              x1={padL}
              y1={tick.y}
              x2={width - padR}
              y2={tick.y}
              className="stroke-slate-200 dark:stroke-white/[0.08]"
              strokeWidth="1"
            />
            <text
              x={padL - 8}
              y={tick.y + 4}
              textAnchor="end"
              className="fill-slate-500 dark:fill-white/40 text-[11px] font-mono tabular-nums"
            >
              {tick.label}
            </text>
          </g>
        ))}

        <path d={areaD} fill={`url(#grad-${primaryLabel.replace(/\s+/g, '')})`} />
        <path d={pathD} fill="none" stroke={primaryColor} strokeWidth="2.25" strokeLinejoin="round" />

        {hasSecondary && (
          <path
            d={secPathD}
            fill="none"
            stroke={secondaryColor}
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
        )}

        {hoverIdx !== null && (
          <g>
            <line
              x1={getX(hoverIdx)}
              y1={padT}
              x2={getX(hoverIdx)}
              y2={padT + innerH}
              className="stroke-slate-400 dark:stroke-[#555555]"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <circle
              cx={getX(hoverIdx)}
              cy={getY(data[hoverIdx].value)}
              r="4.5"
              fill={primaryColor}
              className="stroke-[#111111]"
              strokeWidth="2"
            />
          </g>
        )}

        {data.map((d, i) => {
          const colW = innerW / Math.max(data.length, 1);
          return (
            <rect
              key={d.label + i}
              x={getX(i) - colW / 2}
              y={padT}
              width={colW}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}

        {[0, Math.floor((data.length - 1) / 2), data.length - 1]
          .filter((v, idx, arr) => arr.indexOf(v) === idx)
          .map((i) => (
            <text
              key={i}
              x={getX(i)}
              y={height - 6}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              className="fill-slate-500 dark:fill-white/40 text-[11px] font-mono tabular-nums"
            >
              {data[i].label}
            </text>
          ))}
      </svg>
    </div>
  );
}

export interface SleepStageBar {
  date: string;
  deep: number;
  rem: number;
  light: number;
  awake: number;
}

/**
 * Color-blind-safe Sleep Stages stacked bar chart (Deep, REM, Light, Awake).
 */
export function SleepStagesChart({ nights }: { nights: SleepStageBar[] }) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (nights.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-[20px] border border-dashed border-slate-300 dark:border-white/[0.1] text-sm text-slate-500 dark:text-white/45">
        No sleep stage sessions synced yet.
      </div>
    );
  }

  const maxTotal = Math.max(...nights.map((n) => n.deep + n.rem + n.light + n.awake), 480);
  const active = selectedIdx !== null ? nights[selectedIdx] : nights[nights.length - 1];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-[#888888]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#056583]" /> Deep
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#69A3B5]" /> REM
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#4A5568]" /> Light
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#F59E0B]" /> Awake
          </span>
        </div>
        {active && (
          <div className="font-mono tabular-nums text-slate-800 dark:text-[#cde0e6]">
            {active.date} · Deep {active.deep}m · REM {active.rem}m · Light {active.light}m · Awake {active.awake}m
          </div>
        )}
      </div>

      <div className="flex h-44 items-end gap-1.5 border-b border-slate-200 dark:border-[#333333] pb-2">
        {nights.map((n, idx) => {
          const total = n.deep + n.rem + n.light + n.awake;
          const heightPct = Math.max(8, (total / maxTotal) * 100);
          return (
            <button
              key={n.date}
              type="button"
              onClick={() => setSelectedIdx(idx)}
              onMouseEnter={() => setSelectedIdx(idx)}
              className="group flex h-full flex-1 flex-col justify-end focus:outline-none"
              aria-label={`Sleep on ${n.date}: ${Math.round((total / 60) * 10) / 10} hours`}
            >
              <div
                className="flex w-full flex-col overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-90"
                style={{ height: `${heightPct}%` }}
              >
                <div style={{ flex: n.awake }} className="bg-[#F59E0B]" />
                <div style={{ flex: n.light }} className="bg-[#4A5568]" />
                <div style={{ flex: n.rem }} className="bg-[#69A3B5]" />
                <div style={{ flex: n.deep }} className="bg-[#056583]" />
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-[#666666]">
        <span>{nights[0]?.date}</span>
        <span>{nights[nights.length - 1]?.date}</span>
      </div>
    </div>
  );
}
