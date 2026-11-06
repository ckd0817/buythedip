import { useEffect, useRef, useState } from 'react';

export function useScrollReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reveal = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true);
    }, { rootMargin: '0px 0px -96px 0px' });
    const reset = new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting && entry.boundingClientRect.top >= window.innerHeight)) {
        setVisible(false);
      }
    });
    reveal.observe(element);
    reset.observe(element);
    return () => { reveal.disconnect(); reset.disconnect(); };
  }, []);

  return { ref, className: `scroll-reveal${visible ? ' is-visible' : ''}` };
}
