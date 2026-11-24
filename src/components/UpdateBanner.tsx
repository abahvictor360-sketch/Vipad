import { Download, RefreshCw, X, Sparkles } from 'lucide-react';
import { useUpdates, dismissUpdate, CURRENT } from '../app/updates';

/** "A new version is available" notification for installed apps and the web app. */
export function UpdateBanner() {
  const { available, swReady, applySw } = useUpdates();
  if (swReady && applySw) {
    return (
      <div className="update-banner" role="status" data-testid="update-banner">
        <Sparkles size={18} aria-hidden />
        <div className="ub-text">
          <strong>A new version of Vipad is ready</strong>
          <span>Your work is saved automatically — updating takes a second.</span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={applySw} data-testid="update-now"><RefreshCw size={14} /> Update now</button>
        <button className="icon-btn" aria-label="Remind me later" onClick={() => useUpdates.setState({ swReady: false })}><X size={16} /></button>
      </div>
    );
  }
  if (!available) return null;
  return (
    <div className="update-banner" role="status" data-testid="update-banner">
      <Sparkles size={18} aria-hidden />
      <div className="ub-text">
        <strong>Vipad {available.version} is available</strong>
        <span>You have v{CURRENT}. <a href={available.notesUrl} target="_blank" rel="noreferrer">What’s new</a></span>
      </div>
      <a className="btn btn-primary btn-sm" href={available.downloadUrl} target="_blank" rel="noreferrer" data-testid="update-download"><Download size={14} /> Download</a>
      <button className="icon-btn" aria-label="Skip this version" title="Not now" onClick={dismissUpdate}><X size={16} /></button>
    </div>
  );
}
