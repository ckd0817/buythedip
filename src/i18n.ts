export type Language = 'zh' | 'en';
export const LANGUAGE_KEY = 'buythedip.language';

export function detectLanguage(languages: readonly string[]): Language {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === 'zh' || base === 'en') return base;
  }
  return 'en';
}

export function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch { /* Browser language also works when storage is disabled. */ }
  return detectLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

const zh = {
  title: '抄底', description: '抄底 — 美股 ETF 历史回撤与市场指标。',
  overview: '市场概览', home: '抄底首页', methodology: '指标说明',
  language: '语言', light: '浅色模式', dark: '深色模式', switchLight: '切换浅色模式', switchDark: '切换深色模式',
  instrument: '标的', chooseInstrument: '选择标的', securityType: '股票 / ETF', fundType: '基金', removeAsset: '移除', symbolSearch: '搜索股票代码', symbolPlaceholder: '股票 / ETF 代码', search: '搜索', invalidSymbol: '请输入有效代码', symbolNotFound: '未找到该代码', unsupportedInstrument: '暂不支持该标的',
  moreIndices: '更多指数', indexClose: '收盘点位', indexPointMethod: '衡量当前回撤深度相对于历史已结束回撤事件最大深度的位置。恢复前高时事件结束，中间反弹仍属同一事件。每次事件取最深回撤，不设最小深度；当前未结束事件不计入样本。使用截至当日全部可用的已结束事件。指数以官方收盘点位计算。', indexPointFormula: '回撤深度 = 1 − 收盘点位 ÷ 截至当日历史最高收盘点位\n抄底指数 = 最大深度小于当前回撤的已结束事件数 ÷ 已结束事件总数 × 100', allHistory: '全部', period: '统计区间', yearSuffix: '年', index: '抄底指数',
  headlineBefore: '现在买入，有 ', headlineAfter: ' 的概率抄到底部',
  dataError: '行情数据暂时无法读取', insufficient: '历史样本不足', loading: '正在读取行情', retry: '重新加载',
  drawdownQuantiles: '回撤分位', allQuantiles: '全部分位', drawdownMagnitude: '回撤幅度',
  drawdown: '回撤', closePrice: '收盘价', unitNav: '单位净值', adjustedNav: '复权净值', unsupportedFund: '暂不支持该类型基金', percentile: '历史百分位',
  auxiliary: '辅助指标', ma: 'MA200 偏离', history: '历史走势', chartLoading: '正在加载图表',
  calculations: '指标说明', close: '关闭', rsi: 'RSI (14)',
  fundIndexMethod: '衡量当前回撤深度相对于历史已结束回撤事件最大深度的位置。恢复前高时事件结束，中途反弹不拆分。每次事件取最深回撤，不设最小深度；当前事件不计入样本。基金使用分红、份额折算调整后的净值序列，调整日按数据源披露的净值增长率衔接。',
  fundIndexFormula: '回撤深度 = 1 − 复权净值 ÷ 截至当日历史最高复权净值\n抄底指数 = 最大深度小于当前回撤的已结束事件数 ÷ 已结束事件总数 × 100',
  indexMethod: '衡量当前回撤深度相对于历史已结束回撤事件最大深度的位置。价格低于前高后，直到恢复前高为一次回撤事件，中间反弹不另计。每次事件取最深回撤，不设最小深度；当前未结束事件不计入历史样本。使用截至当日全部可用的已结束事件。回撤以拆股、分红调整后的收盘价计算。',
  indexFormula: '回撤深度 = 1 − 调整后收盘价 ÷ 截至当日历史最高调整后收盘价\n抄底指数 = 最大深度小于当前回撤的已结束事件数 ÷ 已结束事件总数 × 100',
  rsiMethod: '相对强弱指数（Relative Strength Index）通过比较上涨与下跌的平均幅度，衡量价格变化的动量，取值范围为 0～100。14 表示计算周期为 14 个交易日。通常将高于 70 视为超买，低于 30 视为超卖。',
  rsiFormula: 'RSI = 100 − 100 ÷ (1 + RS)\nRS = 平均上涨幅度 ÷ 平均下跌幅度\n平均涨跌幅采用 14 期 Wilder 平滑。',
  maMethod: '衡量当前价格与过去 200 个交易日简单移动平均价之间的百分比差异，也称 200 日乖离率。正值表示价格高于均线，负值表示低于均线，绝对值越大表示偏离程度越高。',
  maFormula: 'MA200 = 最近 200 个交易日收盘价之和 ÷ 200\nMA200 偏离 = (当前价格 ÷ MA200 − 1) × 100%',
  volatilityIndex: '波动率指数',
  volatilityMethod: '根据期权价格估算市场对未来约 30 天价格波动的预期，以年化百分比表示。数值越高，表示预期波动越大，本身不代表上涨或下跌方向。VIX 对应标普 500，VXN 对应纳斯达克 100，VXSMH 对应半导体 ETF SMH。',
  volatilityFormula: '波动率指数 = 100 × √预期年化方差\n预期年化方差由期权价格推算，并换算至约 30 天期限。',
  price: '价格', chartDrawdown: '回撤', indexTab: '指数', volatility: '波动率',
  adjustedClose: '调整后收盘价', historicalDrawdown: '历史回撤', all: '全部',
  chartType: '历史走势图表类型', chartLabel: '{symbol}过去{years}年{series}走势图', noHistory: '暂无历史数据',
  visibleRange: '图表时间范围', rangePresets: '快捷时间范围', threeMonths: '3个月', sixMonths: '6个月', oneYear: '1年', threeYears: '3年', fiveYears: '5年', tenYears: '10年',
};
const en: typeof zh = {
  title: 'Buy the Dip', description: 'Buy the Dip — US ETF drawdowns and market indicators.',
  overview: 'Market overview', home: 'Buy the Dip home', methodology: 'Methodology',
  language: 'Language', light: 'Light mode', dark: 'Dark mode', switchLight: 'Switch to light mode', switchDark: 'Switch to dark mode',
  instrument: 'Instrument', chooseInstrument: 'Choose an instrument', securityType: 'Stock / ETF', fundType: 'Fund', removeAsset: 'Remove', symbolSearch: 'Search ticker', symbolPlaceholder: 'Stock / ETF ticker', search: 'Search', invalidSymbol: 'Enter a valid ticker', symbolNotFound: 'Ticker not found', unsupportedInstrument: 'Instrument not supported',
  moreIndices: 'More indices', indexClose: 'Closing level', indexPointMethod: 'Ranks the current drawdown against the maximum depths of completed historical events, using index closing levels. Recovery to the previous high ends an event. All event sizes count; the ongoing event is excluded. Uses all available events completed by the observation date.', indexPointFormula: 'Drawdown = 1 − Closing level ÷ Highest closing level to date\nDip Index = Completed events with a maximum depth below the current drawdown ÷ All completed events × 100', allHistory: 'Max', period: 'Lookback period', yearSuffix: 'Y', index: 'Dip Index',
  headlineBefore: 'Buy now, with a ', headlineAfter: ' chance of catching the bottom',
  dataError: 'Market data is unavailable', insufficient: 'Insufficient history', loading: 'Loading market data', retry: 'Retry',
  drawdownQuantiles: 'Drawdown percentiles', allQuantiles: 'All percentiles', drawdownMagnitude: 'Drawdown depth',
  drawdown: 'Drawdown', closePrice: 'Closing price', unitNav: 'Unit NAV', adjustedNav: 'Adjusted NAV', unsupportedFund: 'Fund type not supported', percentile: 'Historical percentile',
  auxiliary: 'Supporting indicators', ma: 'MA200 deviation', history: 'History', chartLoading: 'Loading charts',
  calculations: 'Indicators', close: 'Close', rsi: 'RSI (14)',
  fundIndexMethod: 'Ranks the current drawdown against completed historical event maxima. Recovery to the previous high ends an event; intermediate rebounds stay in that event. Every event counts; the ongoing event is excluded. Fund NAVs are adjusted for distributions and unit conversions, using the provider-reported NAV growth on adjustment dates.',
  fundIndexFormula: 'Drawdown = 1 − Adjusted NAV ÷ Highest adjusted NAV to date\nDip Index = Completed events with a maximum depth below the current drawdown ÷ All completed events × 100',
  indexMethod: 'Ranks the current drawdown against the maximum depths of completed historical drawdown events. An event ends when price recovers its previous high; intermediate rebounds remain part of that event. Every event counts, regardless of size. The ongoing event is excluded. Uses all available events completed by the observation date. Prices are adjusted for splits and dividends.',
  indexFormula: 'Drawdown = 1 − Adjusted close ÷ Highest adjusted close to date\nDip Index = Completed events with a maximum depth below the current drawdown ÷ All completed events × 100',
  rsiMethod: 'The Relative Strength Index compares average gains and losses to measure price momentum, on a scale from 0 to 100. The parameter 14 denotes a calculation period of 14 trading days. Readings above 70 are conventionally considered overbought, while readings below 30 are considered oversold.',
  rsiFormula: 'RSI = 100 − 100 ÷ (1 + RS)\nRS = Average gain ÷ Average loss\nAverages use 14-period Wilder smoothing.',
  maMethod: 'Measures the percentage difference between the current price and its simple moving average over the past 200 trading days. Positive values indicate a price above the average; negative values indicate a price below it. A larger absolute value indicates a greater deviation.',
  maFormula: 'MA200 = Sum of the last 200 daily closes ÷ 200\nMA200 deviation = (Current price ÷ MA200 − 1) × 100%',
  volatilityIndex: 'Volatility indices',
  volatilityMethod: 'Estimate expected price fluctuations over approximately the next 30 days from option prices, expressed as an annualized percentage. Higher values indicate greater expected volatility, without specifying an upward or downward direction. VIX refers to the S&P 500, VXN to the Nasdaq-100, and VXSMH to the SMH semiconductor ETF.',
  volatilityFormula: 'Volatility index = 100 × √Expected annualized variance\nVariance is inferred from option prices and interpolated to an approximately 30-day horizon.',
  price: 'Price', chartDrawdown: 'Drawdown', indexTab: 'Index', volatility: 'Volatility',
  adjustedClose: 'Adjusted close', historicalDrawdown: 'Drawdown', all: 'All',
  chartType: 'Historical chart type', chartLabel: '{symbol}: {years}-year {series} chart', noHistory: 'No historical data',
  visibleRange: 'Chart date range', rangePresets: 'Quick date ranges', threeMonths: '3M', sixMonths: '6M', oneYear: '1Y', threeYears: '3Y', fiveYears: '5Y', tenYears: '10Y',
};

export const messages = { zh, en };
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}
