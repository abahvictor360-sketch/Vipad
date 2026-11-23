import '@fontsource-variable/inter';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '../styles/tokens.css';
import './landing.css';

export const REPO = 'abahvictor360-sketch/Vipad';
export const RELEASES = `https://github.com/${REPO}/releases`;
export const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type OS = 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'web';
export const OS_NAMES: Record<OS, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iPhone & iPad', web: 'your browser' };

export function detectOS(ua: string, platform = '', touchPoints = 0): OS {
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || (/Mac/.test(platform) && touchPoints > 1)) return 'ios';
  if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';
  if (/mac/i.test(platform) || /mac os x/i.test(ua)) return 'mac';
  if (/cros/i.test(ua)) return 'web';
  if (/linux/i.test(platform) || /linux/i.test(ua)) return 'linux';
  return 'web';
}
export const currentOS = (): OS => {
  const forced = new URLSearchParams(location.search).get('os') as OS | null;
  return forced && forced in OS_NAMES ? forced : detectOS(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
};

export function wireCommon() {
  document.querySelectorAll<HTMLAnchorElement>('[data-asset]').forEach((a) => {
    a.href = `${RELEASES}/latest/download/${a.dataset.asset}`;
    a.rel = 'noopener';
  });
  const rl = document.getElementById('releases-link') as HTMLAnchorElement | null;
  if (rl) rl.href = RELEASES;
  const src = document.getElementById('source-link') as HTMLAnchorElement | null;
  if (src) src.href = `https://github.com/${REPO}`;
  const y = document.getElementById('year');
  if (y) y.textContent = String(new Date().getFullYear());

  const menuBtn = document.querySelector<HTMLButtonElement>('.menu-btn');
  const menu = document.getElementById('mobile-menu');
  if (menuBtn && menu) {
    menuBtn.addEventListener('click', () => {
      const open = menu.hasAttribute('hidden');
      menu.toggleAttribute('hidden', !open);
      menuBtn.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('menu-open', open);
    });
    menu.querySelectorAll('a').forEach((a) =>
      a.addEventListener('click', () => {
        menu.setAttribute('hidden', '');
        menuBtn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('menu-open');
      }),
    );
  }
  const nav = document.querySelector('.nav');
  const onScroll = () => nav?.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))), { threshold: 0.08 });
  document.querySelectorAll('.card, .h2, .platform-grid li, .faq details, .guide-step').forEach((el) => {
    el.classList.add('reveal');
    io.observe(el);
  });
}

export interface ReleaseInfo { tag: string; date: string; sizes: Record<string, number> }

/** Latest release metadata from the public GitHub API (best effort; the page works without it). */
export async function fetchRelease(): Promise<ReleaseInfo | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) return null;
    const j = await r.json();
    return { tag: j.tag_name, date: j.published_at, sizes: Object.fromEntries((j.assets ?? []).map((a: { name: string; size: number }) => [a.name, a.size])) };
  } catch {
    return null;
  }
}

export const mb = (n: number) => `${(n / 1048576).toFixed(n > 10 * 1048576 ? 0 : 1)} MB`;
