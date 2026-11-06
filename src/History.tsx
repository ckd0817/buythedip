import { useCallback, useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { GridComponent, DataZoomComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartPoint, VolatilitySymbol } from './types';
import { messages, type Language } from './i18n';
import { rangeForMonths, rangeFromPercent, rangePresets, hasFullYears } from './timeRange';
import HistoryPlot, { type Panel } from './HistoryPlot';
import { useScrollReveal } from './useScrollReveal';

echarts.use([GridComponent, DataZoomComponent, CanvasRenderer]);
type Props = { points: ChartPoint[]; symbol: string; dark: boolean; volatilitySymbol: VolatilitySymbol | null; isIndex: boolean; isFund?: boolean; pricePrefix: string; language: Language };
const allPanels: Panel[] = ['index', 'price', 'drawdown', 'rsi', 'ma', 'volatility'];
type ZoomEvent = { start?: number; end?: number; batch?: ZoomEvent[] };

export default function History({ points, dark, volatilitySymbol, isIndex, isFund, pricePrefix, language }: Props) {
  const panels = allPanels.filter(panel => panel !== 'volatility' || volatilitySymbol != null);
  const headingReveal = useScrollReveal<HTMLDivElement>();
  const [mode, setMode] = useState<Panel | 'all'>('all');
  const navigator = useRef<HTMLDivElement>(null);
  const navigatorChart = useRef<echarts.EChartsType | null>(null);
  const [selection, setSelection] = useState<{ points: ChartPoint[]; range: [number, number]; preset: number | null } | null>(null);
  const active = selection?.points === points ? selection : { range: [0, Math.max(0, points.length - 1)] as [number, number], preset: null };
  const [rangeStart, rangeEnd] = active.range;
  const rangeRef = useRef(active.range);
  rangeRef.current = active.range;
  const t = messages[language];
  const labels: Record<Panel, string> = { index: t.index, price: t.price, drawdown: t.chartDrawdown, rsi: 'RSI', volatility: t.volatility, ma: 'MA200' };
  const names: Record<Panel, string> = { index: t.index, price: isFund ? t.adjustedNav : isIndex ? t.indexClose : t.adjustedClose, drawdown: t.historicalDrawdown, rsi: t.rsi, volatility: volatilitySymbol ?? t.volatility, ma: t.ma };
  const visibleMode = mode === 'volatility' && !volatilitySymbol ? 'all' : mode;
  const updateRange = useCallback((range: [number, number]) => {
    setSelection(previous => previous?.points === points && previous.range[0] === range[0] && previous.range[1] === range[1] ? previous : { points, range, preset: null });
  }, [points]);

  useEffect(() => {
    if (!navigator.current || !points.length) return;
    const chart = echarts.init(navigator.current, undefined, { renderer: 'canvas' });
    navigatorChart.current = chart;
    const accent = dark ? '#80b9ff' : '#0877f9';
    chart.setOption({
      animation: false,
      grid: { left: 14, right: 14, top: 10, bottom: 12 },
      xAxis: { type: 'category', data: points.map(p => p.date), show: false },
      yAxis: { type: 'value', show: false, scale: true }, series: [],
      dataZoom: [{
        type: 'slider', xAxisIndex: 0, filterMode: 'none', left: 14, right: 14, top: 10, height: 28,
        startValue: rangeRef.current[0], endValue: rangeRef.current[1], minValueSpan: 1,
        borderColor: dark ? '#ffffff18' : '#dce2eb', borderRadius: 8,
        backgroundColor: dark ? '#161b24' : '#f3f6fa', fillerColor: dark ? '#80b9ff24' : '#0877f91a', showDataShadow: false,
        handleIcon: 'path://M-8,-14L8,-14L8,14L-8,14Z M-2,-5L-2,5M2,-5L2,5', handleSize: '100%',
        handleStyle: { color: dark ? '#2e3a4d' : '#fff', borderColor: accent, borderWidth: 1.2, shadowBlur: 3, shadowColor: '#00000012' },
        moveHandleSize: 0, showDetail: false, brushSelect: false, emphasis: { handleStyle: { borderWidth: 2 } },
      }],
    });
    chart.on('datazoom', (event: unknown) => {
      const data = event as ZoomEvent;
      const zoom = data.batch?.[0] ?? data;
      if (zoom.start != null && zoom.end != null) updateRange(rangeFromPercent(points.length, zoom.start, zoom.end));
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(navigator.current);
    return () => { observer.disconnect(); chart.dispose(); navigatorChart.current = null; };
  }, [points, dark, updateRange]);

  useEffect(() => {
    navigatorChart.current?.dispatchAction({ type: 'dataZoom', startValue: rangeStart, endValue: rangeEnd }, { silent: true });
  }, [rangeStart, rangeEnd]);

  const chooseRange = (preset: number) => setSelection({ points, range: rangeForMonths(points.map(p => p.date), preset), preset });
  const rangeLabel = (preset: number) => `${preset / 12}${t.yearSuffix}`;
  const chartDates = points.map(point => point.date);
  const dateText = (value?: string) => value?.replaceAll('-', '/') ?? '—';

  return <div>
    <section className="market-history" aria-label={t.history}>
      <div ref={headingReveal.ref} className={`history-heading ${headingReveal.className}`}><h2>{t.history}</h2><div className="segmented chart-select" role="group" aria-label={t.chartType}>
        {(['all', ...panels] as const).map(key => <button key={key} onClick={() => setMode(key)} aria-pressed={visibleMode === key} className={visibleMode === key ? 'selected' : ''}>{key === 'all' ? t.all : labels[key]}</button>)}
      </div></div>
      <div className="market-plots">
        {(visibleMode === 'all' ? panels : [visibleMode]).map(panel => <HistoryPlot key={panel} points={points} panel={panel} title={names[panel]} dark={dark} pricePrefix={pricePrefix} priceDigits={isFund ? 4 : 2} range={active.range} onRangeChange={updateRange} />)}
      </div>
    </section>
    {!points.length && <div className="chart-empty-inline">{t.noHistory}</div>}
    <div className="time-range" role="group" aria-label={t.visibleRange}>
      <div className="time-range-toolbar">
        <div className="range-dates" aria-live="polite"><time dateTime={points[rangeStart]?.date}>{dateText(points[rangeStart]?.date)}</time><span>—</span><time dateTime={points[rangeEnd]?.date}>{dateText(points[rangeEnd]?.date)}</time></div>
        <div className="range-presets" role="group" aria-label={t.rangePresets}>
          {rangePresets().map(preset => <button key={preset} disabled={!points.length || !hasFullYears(chartDates[0], chartDates[chartDates.length - 1], preset / 12)} aria-pressed={active.preset === preset} className={active.preset === preset ? 'selected' : ''} onClick={() => chooseRange(preset)}>{rangeLabel(preset)}</button>)}
        </div>
      </div>
      <div className="time-navigator" ref={navigator} aria-hidden="true" />
    </div>
  </div>;
}
