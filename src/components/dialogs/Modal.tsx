import { ReactNode, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
}

export function Modal({ title, subtitle, onClose, children, footer, wide, icon }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, button:not(.modal-x), [tabindex]');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, input, select, a[href], [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const a = f[0];
        const z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { z.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === z) { a.focus(); e.preventDefault(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}>
        <header className="modal-head">
          {icon && <div className="modal-icon">{icon}</div>}
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
