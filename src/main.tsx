import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Peer from 'peerjs';

import { App } from './App';
import { alarm } from './lib/audio';
import { peerIdFor } from './lib/crypto';
import { monitor } from './session/MonitorSession';
import { receiver } from './session/ReceiverSession';
import './styles/theme.css';

declare global {
  interface Window {
    /**
     * Handle for the end-to-end suite, which asserts on real RTP statistics and alarm state.
     * Shipped in production so the tests exercise the same bundle users get; it grants no
     * access that a script on this page would not already have.
     */
    __babyMonitor: { monitor: typeof monitor; receiver: typeof receiver; alarm: typeof alarm };
    /**
     * Only present with `?e2e` in the URL. Lets the suite pose as someone who has scraped the
     * broker ID but does not know the passphrase — the exact case the monitor's challenge
     * exists to reject, and one no ordinary client can reproduce.
     */
    __babyMonitorInternals?: { Peer: typeof Peer; peerIdFor: typeof peerIdFor };
  }
}

window.__babyMonitor = { monitor, receiver, alarm };

if (new URLSearchParams(location.search).has('e2e')) {
  window.__babyMonitorInternals = { Peer, peerIdFor };
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
