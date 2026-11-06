import { defaults } from './instruments';

export type CustomAsset = { symbol: string; lastViewed: number };
export const CUSTOM_ASSETS_KEY = 'buythedip.assets.v2';
const excluded = new Set(['SPX', 'NDX', 'CSI300', 'STAR50', 'HSTECH', 'N225']);
export const normalizeTicker = (value: string) => {
  const symbol = value.trim().toUpperCase().replace(/\s+/g, '');
  const fund = symbol.match(/^(?:(?:基金|FUND)(\d{6})|(\d{6})\.OF)$/);
  if (fund) return `${fund[1] ?? fund[2]}.OF`;
  const cn = symbol.match(/^(?:(SH|SZ))?(\d{6})(?:\.(SS|SH|SZ))?$/);
  if (cn) {
    const exchange = cn[1] ?? cn[3];
    if (!exchange && /^[478]/.test(cn[2])) return `${cn[2]}.OF`;
    const suffix = exchange ? (exchange === 'SZ' ? 'SZ' : 'SS') : /^[569]/.test(cn[2]) ? 'SS' : 'SZ';
    return `${cn[2]}.${suffix}`;
  }
  const hk = symbol.match(/^(?:HK(\d{1,5})|(\d{1,5})(?:\.HK)?)$/);
  if (hk) return `${String(Number(hk[1] ?? hk[2])).padStart(4, '0')}.HK`;
  return symbol.replaceAll('.', '-');
};
export const validTicker = (value: string) => value.length <= 15 && !excluded.has(value) && (
  /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)?$/.test(value)
  || /^(?:[569]\d{5}\.SS|[0123]\d{5}\.SZ)$/.test(value)
  || /^\d{4,5}\.HK$/.test(value) && Number(value.split('.')[0]) > 0
  || /^\d{6}\.OF$/.test(value)
);

function cleanAssets(value: unknown): CustomAsset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 30).filter((entry: CustomAsset) => {
    if (!entry || !validTicker(entry.symbol) || seen.has(entry.symbol) || !Number.isFinite(entry.lastViewed)) return false;
    seen.add(entry.symbol);
    return true;
  });
}

export function readCustomAssets(): CustomAsset[] {
  const initial = defaults.map((symbol, i) => ({ symbol, lastViewed: i }));
  try {
    const saved = localStorage.getItem(CUSTOM_ASSETS_KEY);
    if (saved !== null) {
      const entries = cleanAssets(JSON.parse(saved));
      return entries.length ? entries : initial;
    }
    const legacy = cleanAssets(JSON.parse(localStorage.getItem('buythedip.custom-assets.v1') ?? '[]'));
    return [...initial, ...legacy.filter(item => !defaults.includes(item.symbol))];
  } catch { return initial; }
}

/** Evict from the left in display order, always keeping the active asset. */
export function fitCustomAssets(entries: CustomAsset[], widths: Map<string, number>, budget: number, active: string, gap = 2): CustomAsset[] {
  const result = [...entries];
  const used = () => result.reduce((sum, item) => sum + (widths.get(item.symbol) ?? 90) + gap, 0);
  while (result.length && used() > budget) {
    const removable = result.findIndex(item => item.symbol !== active);
    if (removable < 0) break;
    result.splice(removable, 1);
  }
  return result;
}

export function visitAsset(entries: CustomAsset[], symbol: string, time: number): CustomAsset[] {
  const existing = entries.find(item => item.symbol === symbol);
  return existing ? entries.map(item => item.symbol === symbol ? { ...item, lastViewed: time } : item) : [...entries, { symbol, lastViewed: time }];
}
