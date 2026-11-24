import { wireCommon } from './shared';
import { SUPPORT } from './support-config';
import './download.css';
import './support.css';

wireCommon();

// payment methods: show only the ones with a link
type Method = 'githubSponsors' | 'paystack' | 'flutterwave';
document.querySelectorAll<HTMLElement>('[data-method]').forEach((card) => {
  const m = card.dataset.method as Method;
  const url = SUPPORT[m];
  if (!url) card.remove();
  else card.querySelector<HTMLAnchorElement>('[data-link]')!.href = url;
});
const methods = document.getElementById('s-methods')!;
methods.dataset.count = String(methods.children.length);

document.querySelectorAll<HTMLAnchorElement>('[data-repo-link]').forEach((a) => (a.href = SUPPORT.repoUrl + (a.dataset.repoLink ?? '')));

document.getElementById('s-share')?.addEventListener('click', async (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  const data = { title: 'Vipad', text: 'Vipad — a free, private audio recorder and editor for every device.', url: location.origin + '/' };
  try {
    if (navigator.share) await navigator.share(data);
    else {
      await navigator.clipboard.writeText(data.url);
      btn.querySelector('span')!.textContent = 'Link copied — paste it anywhere.';
    }
  } catch { /* share sheet closed */ }
});

// business enquiry: email when an inbox is configured, otherwise a pre-filled GitHub issue
const form = document.getElementById('s-form') as HTMLFormElement;
const err = document.getElementById('s-form-err')!;
const note = document.getElementById('s-form-note')!;
note.textContent = SUPPORT.businessEmail
  ? 'Opens your email app with the enquiry ready to send.'
  : 'Opens a pre-filled enquiry on GitHub (free account needed). Prefer email? Say so in the message.';

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(form);
  const get = (k: string) => String(f.get(k) ?? '').trim();
  const missing = (['name', 'org', 'email', 'message'] as const).filter((k) => !get(k));
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(get('email'));
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  if (missing.length || !emailOk) {
    for (const k of missing) form.elements.namedItem(k) && (form.elements.namedItem(k) as HTMLElement).setAttribute('aria-invalid', 'true');
    if (!emailOk) (form.elements.namedItem('email') as HTMLElement).setAttribute('aria-invalid', 'true');
    err.textContent = missing.length ? 'Please fill in every field marked above.' : 'Please enter a valid email address.';
    err.hidden = false;
    form.querySelector<HTMLElement>('[aria-invalid]')?.focus();
    return;
  }
  err.hidden = true;
  const subject = `Sponsorship enquiry — ${get('org')}`;
  const body = [
    `Name: ${get('name')}`,
    `Organisation: ${get('org')}`,
    `Email: ${get('email')}`,
    `Type: ${get('kind')}`,
    `Budget: ${get('budget') || 'Not specified'}`,
    '',
    get('message'),
  ].join('\n');
  const url = SUPPORT.businessEmail
    ? `mailto:${SUPPORT.businessEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : `${SUPPORT.issueUrl}?title=${encodeURIComponent(subject)}&labels=sponsorship&body=${encodeURIComponent(body)}`;
  if (SUPPORT.businessEmail) location.href = url;
  else window.open(url, '_blank', 'noopener');
  note.textContent = 'Thanks! Finish sending it in the window that opened.';
});
