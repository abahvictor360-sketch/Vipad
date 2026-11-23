import { wireCommon } from './shared';
import './download.css';
import './guide.css';

wireCommon();

// highlight the current section in the table of contents
const links = new Map([...document.querySelectorAll<HTMLAnchorElement>('.g-toc a[href^="#"]')].map((a) => [a.hash.slice(1), a]));
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.remove('on'));
      links.get(e.target.id)?.classList.add('on');
    }
  },
  { rootMargin: '-30% 0px -60% 0px' },
);
document.querySelectorAll('.guide-step').forEach((s) => io.observe(s));
