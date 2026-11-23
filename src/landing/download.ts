import { wireCommon, currentOS, fetchRelease, mb } from './shared';
import './download.css';

wireCommon();

// highlight and lead with the visitor's system
const os = currentOS();
const card = document.querySelector<HTMLElement>(`.os-card[data-os="${os}"]`);
if (card) {
  card.classList.add('yours');
  card.insertAdjacentHTML('afterbegin', '<span class="your-system">Your system</span>');
  if (window.matchMedia('(max-width: 900px)').matches) card.parentElement?.prepend(card);
}

// live release info (version, date, file sizes)
fetchRelease().then((r) => {
  if (!r) return;
  document.getElementById('d-ver')!.textContent = `Version ${r.tag.replace(/^v/, '')}`;
  document.getElementById('d-date')!.textContent = `Released ${new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  document.querySelectorAll<HTMLElement>('[data-size-for]').forEach((el) => {
    const n = r.sizes[el.dataset.sizeFor!];
    if (n) el.textContent = el.closest('.dl-alt') ? `· ${mb(n)}` : `${mb(n)} · `;
  });
});
