import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useMenus, Item } from './MainMenu';

/** Classic desktop menu bar (File, Edit, … Window, Help), sharing its items with the ☰ menu. */
export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const menus = useMenus(open === 'File');
  const ref = useRef<HTMLDivElement>(null);
  const names = Object.keys(menus);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const i = names.indexOf(open);
        setOpen(names[(i + (e.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length]);
        setSub(null);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [open, names]);

  const run = (it: Exclude<Item, 'sep'>) => {
    if (it.disabled || !it.onClick) return;
    setOpen(null);
    it.onClick();
  };

  const renderItems = (items: Item[]) =>
    items.map((it, i) =>
      it === 'sep' ? (
        <li key={`s${i}`} className="mb-sep" role="separator" />
      ) : it.sub ? (
        <li key={it.label} className="mb-has-sub" onMouseEnter={() => setSub(it.label)}>
          <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === it.label} onClick={() => setSub(sub === it.label ? null : it.label)}>
            <span>{it.label}</span>
            <ChevronRight size={14} aria-hidden />
          </button>
          {sub === it.label && <ul className="mb-drop mb-flyout" role="menu">{renderItems(it.sub)}</ul>}
        </li>
      ) : (
        <li key={`${it.label}${i}`} onMouseEnter={() => setSub(null)}>
          <button role="menuitem" disabled={it.disabled} onClick={() => run(it)} data-testid={it.testId ? `mb-${it.testId}` : undefined}>
            <span>{it.label}</span>
            {it.shortcut && <kbd>{it.shortcut}</kbd>}
          </button>
        </li>
      ),
    );

  return (
    <div className="menubar" ref={ref} role="menubar" aria-label="Menu bar">
      {names.map((n) => (
        <div key={n} className="mb-top">
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === n}
            className={open === n ? 'on' : ''}
            onClick={() => { setOpen(open === n ? null : n); setSub(null); }}
            onMouseEnter={() => open && open !== n && (setOpen(n), setSub(null))}
            data-testid={`mb-${n}`}
          >
            {n}
          </button>
          {open === n && <ul className="mb-drop" role="menu" aria-label={n}>{renderItems(menus[n])}</ul>}
        </div>
      ))}
    </div>
  );
}
