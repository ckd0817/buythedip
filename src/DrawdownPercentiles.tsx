import { useEffect, useRef, useState } from 'react';
import { messages, type Language } from './i18n';
import { keyPercentiles, quantileScalePosition } from './quantileScale';

const formatDepth = (value: number | undefined) => value == null ? '—' : `${value > 0 ? '−' : ''}${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < .01 ? 4 : 2 })}%`;

export default function DrawdownPercentiles({ values, score, language }: { values?: number[] | null; score: number | null; language: Language }) {
  const t = messages[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const currentRow = useRef<HTMLTableRowElement>(null);
  const [open, setOpen] = useState(false);
  const available = values?.length === 101 && values.every(value => Number.isFinite(value) && value >= 0);
  const position = score == null ? null : Math.min(100, Math.max(0, score));
  const nearest = position == null ? null : Math.round(position);
  const rulerPosition = position == null ? null : quantileScalePosition(position);
  const close = () => { dialog.current?.close(); setOpen(false); };

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    currentRow.current?.scrollIntoView({ block: 'center', behavior: 'auto' });
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return <section className="drawdown-quantiles" aria-labelledby="drawdown-quantiles-title">
    <div className="quantile-heading"><h2 id="drawdown-quantiles-title">{t.drawdownQuantiles}</h2><button type="button" disabled={!available} onClick={() => { dialog.current?.showModal(); setOpen(true); }}>{t.allQuantiles}<span aria-hidden="true"> ›</span></button></div>
    <div className="quantile-ruler" role="img" aria-label={`${t.index} ${score == null ? '—' : score.toFixed(1)}`}>
      <span className="quantile-ruler-ticks" aria-hidden="true">{keyPercentiles.map(percentile => <i key={percentile} className={available && position != null && percentile <= position ? 'reached' : ''} />)}</span>
      {available && rulerPosition != null && <><span className="quantile-ruler-fill" style={{ width: `${rulerPosition}%` }} /><span className="quantile-ruler-marker" style={{ left: `${rulerPosition}%` }} /></>}
    </div>
    <dl className="quantile-key-values">{keyPercentiles.map(percentile => <div key={percentile} className={available && nearest === percentile ? 'at-current' : ''}><dt>P{percentile}</dt><dd>{available ? formatDepth(values[percentile]) : '—'}</dd></div>)}</dl>
    <dialog ref={dialog} className="quantile-dialog" aria-labelledby="all-quantiles-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <div className="quantile-dialog-heading"><h2 id="all-quantiles-title">{t.drawdownQuantiles}</h2><button type="button" className="icon-button" aria-label={t.close} onClick={close}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
      <div className="quantile-table-scroll"><table><thead><tr><th scope="col">{t.percentile}</th><th scope="col">{t.drawdownMagnitude}</th></tr></thead><tbody>{available && values.map((value, percentile) => <tr key={percentile} ref={nearest === percentile ? currentRow : undefined} className={nearest === percentile ? 'at-current' : ''}><th scope="row">P{percentile}</th><td>{formatDepth(value)}</td></tr>)}</tbody></table></div>
    </dialog>
  </section>;
}
