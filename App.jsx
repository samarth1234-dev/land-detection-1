import React, { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { MapExplorer } from './components/MapExplorer.jsx';
import { LandRecords } from './components/LandRecords.jsx';
import { LandDisputes } from './components/LandDisputes.jsx';
import { SettingsPanel } from './components/SettingsPanel.jsx';
import { AppView } from './constants.js';
import { Icons } from './components/Icons.jsx';
import { AuthScreen } from './components/AuthScreen.jsx';
import { clearSession, fetchCurrentUser, loadSession, saveSession, verifyAuthChain } from './services/authService.js';

const viewMeta = {
  [AppView.DASHBOARD]: {
    title: 'Executive Dashboard',
    subtitle: 'Portfolio health, risk markers, and verification throughput.'
  },
  [AppView.EXPLORER]: {
    title: 'Geo-Explorer',
    subtitle: 'Search location, select parcel, and compute live NDVI.'
  },
  [AppView.RECORDS]: {
    title: 'Land Registry',
    subtitle: 'Blockchain-backed ownership and verification history.'
  },
  [AppView.DISPUTES]: {
    title: 'Land Disputes',
    subtitle: 'Case filing, review workflow, and tamper-evident updates.'
  },
  [AppView.SETTINGS]: {
    title: 'Settings',
    subtitle: 'Manage workspace preferences and integrations.'
  },
};

function App() {
  const [currentView, setCurrentView] = useState(AppView.DASHBOARD);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [session, setSession] = useState(() => loadSession());
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [chainInfo, setChainInfo] = useState({ valid: null, totalBlocks: 0 });

  useEffect(() => {
    const bootstrapAuth = async () => {
      const existingSession = loadSession();
      if (!existingSession?.token) {
        setSession(null);
        setIsAuthChecking(false);
        return;
      }

      try {
        const payload = await fetchCurrentUser(existingSession.token);
        setSession({
          token: existingSession.token,
          user: payload.user,
        });
      } catch (_error) {
        clearSession();
        setSession(null);
      } finally {
        setIsAuthChecking(false);
      }
    };

    bootstrapAuth();
  }, []);

  useEffect(() => {
    if (!session?.token) {
      setChainInfo({ valid: null, totalBlocks: 0 });
      return;
    }

    let isMounted = true;
    verifyAuthChain()
      .then((result) => {
        if (!isMounted) return;
        setChainInfo({
          valid: result.valid,
          totalBlocks: result.totalBlocks || 0,
        });
      })
      .catch(() => {
        if (!isMounted) return;
        setChainInfo({ valid: false, totalBlocks: 0 });
      });

    return () => {
      isMounted = false;
    };
  }, [session?.token]);

  const handleAuthenticated = (nextSession) => {
    setSession(nextSession);
    setCurrentView(AppView.DASHBOARD);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setSidebarOpen(false);
  };

  const handleSessionUserUpdate = (nextUser) => {
    setSession((previous) => {
      if (!previous?.token) return previous;
      const nextSession = {
        token: previous.token,
        user: nextUser,
      };
      saveSession(nextSession);
      return nextSession;
    });
  };

  const renderContent = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
        return <Dashboard />;
      case AppView.EXPLORER:
        return <MapExplorer />;
      case AppView.RECORDS:
        return <LandRecords />;
      case AppView.DISPUTES:
        return <LandDisputes />;
      case AppView.SETTINGS:
        return <SettingsPanel onUserUpdate={handleSessionUserUpdate} />;
      default:
        return <Dashboard />;
    }
  };

  if (isAuthChecking) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="panel-surface rounded-2xl px-6 py-5 text-center">
          <Icons.Spinner className="mx-auto h-6 w-6 animate-spin text-brand-600" />
          <p className="mt-3 text-sm text-slate-600">Checking secure session...</p>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  const activeMeta = viewMeta[currentView] || viewMeta[AppView.DASHBOARD];

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        currentView={currentView}
        onChangeView={setCurrentView}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        user={session.user}
        onLogout={handleLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="panel-surface border-b border-slate-200 px-4 py-3 lg:px-6">
          <div className="flex items-center justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 lg:hidden"
              >
                <Icons.Menu className="h-6 w-6" />
              </button>
              <div className="min-w-0">
                <h1 className="truncate font-display text-lg font-bold text-slate-900">{activeMeta.title}</h1>
                <p className="hidden truncate text-xs text-slate-500 md:block">{activeMeta.subtitle}</p>
              </div>
            </div>

            <div className="hidden items-center gap-2 md:flex">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
                <Icons.User className="h-3.5 w-3.5" />
                {session.user.name}
              </span>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  chainInfo.valid === true
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : chainInfo.valid === false
                      ? 'border-rose-200 bg-rose-50 text-rose-700'
                      : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                Chain: {chainInfo.valid === null ? 'checking' : chainInfo.valid ? 'valid' : 'issue'}
                {chainInfo.totalBlocks > 0 ? ` (${chainInfo.totalBlocks})` : ''}
              </span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto">{renderContent()}</main>
      </div>
    </div>
  );
}

export default App;
