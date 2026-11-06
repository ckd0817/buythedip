export const defaults = ['SPY', 'QQQ', 'SMH'];
export function pricePrefix(kind?: string, currency = 'USD') {
  return kind === 'index' ? '' : ({ USD: '$', HKD: 'HK$', CNY: '¥', JPY: '¥' }[currency] ?? `${currency} `);
}
