import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CUSTOM_ASSETS_KEY, fitCustomAssets, normalizeTicker, readCustomAssets, validTicker, visitAsset } from './customAssets';
import { messages, type Language } from './i18n';
import type { SearchMatch } from './types';

type Props = {
  selected: string; confirmed?: string; language: Language;
  prepare: (symbol: string) => Promise<string>; onSelect: (symbol: string) => void;
  lookup: (query: string) => Promise<SearchMatch[]>;
};
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, i) => value === b[i]);
const birthFrames: Keyframe[] = Array.from({ length: 31 }, (_, i) => {
  const t = i / 30, w = 18, damping = .76, wd = w * Math.sqrt(1 - damping ** 2);
  const p = i === 30 ? 1 : 1 - Math.exp(-damping * w * t * .45) * (Math.cos(wd * t * .45) + damping * w / wd * Math.sin(wd * t * .45));
  return { offset: t, opacity: Math.min(1, Math.max(0, p * 1.5)), transform: `translateX(${16 * (1 - p)}px) scale(${.84 + .16 * p})` };
});

export default function AssetControls({ selected, confirmed, language, lookup, prepare, onSelect }: Props) {
  const t = messages[language];
  const [custom, setCustom] = useState(readCustomAssets);
  const [visible, setVisible] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const chooser = useRef<HTMLDialogElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const space = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const revision = useRef(0);
  const composing = useRef(false);
  const admitting = useRef<string | null>(null);
  const born = useRef<string | null>(null);
  const oldRects = useRef(new Map<string, DOMRect>());
  const animations = useRef<Animation[]>([]);

  useEffect(() => {
    if (!matches.length) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [Boolean(matches.length)]);

  const capture = useCallback(() => {
    const rects = new Map<string, DOMRect>();
    root.current?.querySelectorAll<HTMLElement>('[data-motion]').forEach(element => rects.set(element.dataset.motion!, element.getBoundingClientRect()));
    oldRects.current = rects;
  }, []);

  useEffect(() => {
    try { localStorage.setItem(CUSTOM_ASSETS_KEY, JSON.stringify(custom)); } catch { /* In-session operation remains available. */ }
  }, [custom]);

  const admit = useCallback((symbol: string) => {
    capture();
    admitting.current = symbol;
    born.current = symbol;
    setCustom(previous => visitAsset(previous, symbol, Date.now()));
  }, [capture]);

  useEffect(() => {
    if (confirmed && !custom.some(item => item.symbol === confirmed)) admit(confirmed);
  }, [confirmed, custom, admit]);

  const measure = useCallback(() => {
    if (!root.current || !space.current || !probe.current || !form.current) return;
    const toolbarStyle = getComputedStyle(root.current);
    const gap = parseFloat(toolbarStyle.columnGap) || 0;
    const available = root.current.clientWidth - form.current.offsetWidth - gap;
    const widths = new Map<string, number>();
    probe.current.querySelectorAll<HTMLElement>('[data-symbol]').forEach(element => widths.set(element.dataset.symbol!, element.offsetWidth));
    const probeStyle = getComputedStyle(probe.current);
    const padding = (parseFloat(probeStyle.paddingLeft) || 0) + (parseFloat(probeStyle.paddingRight) || 0);
    const fitted = fitCustomAssets(custom, widths, Math.max(0, available - padding + 2), selected);
    const symbols = fitted.map(item => item.symbol);
    if (admitting.current) {
      admitting.current = null;
      if (fitted.length !== custom.length) setCustom(fitted);
    }
    setVisible(previous => same(previous, symbols) ? previous : symbols);
  }, [custom, selected]);

  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(() => { capture(); measure(); });
    [root.current, space.current, form.current].forEach(element => { if (element) observer.observe(element); });
    return () => observer.disconnect();
  }, [measure, capture, language]);

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    const elements = root.current?.querySelectorAll<HTMLElement>('[data-motion]');
    if (!elements) return;
    // Read presentation geometry before cancelling an interrupted transition.
    animations.current.forEach(animation => animation.cancel());
    animations.current = [];
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    elements.forEach(element => {
      const key = element.dataset.motion!, rect = element.getBoundingClientRect();
      nextRects.set(key, rect);
      const previous = oldRects.current.get(key);
      if (reduce) return;
      if (key === born.current) {
        animations.current.push(element.animate(birthFrames, { duration: 450, easing: 'linear' }));
        born.current = null;
      } else if (previous) {
        const dx = previous.left - rect.left;
        const scale = key === 'background' && rect.width ? previous.width / rect.width : 1;
        if (Math.abs(dx) > .5 || Math.abs(scale - 1) > .005) {
          animations.current.push(element.animate([
            { transform: `translateX(${dx}px) scaleX(${scale})` },
            { transform: 'translateX(0) scaleX(1)' },
          ], { duration: 400, easing: 'cubic-bezier(.22,.61,.36,1)' }));
        }
      }
    });
    if (reduce) born.current = null;
    oldRects.current = nextRects;
  }, [visible, selected]);

  useEffect(() => () => { revision.current++; animations.current.forEach(animation => animation.cancel()); }, []);

  const choose = (symbol: string) => {
    revision.current++; setSearching(false); setError(null);
    capture();
    setCustom(previous => visitAsset(previous, symbol, Date.now()));
    onSelect(symbol);
  };
  const finish = async (symbol: string, current: number) => {
      const resolved = await prepare(symbol);
      if (current !== revision.current) return;
      if (!custom.some(item => item.symbol === resolved)) admit(resolved);
      else { capture(); setCustom(previous => visitAsset(previous, resolved, Date.now())); }
      onSelect(resolved);
      setQuery('');
      chooser.current?.close(); setMatches([]);
  };
  const cancelChoice = () => {
    revision.current++; setSearching(false); setMatches([]); chooser.current?.close();
  };
  const chooseMatch = async (symbol: string) => {
    const current = ++revision.current;
    setSearching(true); setError(null);
    try { await finish(symbol, current); }
    catch (reason) {
      if (current === revision.current) { setError(reason instanceof Error ? reason.message : 'unavailable'); chooser.current?.close(); setMatches([]); }
    } finally { if (current === revision.current) setSearching(false); }
  };
  const search = async () => {
    const symbol = normalizeTicker(query);
    if (composing.current || searching || !query.trim()) return;
    if (!validTicker(symbol)) { setError('invalid_symbol'); return; }
    const current = ++revision.current;
    setSearching(true); setError(null);
    try {
      const options = await lookup(query.trim());
      if (current !== revision.current) return;
      if (options.length > 1) { setMatches(options); chooser.current?.showModal(); return; }
      await finish(options[0].symbol, current);
    } catch (reason) {
      if (current === revision.current) setError(reason instanceof Error ? reason.message : 'unavailable');
    } finally {
      if (current === revision.current) setSearching(false);
    }
  };

  const errorText = error === 'invalid_symbol' ? t.invalidSymbol : error === 'not_found' ? t.symbolNotFound : error === 'unsupported_instrument' ? t.unsupportedInstrument : error === 'no_history' ? t.noHistory : t.dataError;
  const chip = (symbol: string, measuring = false) => {
    return <div key={symbol} data-symbol={symbol} data-motion={measuring ? undefined : symbol} className={`asset-chip${selected === symbol ? ' selected' : ''}`}>
      <button type="button" className={`asset-pick${symbol.endsWith('.OF') ? ' fund-asset-pick' : /^\d{4,6}\.(SS|SZ|HK)$/.test(symbol) ? ' numeric-asset-pick' : ''}`} aria-label={symbol} aria-pressed={selected === symbol} tabIndex={measuring ? -1 : 0} onClick={measuring ? undefined : () => choose(symbol)} title={symbol}>{symbol.endsWith('.OF') ? symbol : symbol.replace(/\.(SS|SZ|HK)$/, '')}</button>

    </div>;
  };

  return <><div className="control-row adaptive-controls" ref={root}>
    <div className="asset-space" ref={space}>
      <div className="asset-strip" ref={strip} role="group" aria-label={t.instrument}>
        <span className="asset-background" data-motion="background" aria-hidden="true" />
        {custom.filter(item => visible.includes(item.symbol)).map(item => chip(item.symbol))}
      </div>
    </div>
    <form className="symbol-search" data-motion="search" ref={form} role="search" aria-busy={searching} onSubmit={event => { event.preventDefault(); void search(); }}>
      <input aria-label={t.symbolSearch} placeholder={t.symbolPlaceholder} value={query} maxLength={20} autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="search" aria-invalid={Boolean(error)}
        onCompositionStart={() => { composing.current = true; revision.current++; setSearching(false); setError(null); }}
        onCompositionEnd={event => { composing.current = false; setQuery(event.currentTarget.value); }}
        onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }}
        onChange={event => { revision.current++; setSearching(false); setError(null); setQuery(event.target.value); }} />
      <button type="submit" aria-label={searching ? t.loading : t.search} disabled={searching || !query.trim()}>
        {searching ? <svg className="search-spinner" width="17" height="17" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="32 12" /></svg> : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>}
      </button>
      {error && <span className="symbol-error" role="alert">{errorText}</span>}
    </form>
    <div className="asset-strip measure-strip" ref={probe} aria-hidden="true">{custom.map(item => chip(item.symbol, true))}</div>
  </div>
    <dialog ref={chooser} className="asset-choice" aria-labelledby="asset-choice-title" onCancel={event => { event.preventDefault(); cancelChoice(); }} onClick={event => { if (event.target === chooser.current) cancelChoice(); }}>
      <div className="asset-choice-header"><h2 id="asset-choice-title">{t.chooseInstrument}</h2><button type="button" className="icon-button" aria-label={t.close} onClick={cancelChoice}>×</button></div>
      <div className="asset-choice-options">{matches.map(match => <button key={match.symbol} type="button" disabled={searching} onClick={() => void chooseMatch(match.symbol)}>
        <span className="asset-choice-kind">{match.kind === 'fund' ? t.fundType : t.securityType}</span>
        <span className="asset-choice-name"><strong>{match.name || match.symbol}</strong>{match.name && match.name !== match.symbol && <small>{match.symbol}</small>}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </button>)}</div>
    </dialog>
  </>;
}
