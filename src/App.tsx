import { useState } from 'react';

import { useStore } from './hooks/useStore';
import { initialRoute } from './lib/initialRoute';
import { monitor } from './session/MonitorSession';
import { receiver } from './session/ReceiverSession';

import { Landing } from './ui/Landing';
import { ReturnView } from './ui/ReturnView';
import { MonitorSetup } from './ui/monitor/MonitorSetup';
import { MonitorWaitPassphrase } from './ui/monitor/MonitorWaitPassphrase';
import { MonitorWaitLink } from './ui/monitor/MonitorWaitLink';
import { MonitorActive } from './ui/monitor/MonitorActive';
import { ReceiverSetup } from './ui/receiver/ReceiverSetup';
import { ReceiverReply } from './ui/receiver/ReceiverReply';
import { ReceiverActive } from './ui/receiver/ReceiverActive';

type Role = 'landing' | 'monitor' | 'receiver' | 'return';

/** An invite link drops the visitor straight onto the listening screen. */
function initialRole(): Role {
  if (initialRoute?.kind === 'i') return 'receiver';
  if (initialRoute?.kind === 'r') return 'return';
  return 'landing';
}

function MonitorRole({ onBack }: { onBack: () => void }) {
  const snapshot = useStore(monitor);

  switch (snapshot.phase) {
    case 'active':
      return <MonitorActive snapshot={snapshot} onExit={onBack} />;
    case 'waiting':
      return <MonitorWaitPassphrase snapshot={snapshot} onExit={onBack} />;
    case 'invite':
      return <MonitorWaitLink snapshot={snapshot} onExit={onBack} />;
    case 'idle':
      return <MonitorSetup onBack={onBack} />;
  }
}

function ReceiverRole({ onBack, pendingInvite }: { onBack: () => void; pendingInvite: string | null }) {
  const snapshot = useStore(receiver);

  switch (snapshot.phase) {
    case 'active':
      return <ReceiverActive snapshot={snapshot} onExit={onBack} />;
    case 'reply':
      return <ReceiverReply snapshot={snapshot} onExit={onBack} />;
    case 'idle':
      return <ReceiverSetup onBack={onBack} pendingInvite={pendingInvite} fatalError={snapshot.error} />;
  }
}

export function App() {
  const [role, setRole] = useState<Role>(initialRole);
  const goLanding = () => setRole('landing');

  return (
    <div className="app">
      {role === 'landing' ? (
        <Landing onBeMonitor={() => setRole('monitor')} onBeReceiver={() => setRole('receiver')} />
      ) : null}

      {role === 'monitor' ? <MonitorRole onBack={goLanding} /> : null}

      {role === 'receiver' ? (
        <ReceiverRole
          onBack={goLanding}
          pendingInvite={initialRoute?.kind === 'i' ? initialRoute.blob : null}
        />
      ) : null}

      {role === 'return' && initialRoute?.kind === 'r' ? <ReturnView blob={initialRoute.blob} /> : null}
    </div>
  );
}
