import type { EtfData, Metric } from './types';
import type { Language } from './i18n';
import { messages } from './i18n';
import { layoutQuote } from './shareQuotes';
import { shareQuotes } from './shareQuotes';
import { pricePrefix } from './instruments';

export type CardInput = { instrument: EtfData; score: number; language: Language; quote: string; url: string };
const sans = '"Share Sans", sans-serif';
const display = '"Share Display", sans-serif';
const serif = '"Share Serif", "Share Serif Full", "Songti SC", SimSun, serif';
let fontReady: Promise<void> | undefined;
const fontChunks = new Map<number, Promise<void>>();
const presetGlyphs = new Set(Array.from(shareQuotes.map(quote => quote.zh + quote.en).join('') + Object.values(messages.zh).join('') + Object.values(messages.en).join('')));
const logos = new Map<Language, Promise<HTMLImageElement>>();
const loadLogo = (language: Language) => {
  if (!logos.has(language)) logos.set(language, new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => { logos.delete(language); reject(new Error('logo_unavailable')); };
  image.src = `${import.meta.env.BASE_URL}${language === 'zh' ? 'logo.svg' : 'logo-en.svg'}`;
  }));
  return logos.get(language)!;
};
async function loadFonts(quote: string) {
  await (fontReady ??= (async () => {
    const faces = [
      new FontFace('Share Serif', `url(${import.meta.env.BASE_URL}fonts/share-serif-v3.woff2)`, { weight: '900' }),
      new FontFace('Share Sans', `url(${import.meta.env.BASE_URL}fonts/share-sans-v2.woff2)`, { weight: '700' }),
      new FontFace('Share Display', `url(${import.meta.env.BASE_URL}fonts/share-display-v2.woff2)`, { weight: '900' }),
    ];
    await Promise.all(faces.map(async face => document.fonts.add(await face.load())));
  })().catch(error => { fontReady = undefined; throw error; }));
  const required = new Set(Array.from(quote).filter(glyph => /[\u3400-\u9fff]/u.test(glyph) && !presetGlyphs.has(glyph))
    .map(glyph => 0x3400 + Math.floor((glyph.codePointAt(0)! - 0x3400) / 0x400) * 0x400));
  await Promise.all(Array.from(required, start => {
    if (!fontChunks.has(start)) fontChunks.set(start, (async () => {
      const face = new FontFace('Share Serif Full', `url(${import.meta.env.BASE_URL}fonts/share-serif-${start.toString(16)}.woff2)`, {
        weight: '900', unicodeRange: `U+${start.toString(16)}-${Math.min(start + 0x3ff, 0x9fff).toString(16)}`,
      });
      document.fonts.add(await face.load());
    })().catch(error => { fontChunks.delete(start); throw error; }));
    return fontChunks.get(start)!;
  }));
}
const number = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value: number | null | undefined) => value == null ? '—' : `${value < 0 ? '−' : value > 0 ? '+' : ''}${number(Math.abs(value))}%`;

export async function renderShareCard(input: CardInput): Promise<Blob> {
  await loadFonts(input.quote);
  const { instrument: etf, score, language, quote, url } = input;
  const t = messages[language], data = etf.windows.all;
  if (!data || !Number.isFinite(score)) throw new Error('unavailable');
  const canvas = document.createElement('canvas');
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');
  // Sampled from the approved reference: rules, values and display ink differ.
  const blue = '#071ffa', valueBlue = '#0620ef', black = '#000000', gray = '#b1b1b2';
  ctx.fillStyle = '#fefcf7'; ctx.fillRect(0, 0, 1080, 1920);
  const font = (size: number, weight = 700, family = sans) => { ctx.font = `${weight} ${size}px ${family}`; };
  const text = (value: string, x: number, y: number, size: number, color = black, weight = 700, maxWidth = 968, family = sans) => {
    font(size, weight, family);
    while (ctx.measureText(value).width > maxWidth && size > 14) { size--; font(size, weight, family); }
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  const rule = (x: number, y: number, width: number, color = '#dadce2', thickness = 1.5) => {
    ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
  };
  const logo = await loadLogo(language), logoWidth = language === 'zh' ? 210 : 360;
  ctx.drawImage(logo, 56, 36, logoWidth, logoWidth * logo.naturalHeight / logo.naturalWidth);
  font(46, 750); const tickerWidth = Math.min(350, Math.max(184, ctx.measureText(etf.symbol).width + 54));
  const pill = (value: string, x: number, width: number) => {
    ctx.strokeStyle = blue; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(x, 38, width, 88, 44); ctx.stroke();
    ctx.textAlign = 'center'; text(value, x + width / 2, 99, 46, black, 750, width - 40); ctx.textAlign = 'left';
  };
  pill(etf.symbol, 1024 - tickerWidth, tickerWidth);

  // The quote is intentionally the first visual anchor, like the approved poster.
  if (quote.trim()) {
  const layout = layoutQuote(quote, (line, size) => { font(size, 900, serif); return ctx.measureText(line).width; });
  const lineHeight = layout.size * 1.16;
  const top = 190 + (410 - layout.lines.length * lineHeight) / 2;
  ctx.textBaseline = 'top';
  layout.lines.forEach((line, i) => text(line, 56, top + i * lineHeight, layout.size, black, 900, 968, serif));
  ctx.textBaseline = 'alphabetic';
  const lastLine = layout.lines[layout.lines.length - 1]; font(layout.size, 900, serif);
  const underlineX = 56 + Math.min(620, ctx.measureText(lastLine).width * .45);
  ctx.strokeStyle = blue; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath();
  ctx.moveTo(underlineX, 612); ctx.bezierCurveTo(underlineX + 70, 595, underlineX + 210, 595, underlineX + 140, 608);
  ctx.bezierCurveTo(underlineX + 90, 620, underlineX + 190, 610, underlineX + 245, 613); ctx.stroke();
  }
  const hasText = Boolean(quote.trim());
  text(t.index, 56, hasText ? 765 : 350, 90, black, 900, 540, serif);
  font(90, 900, serif); const labelEnd = 56 + ctx.measureText(t.index).width + 34;
  rule(labelEnd, hasText ? 739 : 316, 1024 - labelEnd, blue, 4);
  const scoreText = score.toFixed(1), baseline = hasText ? 1205 : 855;
  font(550, 900, display);
  const bounds = ctx.measureText(scoreText), stroke = 10;
  const inkWidth = bounds.actualBoundingBoxLeft + bounds.actualBoundingBoxRight + stroke;
  const inkHeight = bounds.actualBoundingBoxAscent + bounds.actualBoundingBoxDescent + stroke;
  const height = hasText ? 395 : 450;
  ctx.save(); ctx.translate(48, baseline);
  ctx.scale(984 / inkWidth, height / inkHeight);
  const numberX = bounds.actualBoundingBoxLeft + stroke / 2;
  const numberY = -bounds.actualBoundingBoxDescent - stroke / 2;
  const gradient = ctx.createLinearGradient(0, -inkHeight, 0, 0);
  gradient.addColorStop(0, '#0020e6'); gradient.addColorStop(.38, '#001dd3'); gradient.addColorStop(1, '#001bcf');
  ctx.fillStyle = gradient; ctx.strokeStyle = gradient; ctx.lineWidth = stroke; ctx.lineJoin = 'miter';
  ctx.strokeText(scoreText, numberX, numberY); ctx.fillText(scoreText, numberX, numberY); ctx.restore();
  const headline = `${t.headlineBefore}${score.toFixed(1)}%${t.headlineAfter}`;
  const headlineBaseline = hasText ? 1297 : 965;
  text(headline, 56, headlineBaseline, 80, black, 900, 968, serif);

  const metrics: { name: string; metric: Metric | undefined; percent?: boolean }[] = [
    { name: 'RSI (14)', metric: data.rsi }, { name: t.ma, metric: data.ma, percent: true },
  ];
  if (etf.volatilitySymbol) metrics.push({ name: etf.volatilitySymbol, metric: data.volatility[etf.volatilitySymbol] });
  const tableTop = headlineBaseline + 39;
  const rowHeight = (1790 - tableTop) / (metrics.length + 1);
  // Every row shares the same four columns, including drawdown / closing price.
  const row = (index: number, label: string, value: string, rightLabel: string, rightValue: string) => {
    const y = tableTop + index * rowHeight;
    const baseline = y + rowHeight / 2 + 18;
    text(label, 56, baseline, 40, black, 650, 248);
    text(value, 330, baseline + 2, 58, valueBlue, 750, 245);
    font(58, 750);
    const rightLabelWidth = Math.min(222, 1024 - Math.min(230, ctx.measureText(rightValue).width) - 628 - 24);
    text(rightLabel, 628, baseline, language === 'zh' ? 38 : 29, black, 600, rightLabelWidth);
    ctx.textAlign = 'right'; text(rightValue, 1024, baseline + 2, 58, valueBlue, 750, 230); ctx.textAlign = 'left';
    ctx.strokeStyle = gray; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(598, y + rowHeight * .28); ctx.lineTo(598, y + rowHeight * .72); ctx.stroke();
    rule(56, y + rowHeight, 968, gray, 2);
  };
  rule(56, tableTop, 968, blue, 4);
  row(0, t.drawdown, signed(etf.drawdown), etf.kind === 'fund' ? t.unitNav : t.closePrice, `${pricePrefix(etf.kind, etf.currency)}${number(etf.close, etf.kind === 'fund' ? 4 : 2)}`);
  metrics.forEach((item, i) => {
    const rank = item.metric?.percentile;
    row(i + 1, item.name, item.percent ? signed(item.metric?.value) : number(item.metric?.value),
      t.percentile, rank == null ? '—' : `${number(rank, 0)}%`);
  });
  const host = new URL(url).host;
  text(host, 56, 1867, 40, valueBlue, 750, 680);
  font(40, 750); const linkEnd = 56 + ctx.measureText(host).width;
  font(29, 500); const date = etf.date.replaceAll('-', '/'); const dateStart = 1024 - ctx.measureText(date).width;
  if (dateStart - linkEnd > 60) rule(linkEnd + 24, 1856, dateStart - linkEnd - 48, '#b9b9bb', 2);
  ctx.textAlign = 'right'; text(date, 1024, 1867, 29, '#737379', 500, 280);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('image_failed')), 'image/png'));
}
