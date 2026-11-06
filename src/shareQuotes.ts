export type QuoteGroup = 'zero' | 'low' | 'high';
export type ShareQuote = { id: string; group: QuoteGroup; zh: string; en: string };
export const shareQuotes: ShareQuote[] = [
  { id: 'bull-back', group: 'zero', zh: '牛回，速归！', en: 'The bull is back. Get in here!' },
  { id: 'bright-future', group: 'zero', zh: '我们都有光明的未来。', en: 'A bright future awaits us all.' },
  { id: 'baby-bull', group: 'zero', zh: '我闻到了小牛淡淡的香味。', en: 'I can smell a baby bull market.' },
  { id: 'too-little', group: 'zero', zh: '只恨之前抄底买少了。', en: 'My only regret? Not buying more.' },
  { id: 'halfway', group: 'low', zh: '抄底抄在半山腰。', en: 'Bought the dip. Still halfway down.' },
  { id: 'cleaned-out', group: 'low', zh: '你想抄底，它想抄家。', en: 'I bought the dip. It bought my house.' },
  { id: 'basement', group: 'low', zh: '地板下面，还有地下室。', en: 'Below the floor? A basement.' },
  { id: 'refund-time', group: 'low', zh: '现在退款，还来得及吗？', en: 'Is it too late for a refund?' },
  { id: 'small-loss', group: 'low', zh: '别人恐惧我贪婪，别人小亏我破产。', en: 'They get scared, I get greedy. They lose a little, I lose it all.' },
  { id: 'different', group: 'low', zh: '这次不一样！', en: 'This time is different!' },
  { id: 'shocked', group: 'low', zh: '我不理解，但是大受震撼。', en: 'I do not understand. I am deeply impressed.' },
  { id: 'all-in', group: 'high', zh: '梭哈是一种智慧。', en: 'Going all in is a kind of wisdom.' },
  { id: 'noodles', group: 'high', zh: '关灯吃面。', en: 'Noodles for dinner. Lights off.' },
  { id: 'rooftop', group: 'high', zh: '天台的风好大。', en: 'It is windy up on the rooftop.' },
  { id: 'minor', group: 'high', zh: '给我退款，我不玩了，我是未成年！', en: 'Refund, please. I quit. I am a minor!' },
  { id: 'family', group: 'high', zh: '事到如今，最对不起的还是家人。', en: 'At this point, I owe my family an apology.' },
  { id: 'park', group: 'high', zh: '买在最高点，公园当据点。', en: 'Bought the top. Now the park is home.' },
  { id: 'bad-at-it', group: 'low', zh: '又菜又爱玩。', en: 'Bad at this. Still playing.' },
  { id: 'numb', group: 'high', zh: '亏麻了。', en: 'Lost so much I am numb.' },
  { id: 'try-harder', group: 'high', zh: '越努力，越亏钱。', en: 'The harder I try, the more I lose.' },
  { id: 'break-even', group: 'high', zh: '回本就走。', en: 'Break even. Then I am out.' },
  { id: 'club-or-work', group: 'low', zh: '赢了会所，输了搬砖。', en: 'Win: party. Lose: back to work.' },
  { id: 'delete-app', group: 'high', zh: '删软件，做股东。', en: 'Delete the app. Become a long-term investor.' },
  { id: 'disagree', group: 'low', zh: '我与市场方面没达成共识。', en: 'The market and I could not reach an agreement.' },
  { id: 'long-term', group: 'high', zh: '什么赔钱，那叫长投。', en: 'A loss? No. A long-term investment.' },
  { id: 'not-sold', group: 'high', zh: '只要不卖，就不算亏。', en: 'It is not a loss if I do not sell.' },
  { id: 'far-away', group: 'low', zh: '我滚得越远，股市就会涨得越多。', en: 'The farther I go away, the higher stocks go.' },
];

export function quoteGroup(score: number): QuoteGroup {
  return score === 0 ? 'zero' : score <= 50 ? 'low' : 'high';
}

type QuoteStorage = Pick<Storage, 'getItem' | 'setItem'>;
type QuoteBag = { pool: string; remaining: string[]; last?: string };
const QUOTE_BAGS_KEY = 'buythedip.quote-bags.v1';

/** Shuffle bags persist across dialog opens, tickers, languages and reloads. */
export function createQuotePicker(storage?: QuoteStorage, random = Math.random) {
  let memory: Partial<Record<QuoteGroup, QuoteBag>> = {};
  let persistenceFailed = false;
  return (score: number): ShareQuote => {
    let saved = persistenceFailed ? undefined : storage;
    try { if (!persistenceFailed) saved ??= globalThis.localStorage; } catch { /* Use memory if storage is unavailable. */ }
    let state = memory;
    try {
      const value = JSON.parse(saved?.getItem(QUOTE_BAGS_KEY) ?? 'null');
      if (value && typeof value === 'object' && !Array.isArray(value)) state = value;
    } catch { /* Retain the in-session bags. */ }
    const group = quoteGroup(score);
    const pool = shareQuotes.filter(quote => quote.group === group);
    const ids = pool.map(quote => quote.id), signature = ids.join('|');
    let bag = state[group];
    if (!bag || bag.pool !== signature || !Array.isArray(bag.remaining)
      || new Set(bag.remaining).size !== bag.remaining.length || bag.remaining.some(id => !ids.includes(id))) {
      bag = { pool: signature, remaining: [] };
    }
    if (!bag.remaining.length) {
      bag.remaining = [...ids];
      for (let i = bag.remaining.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
        [bag.remaining[i], bag.remaining[j]] = [bag.remaining[j], bag.remaining[i]];
      }
      if (bag.remaining.length > 1 && bag.remaining[0] === bag.last) {
        [bag.remaining[0], bag.remaining[1]] = [bag.remaining[1], bag.remaining[0]];
      }
    }
    const id = bag.remaining.shift()!;
    bag.last = id; state[group] = bag; memory = state;
    try { saved?.setItem(QUOTE_BAGS_KEY, JSON.stringify(state)); } catch { persistenceFailed = true; }
    return pool.find(quote => quote.id === id)!;
  };
}

export const pickQuote = createQuotePicker();

export function cleanQuote(value: string, limit: number): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ')).slice(0, limit).join('');
}

export function shareLink(origin: string, symbol: string): string {
  const url = new URL('/', origin);
  url.searchParams.set('etf', symbol);
  return url.href;
}

/** Fit plain text by actual glyph widths; forced breaks favor balanced lines. */
export function layoutQuote(text: string, measure: (line: string, size: number) => number,
  width = 968, height = 410, maximum = 176, minimum = 32): { lines: string[]; size: number } {
  const glyphs = Array.from(text.trim());
  if (!glyphs.length) throw new Error('empty_quote');
  const preferred: Record<string, string[]> = {
    '梭哈是一种智慧。': ['梭哈', '是一种智慧。'],
    '我们都有光明的未来。': ['我们都有', '光明的未来。'],
    '我闻到了小牛淡淡的香味。': ['我闻到了', '小牛淡淡的香味。'],
    '只恨之前抄底买少了。': ['只恨之前', '抄底买少了。'],
    '抄底抄在半山腰。': ['抄底抄在', '半山腰。'],
    '天台的风好大。': ['天台的风', '好大。'],
    '我与市场方面没达成共识。': ['我与市场方面', '没达成共识。'],
    '事到如今，最对不起的还是家人。': ['事到如今，', '最对不起的', '还是家人。'],
  };
  if (preferred[text]) {
    const lines = preferred[text];
    for (let size = maximum; size >= minimum; size -= 2) {
      if (lines.length * size * 1.16 <= height && lines.every(line => measure(line, size) <= width)) return { lines, size };
    }
  }
  if (glyphs.length <= 6 && !/[A-Za-z]/u.test(text)) {
    for (let size = 250; size >= minimum; size -= 2) {
      if (size * 1.16 <= height && measure(text, size) <= width) return { lines: [text], size };
    }
  }
  for (let size = maximum; size >= minimum; size -= 2) {
    const greedy: string[] = [];
    let line = '';
    for (const glyph of glyphs) {
      if (line && measure(line + glyph, size) > width) { greedy.push(line.trim()); line = ''; }
      line += glyph;
    }
    if (line.trim()) greedy.push(line.trim());
    if (!greedy.length || greedy.length * size * 1.16 > height || greedy.some(value => measure(value, size) > width)) continue;
    // Prefer an intentional punctuation break when a short quote fits two lines.
    const split = text.match(/^(.+?[，,！？!?：:])\s*(.+)$/u);
    if (split && size * 2 * 1.16 <= height && split.slice(1).every(value => measure(value, size) <= width)) {
      return { lines: split.slice(1), size };
    }
    // Balance short CJK headlines instead of leaving a one-character final line.
    if (greedy.length > 1 && !/[A-Za-z]/.test(text)) {
      const count = greedy.length;
      const balanced: string[] = [];
      let offset = 0;
      for (let row = 0; row < count; row++) {
        const remaining = count - row;
        const length = Math.ceil((glyphs.length - offset) / remaining);
        balanced.push(glyphs.slice(offset, offset + length).join(''));
        offset += length;
      }
      if (balanced.every(line => measure(line, size) <= width && !/^[，。！？、；：]/u.test(line))) return { lines: balanced, size };
    }
    // Avoid cutting English words where a nearby space is available.
    if (/[A-Za-z]/.test(text) && /\s/u.test(text) && text.split(/\s+/u).every(token => measure(token, size) <= width)) {
      const wrapped: string[] = [];
      let line = '';
      for (const token of text.split(/(\s+)/u)) {
        if (line && measure(line + token, size) > width) { wrapped.push(line.trim()); line = ''; }
        line += token;
      }
      if (line.trim()) wrapped.push(line.trim());
      if (wrapped.length * size * 1.16 <= height && wrapped.every(line => measure(line, size) <= width)) return { lines: wrapped, size };
      continue;
    }
    return { lines: greedy, size };
  }
  throw new Error('quote_too_long');
}
