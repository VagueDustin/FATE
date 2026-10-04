import { Component } from 'react';
import { flushForCrash } from '../hotExit.js';

/**
 * Root error boundary (1.14.0, H3).
 *
 * Without one, any exception thrown while React renders unmounts the whole tree: the window goes
 * blank and stays that way, with every unsaved buffer gone from the screen and no way back short
 * of killing the app. This catches it and shows a recovery screen instead.
 *
 * Recovery leans on hot exit. As the error is caught, every dirty tab's backup is written at once
 * (flushForCrash; App registers the writer), so Reload brings the buffers back through the normal
 * startup restore, including whatever was typed since the last periodic backup. The screen says
 * plainly whether that copy was made.
 *
 * Closing the window from here must not hang: the quit walk that normally answers the main
 * process lived in the App that just unmounted. The boundary takes over 'request-close': with the
 * backups written it lets the window close (the next launch restores them); without them it asks
 * first.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, kept: 'saving' };
    this.flushed = null;
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('FATE hit an error it could not recover from:', error, info?.componentStack);
    this.flushed = flushForCrash();
    this.flushed.then((ok) => this.setState({ kept: ok ? 'saved' : 'failed' }));

    const api = window.electronAPI;
    api?.onRequestClose?.(async () => {
      const ok = await this.flushed;
      if (ok) {
        api.confirmedClose(true);
        return;
      }
      const discard = await api.confirmDiscard?.('Close FATE without your unsaved changes?').catch(() => true);
      api.confirmedClose(discard !== false);
    });
  }

  reload = () => {
    // The app's unsaved-changes guard went with it; nothing else should stand in the way.
    window.onbeforeunload = null;
    window.location.reload();
  };

  render() {
    const { error, kept } = this.state;
    if (!error) return this.props.children;

    const message = {
      saving: 'Keeping a copy of your unsaved changes…',
      saved: 'Any unsaved changes were kept, and they will be back in their tabs after you reload.',
      failed: "FATE couldn't keep a copy of your unsaved changes, so reloading loses them."
    }[kept];

    return (
      <div className="crash-screen" role="alert">
        <div className="crash-card">
          <h1 className="crash-title">FATE ran into a problem</h1>
          <p className="crash-text">{message}</p>
          <pre className="crash-detail">{String(error?.message || error)}</pre>
          <button type="button" className="btn btn-primary crash-reload" onClick={this.reload} autoFocus>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
