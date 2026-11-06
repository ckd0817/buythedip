import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, DataZoomComponent, AxisPointerComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartPoint } from './types';
import { indexScore } from './indexScore';
import { rangeFromPercent } from './timeRange';
import { useScrollReveal } from './useScrollReveal';

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, AxisPointerComponent, MarkLineComponent, CanvasRenderer]);
export type Panel = Exclude<keyof ChartPoint, 'date'>;
const colors: Record<Panel, [string, string]> = {
  price: ['#0877f9', '#6eb8ff'], drawdown: ['#c98523', '#e7b763'], index: ['#6572cf', '#a4a1ff'],
  rsi: ['#278a7d', '#65c7b6'], ma: ['#9a649a', '#d7a2cf'], volatility: ['#c98523', '#e7b763'],
};

export default function HistoryPlot({ points, panel, title, dark, range, onRangeChange, pricePrefix = '$', priceDigits = 2, showTitle = true }: {
  points: ChartPoint[]; panel: Panel; title: string; dark: boolean;
  range: [number, number]; onRangeChange: (range: [number, number]) => void; pricePrefix?: string; priceDigits?: number; showTitle?: boolean;
}) {
  const reveal = useScrollReveal<HTMLElement>();
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.EChartsType | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    if (!container.current || !points.length) return;
    const chart = echarts.init(container.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const color = colors[panel][dark ? 1 : 0];
    const text = dark ? '#a1a4af' : '#858991';
    const isPercent = panel === 'drawdown' || panel === 'ma';
    const bounded = panel === 'index' || panel === 'rsi';
    const reference = panel === 'rsi' ? [30, 70] : panel === 'ma' ? [0] : [];
    chart.setOption({
      animation: false,
      textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
      grid: { left: 58, right: 14, top: 12, bottom: 30 },
      tooltip: {
        trigger: 'axis', confine: true, backgroundColor: dark ? '#25262b' : '#fff', borderWidth: 0,
        padding: [12, 16], textStyle: { color: dark ? '#f1f1f3' : '#202125', fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: dark ? '#8a8d99' : '#b1b4bb', type: 'dashed' } },
      },
      xAxis: {
        type: 'category', data: points.map(p => p.date), boundaryGap: false,
        axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
        axisLabel: { color: text, fontSize: 11, hideOverlap: true, margin: 12,
          formatter: (v: string) => (rangeRef.current[1] - rangeRef.current[0] <= 260 ? v.slice(5) : v.slice(0, 7)).replace('-', '/') },
        axisPointer: { label: { show: true, backgroundColor: dark ? '#4b4e58' : '#797e89' } },
      },
      yAxis: {
        type: 'value', scale: panel === 'price' || panel === 'ma',
        min: bounded || panel === 'volatility' ? 0 : undefined,
        max: bounded ? 100 : panel === 'drawdown' ? 0 : undefined,
        interval: bounded ? 25 : undefined,
        axisLabel: { color: text, fontSize: 11, margin: 12, hideOverlap: true,
          formatter: (v: number) => panel === 'price' ? `${pricePrefix}${v.toLocaleString('en-US')}` : isPercent ? `${v}%` : `${v}` },
        splitNumber: 4, splitLine: { lineStyle: { color: dark ? '#ffffff0b' : '#00000009' } },
        axisLine: { show: false }, axisTick: { show: false },
      },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'filter', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false,
        startValue: rangeRef.current[0], endValue: rangeRef.current[1], minValueSpan: 1 }],
      series: [{
        name: title, type: 'line', data: points.map(p => panel === 'index' ? indexScore(p.index) : p[panel]),
        showSymbol: false, connectNulls: false, sampling: 'lttb',
        lineStyle: { color, width: 1.7 }, itemStyle: { color },
        areaStyle: ['drawdown', 'index', 'ma'].includes(panel) ? { color, opacity: .06 } : undefined,
        tooltip: { valueFormatter: (v: number | null) => v == null ? '—' : panel === 'index' ? v.toFixed(1) : `${panel === 'price' ? pricePrefix : ''}${v.toLocaleString('en-US', { maximumFractionDigits: panel === 'price' ? priceDigits : 2 })}${isPercent ? '%' : ''}` },
        markLine: reference.length ? { silent: true, symbol: 'none', label: { show: false },
          lineStyle: { color: dark ? '#ffffff35' : '#00000028', type: 'dashed', width: 1 }, data: reference.map(value => ({ yAxis: value })) } : undefined,
        emphasis: { disabled: true },
      }],
    });
    chart.on('datazoom', (event: unknown) => {
      const data = event as { start?: number; end?: number; batch?: { start?: number; end?: number }[] };
      const zoom = data.batch?.[0] ?? data;
      if (zoom.start != null && zoom.end != null) onRangeChange(rangeFromPercent(points.length, zoom.start, zoom.end));
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); chartRef.current = null; };
  }, [points, panel, title, dark, onRangeChange, pricePrefix, priceDigits]);

  useEffect(() => {
    chartRef.current?.dispatchAction({ type: 'dataZoom', startValue: range[0], endValue: range[1] }, { silent: true });
  }, [range[0], range[1]]);

  return <article ref={reveal.ref} className={`metric-plot ${reveal.className}${panel === 'index' ? ' index-plot' : ''}`}>
    {showTitle && <h3>{title}</h3>}
    <div className="plot-canvas" ref={container} role="img" aria-label={title} />
  </article>;
}
