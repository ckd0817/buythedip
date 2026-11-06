import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { Metric, EtfData, SearchMatch } from './types';
import { indexScore } from './indexScore';
import AssetControls from './AssetControls';
import ShareControl from './ShareControl';
import DrawdownPercentiles from './DrawdownPercentiles';
import { normalizeTicker, validTicker } from './customAssets';
import { defaults, pricePrefix } from './instruments';
import { initialLanguage, LANGUAGE_KEY, messages, type Language } from './i18n';

const History = lazy(() => import('./History'));
const fmt = (value: number | null | undefined, digits = 1) => value == null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value: number | null | undefined) => value == null ? '—' : `${value < 0 ? '−' : value > 0 ? '+' : ''}${fmt(Math.abs(value))}%`;
const params = new URLSearchParams(window.location.search);
const requestedSymbol = normalizeTicker(params.get('etf') ?? 'QQQ');
const initialSymbol = validTicker(requestedSymbol) ? requestedSymbol : 'QQQ';

function Icon({ name }: { name: 'sun' | 'moon' | 'info' | 'close' }) {
  const paths = {
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    moon: <path d="M20.5 13.2A8.6 8.6 0 0 1 10.8 3.5 8.6 8.6 0 1 0 20.5 13.2Z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function MetricCard({ name, metric, percentileLabel, percent = false }: { name: string; metric?: Metric; percentileLabel: string; percent?: boolean }) {
  return <article className="metric-card">
    <h2>{name}</h2>
    <div className="metric-value">{percent ? signed(metric?.value) : fmt(metric?.value)}</div>
    <div className="metric-bottom"><span>{percentileLabel}</span><span>{metric?.percentile == null ? '—' : `${fmt(metric.percentile, 0)}%`}</span></div>
    <div className="metric-track" aria-hidden="true"><span style={{ width: `${metric?.percentile ?? 0}%` }} /></div>
  </article>;
}

export default function App() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = messages[language];
  const chooseLanguage = (next: Language) => {
    setLanguage(next);
    try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Keep the in-session preference. */ }
  };
  const [symbol, setSymbol] = useState(initialSymbol);
  const [dark, setDark] = useState(() => {
    try { const saved = localStorage.getItem('theme'); return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return matchMedia('(prefers-color-scheme: dark)').matches; }
  });
  const [instrument, setInstrument] = useState<EtfData | null>(null);
  const instrumentCache = useRef(new Map<string, EtfData>());
  const pendingData = useRef(new Map<string, Promise<EtfData>>());
  const loadInstrument = (value: string): Promise<EtfData> => {
    const cached = instrumentCache.current.get(value);
    if (cached) return Promise.resolve(cached);
    const pending = pendingData.current.get(value);
    if (pending) return pending;
    const path = defaults.includes(value) ? `data/${value}.json` : `api/market?symbol=${encodeURIComponent(value)}`;
    const promise = fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-cache' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'unavailable');
        if (!data || data.symbol !== value || !data.windows?.all) throw new Error('unavailable');
        if (data.kind !== 'security' && data.kind !== 'fund') throw new Error('unsupported_instrument');
        instrumentCache.current.set(value, data);
        instrumentCache.current.set(data.symbol, data);
        return data as EtfData;
      })
      .finally(() => { pendingData.current.delete(value); });
    pendingData.current.set(value, promise);
    return promise;
  };
  const chooseAsset = (value: string) => {
    const cached = instrumentCache.current.get(value);
    if (cached) setInstrument(cached);
    setSymbol(cached?.symbol ?? value);
  };
  const lookup = async (query: string): Promise<SearchMatch[]> => {
    if (!/^\d{6}$/.test(query)) {
      const value = normalizeTicker(query);
      return [{ symbol: value, name: value, kind: value.endsWith('.OF') ? 'fund' : 'security' }];
    }
    const response = await fetch(`${import.meta.env.BASE_URL}api/market?search=${encodeURIComponent(query)}`, { cache: 'no-cache' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'unavailable');
    if (!Array.isArray(result.candidates) || result.candidates.some((item: SearchMatch) => !validTicker(item.symbol) || item.symbol.slice(0, 6) !== query || !['security', 'fund'].includes(item.kind))) throw new Error('unavailable');
    if (!result.candidates.length) throw new Error('not_found');
    return result.candidates;
  };
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const historySection = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = t.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
  }, [language, t]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101114' : '#fafafa');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* Storage can be disabled. */ }
  }, [dark]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('etf', symbol);
    url.searchParams.delete('years');
    window.history.replaceState(null, '', url);
  }, [symbol]);

  useEffect(() => {
    let current = true;
    setError(null);
    const cached = instrumentCache.current.get(symbol);
    setInstrument(cached ?? null);
    if (!cached) {
      loadInstrument(symbol)
        .then(value => { if (current) { setInstrument(value); if (value.symbol !== symbol) setSymbol(value.symbol); } })
        .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'unavailable'); });
    }
    return () => { current = false; };
  }, [symbol, attempt]);

  useEffect(() => {
    if (!historySection.current) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setShowHistory(true); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(historySection.current);
    return () => observer.disconnect();
  }, []);

  const etf = instrument?.symbol === symbol ? instrument : undefined;
  const isIndex = false;
  const prefix = pricePrefix(etf?.kind, etf?.currency);
  const current = etf?.windows.all;
  const volatilitySymbol = etf?.volatilitySymbol ?? ({ SPY: 'VIX', QQQ: 'VXN', SMH: 'VXSMH' } as Record<string, string>)[symbol];
  const volatilityMetric = volatilitySymbol ? current?.volatility[volatilitySymbol] : undefined;
  const errorText = error === 'not_found' ? t.symbolNotFound : error === 'unsupported_fund' ? t.unsupportedFund : error === 'unsupported_instrument' ? t.unsupportedInstrument : error === 'no_history' ? t.noHistory : t.dataError;
  const score = indexScore(current?.index);

  return <>
    <section className={`first-screen${volatilitySymbol ? '' : ' two-indicators'}`} aria-label={t.overview}>
      <header className="header shell">
        <a className="wordmark" href="/" aria-label={t.home}><img className="brand-light" src={language === 'zh' ? '/logo.svg' : '/logo-en.svg'} alt={t.title} /><img className="brand-dark" src={language === 'zh' ? '/logo-dark.svg' : '/logo-en-dark.svg'} alt={t.title} /></a>
        <div className="header-actions">
          <button className="info-button" aria-label={t.methodology} onClick={() => dialog.current?.showModal()}><Icon name="info" /><span>{t.methodology}</span></button>
          <ShareControl instrument={etf} score={score} language={language} />
          <div className="language-select" role="group" aria-label={t.language}>
            {(['zh', 'en'] as const).map(lang => <button key={lang} lang={lang === 'zh' ? 'zh-CN' : 'en'} aria-label={lang === 'zh' ? '中文' : 'English'} aria-pressed={language === lang} className={language === lang ? 'selected' : ''} onClick={() => chooseLanguage(lang)}>{lang.toUpperCase()}</button>)}
          </div>
          <span className="header-divider" />
          <button className="icon-button" aria-label={dark ? t.switchLight : t.switchDark} title={dark ? t.light : t.dark} onClick={() => setDark(!dark)}><Icon name={dark ? 'sun' : 'moon'} /></button>
        </div>
      </header>

      <main className="overview shell">
        <AssetControls selected={symbol} confirmed={etf?.symbol} language={language} lookup={lookup} prepare={async value => (await loadInstrument(value)).symbol} onSelect={chooseAsset} />

        <div className="hero" aria-busy={!etf && !error}>
          <div className="hero-center">
            <h1>{t.index}</h1>
            <div className={`score ${!etf ? 'pending' : ''}`} key={symbol}><span>{fmt(score, 1)}</span></div>
          </div>
          <div className="headline">{score != null ? <>{t.headlineBefore}<span>{fmt(score, 1)}%</span>{t.headlineAfter}</> : error ? errorText : etf ? t.insufficient : t.loading}</div>
          {error && <button className="retry-button" onClick={() => setAttempt(a => a + 1)}>{t.retry}</button>}
          <div className="supporting supporting-left"><div className="supporting-label">{t.drawdown}</div><div className="supporting-value">{signed(etf?.drawdown)}</div></div>
          <div className="supporting supporting-right"><div className="supporting-label">{etf?.kind === 'fund' ? t.unitNav : isIndex ? t.indexClose : t.closePrice}</div><div className="supporting-value">{etf ? `${prefix}${fmt(etf.close, etf.kind === 'fund' ? 4 : 2)}` : '—'}</div></div>
        </div>

        <div key={`metrics-${symbol}`} className={`metrics${volatilitySymbol ? '' : ' two-metrics'}`} aria-label={t.auxiliary}>
          <MetricCard name={t.rsi} metric={current?.rsi} percentileLabel={t.percentile} />
          <MetricCard name={t.ma} metric={current?.ma} percentileLabel={t.percentile} percent />
          {volatilitySymbol && <MetricCard name={volatilitySymbol} metric={volatilityMetric} percentileLabel={t.percentile} />}
        </div>
        <DrawdownPercentiles key={`quantiles-${symbol}`} values={etf?.drawdownQuantiles} score={score} language={language} />
      </main>
    </section>

    <section className="history-section" ref={historySection} id="history" aria-label={t.history}>
      <div className="shell">
        {showHistory ? <Suspense fallback={<div className="chart-loading">{t.chartLoading}</div>}><History key={symbol} points={current?.chart ?? []} symbol={symbol} dark={dark} volatilitySymbol={volatilitySymbol} isIndex={isIndex} isFund={etf?.kind === 'fund'} pricePrefix={prefix} language={language} /></Suspense> : <div className="chart-loading" />}
      </div>
    </section>

    <dialog ref={dialog} className="explanation" aria-labelledby="explanation-title" onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="dialog-header"><h2 id="explanation-title">{t.calculations}</h2><button className="icon-button" aria-label={t.close} onClick={() => dialog.current?.close()}><Icon name="close" /></button></div>
      <div className="dialog-content">
        <h3>{t.index}</h3>
        <p>{etf?.kind === 'fund' ? t.fundIndexMethod : isIndex ? t.indexPointMethod : t.indexMethod}</p>
        <div className="formula">{etf?.kind === 'fund' ? t.fundIndexFormula : isIndex ? t.indexPointFormula : t.indexFormula}</div>
        <h3>{t.rsi}</h3>
        <p>{t.rsiMethod}</p>
        <div className="formula">{t.rsiFormula}</div>
        <h3>{t.ma}</h3>
        <p>{t.maMethod}</p>
        <div className="formula">{t.maFormula}</div>
        <h3>{t.volatilityIndex}</h3>
        <p>{t.volatilityMethod}</p>
        <div className="formula">{t.volatilityFormula}</div>
      </div>
    </dialog>
  </>;
}
