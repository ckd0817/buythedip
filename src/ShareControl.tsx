import { useEffect, useRef, useState } from 'react';
import type { EtfData } from './types';
import type { Language } from './i18n';
import { cleanQuote, pickQuote, shareLink } from './shareQuotes';
import type { CardInput } from './shareCard';

const copy = {
  zh: { share: '分享', title: '分享卡片', close: '关闭', shuffle: '换一句', custom: '自定义文字', addText: '添加文字', image: '保存图片', link: '复制链接', copied: '已复制', loading: '正在生成', error: '生成失败，请重试', retry: '重试', copyError: '复制失败，请手动复制', shareError: '分享未完成，可保存图片或复制链接', url: '网站链接' },
  en: { share: 'Share', title: 'Share card', close: 'Close', shuffle: 'Another quote', custom: 'Custom text', addText: 'Add text', image: 'Save image', link: 'Copy link', copied: 'Copied', loading: 'Generating', error: 'Could not generate image. Please retry.', retry: 'Retry', copyError: 'Could not copy. Select and copy the link.', shareError: 'Sharing did not finish. Save the image or copy the link.', url: 'Website link' },
};
type Props = { instrument?: EtfData; score: number | null; language: Language };

export default function ShareControl({ instrument, score, language }: Props) {
  const t = copy[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const [card, setCard] = useState<CardInput | null>(null);
  const [textEnabled, setTextEnabled] = useState(true);
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [building, setBuilding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [problem, setProblem] = useState<'image' | 'copy' | 'share' | null>(null);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const limit = language === 'zh' ? 28 : 80;
  const count = Array.from(card?.quote ?? '').length;
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!card) return;
    let active = true;
    setBuilding(true); setProblem(null);
    import('./shareCard').then(module => module.renderShareCard({ ...card, quote: textEnabled ? card.quote.trim() : '' })).then(blob => {
      if (!active) return;
      setImage(previous => { if (previous) URL.revokeObjectURL(previous.url); return { blob, url: URL.createObjectURL(blob) }; });
    }).catch(() => { if (active) setProblem('image'); }).finally(() => { if (active) setBuilding(false); });
    return () => { active = false; };
  }, [card, textEnabled, attempt]);
  const currentImage = useRef(image); currentImage.current = image;
  useEffect(() => () => { if (currentImage.current) URL.revokeObjectURL(currentImage.current.url); clearTimeout(copiedTimer.current); }, []);
  useEffect(() => {
    if (!card) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [Boolean(card)]);

  const open = () => {
    if (!instrument || score == null) return;
    const quote = pickQuote(score);
    setTextEnabled(true); setCopied(false); setProblem(null); setBuilding(true);
    setCard({ instrument, score, language, quote: quote[language], url: shareLink(location.origin, instrument.symbol) });
    dialog.current?.showModal();
  };
  const close = () => {
    dialog.current?.close(); setCard(null); setImage(previous => { if (previous) URL.revokeObjectURL(previous.url); return null; });
    setBuilding(false); setSharing(false); clearTimeout(copiedTimer.current);
  };
  const shuffle = () => {
    if (!card) return;
    const quote = pickQuote(card.score);
    setBuilding(true); setCard({ ...card, quote: quote[language] });
  };
  const save = () => {
    if (!image || !card || building || problem === 'image') return;
    const a = document.createElement('a'); a.href = image.url;
    a.download = `buythedip-${card.instrument.symbol}-${card.instrument.date}.png`;
    document.body.append(a); a.click(); a.remove();
  };
  const copyLink = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.writeText(card.url); setCopied(true); setProblem(previous => previous === 'image' ? previous : null);
      clearTimeout(copiedTimer.current); copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setProblem('copy'); }
  };
  const nativeShare = async () => {
    if (!card || !image || building) return;
    const file = new File([image.blob], `buythedip-${card.instrument.symbol}.png`, { type: 'image/png' });
    setSharing(true); setProblem(null);
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${card.instrument.symbol} · ${card.score.toFixed(1)}`, text: textEnabled ? card.quote.trim() : '', url: card.url });
      } else if (navigator.share) {
        await navigator.share({ title: `${card.instrument.symbol} · ${card.score.toFixed(1)}`, text: textEnabled ? card.quote.trim() : '', url: card.url });
      }
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setProblem('share'); }
    finally { setSharing(false); }
  };

  return <>
    <button className="share-trigger info-button" aria-label={t.share} title={t.share} disabled={!instrument || score == null} onClick={open}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3m-4 4 4-4 4 4M7 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2" /></svg><span>{t.share}</span>
    </button>
    <dialog ref={dialog} className="share-dialog" aria-labelledby="share-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === dialog.current) close(); }}>
      <div className="share-dialog-header"><h2 id="share-title">{t.title}</h2><button className="icon-button" aria-label={t.close} onClick={close}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
      {card && <div className="share-content">
        <div className="share-stage"><div className="share-preview" aria-busy={building}>
          {image && <img src={image.url} width="1080" height="1920" alt={`${card.instrument.symbol} ${t.title}`} />}
          {building && <span className="share-progress" role="status">{t.loading}</span>}
          {problem === 'image' && <div className="share-generate-error" role="alert"><span>{t.error}</span><button onClick={() => setAttempt(value => value + 1)}>{t.retry}</button></div>}
        </div>
        </div>
        <div className="share-editor">
          <div className="share-text-toggle"><span id="add-text-label">{t.addText}</span><button className="share-switch" role="switch" aria-labelledby="add-text-label" aria-checked={textEnabled} onClick={() => { setBuilding(true); setTextEnabled(value => !value); }}><span /></button></div>
          {textEnabled && <div className="share-text-fields">
          <div className="share-field-title"><label htmlFor="share-quote">{t.custom}</label><button className="share-shuffle" onClick={shuffle}>{t.shuffle}</button></div>
          <textarea id="share-quote" rows={3} value={card.quote} aria-describedby="quote-count" onChange={event => { setBuilding(true); setCard({ ...card, quote: cleanQuote(event.target.value, limit) }); }} />
          <span id="quote-count" className="share-count">{count} / {limit}</span>
          </div>}
          <div className="share-link-row">
            <a href={card.url} title={card.url} target="_blank" rel="noreferrer"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m10 14 4-4m-7 1-3 3a4 4 0 0 0 6 6l3-3m-2-10 3-3a4 4 0 0 1 6 6l-3 3" /></svg><span>{card.url}</span></a>
            <button onClick={() => void copyLink()}>{copied ? t.copied : t.link}</button>
          </div>
          <div className="share-actions">
            <button className="share-primary" onClick={save} disabled={building || !image || problem === 'image'}>{t.image}</button>
            {typeof navigator.share === 'function' && <button onClick={() => void nativeShare()} disabled={building || sharing || !image || problem === 'image'}>{t.share}</button>}
          </div>
          {problem && problem !== 'image' && <p className="share-action-error" role="alert">{problem === 'copy' ? t.copyError : t.shareError}</p>}
        </div>
      </div>}
    </dialog>
  </>;
}
