export type VolatilitySymbol = string;
export type SearchMatch = { symbol: string; name: string; kind: 'security' | 'fund' };
export type Metric = { value: number | null; percentile: number | null; date: string; historyStart?: string };
export type ChartPoint = {
  date: string; price: number; drawdown: number; index: number | null;
  rsi: number | null; ma: number | null; volatility: number | null;
};
export type WindowData = {
  index: number | null;
  rsi: Metric;
  ma: Metric;
  volatility: Record<VolatilitySymbol, Metric>;
  drawdownSampleCount: number;
  drawdownEventCount: number;
  chart: ChartPoint[];
};
export type EtfData = {
  kind: 'index' | 'security' | 'fund'; name: string; currency: string; market: string; timezone: string; priceBasis: string; calculationVersion: number;
  symbol: string; volatilitySymbol: VolatilitySymbol | null; date: string; close: number; drawdown: number;
  drawdownQuantiles: number[] | null;
  historyStart: string; observationCount: number;
  windows: Record<string, WindowData>;
};
export type MarketData = {
  schemaVersion: number; generatedAt: string;
  sources: { etf: string; volatility: string };
  etfs: Record<string, EtfData>;
};
