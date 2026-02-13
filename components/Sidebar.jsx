import React from 'react';
import { AppView } from '../constants';
import { Icons } from './Icons';

export const Sidebar = ({ currentView, onChangeView, isOpen, setIsOpen, user, onLogout }) => {
  const menuItems = [
    { id: AppView.DASHBOARD, label: 'Dashboard', icon: Icons.Dashboard, hint: 'Regional overview' },
    { id: AppView.EXPLORER, label: 'Geo-Explorer', icon: Icons.Map, hint: 'NDVI and parcel check' },
    { id: AppView.RECORDS, label: 'Land Registry', icon: Icons.Database, hint: 'Immutable records' },
    { id: AppView.SETTINGS, label: 'Settings', icon: Icons.Settings, hint: 'Platform preferences' },
  ];

  const initials = (user?.name || 'User')
    .trim()
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  return (
    <>
      <div
        className={`fixed inset-0 z-20 bg-slate-900/50 backdrop-blur-sm transition-opacity lg:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={() => setIsOpen(false)}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-30 w-72 transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="relative flex h-full flex-col overflow-hidden border-r border-slate-800 bg-slate-950 text-white">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_320px_at_0%_0%,rgba(23,126,180,0.25),transparent_65%),radial-gradient(380px_240px_at_100%_0%,rgba(46,142,87,0.25),transparent_62%)]" />

          <div className="relative flex h-16 items-center justify-between border-b border-slate-800/80 px-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-500 shadow-lg shadow-brand-900/40">
                <Icons.Leaf className="h-5 w-5" />
              </span>
              <div>
                <p className="font-display text-lg font-bold tracking-tight">TerraTrust AI</p>
                <p className="text-[11px] text-slate-400">Land Intelligence Suite</p>
              </div>
            </div>
            <button
              className="rounded-md p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white lg:hidden"
              onClick={() => setIsOpen(false)}
              aria-label="Close sidebar"
            >
              <Icons.Close className="h-5 w-5" />
            </button>
          </div>

          <div className="relative flex-1 space-y-6 px-4 py-5">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">System health</p>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Live
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-300">Satellite + registry services are responsive.</p>
            </div>

            <nav className="space-y-2">
              {menuItems.map((item) => {
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onChangeView(item.id);
                      setIsOpen(false);
                    }}
                    className={`group w-full rounded-xl border px-3 py-3 text-left transition ${
                      isActive
                        ? 'border-brand-400/40 bg-brand-500/20 shadow-lg shadow-brand-900/30'
                        : 'border-slate-800 bg-slate-900/70 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 grid h-9 w-9 place-items-center rounded-lg transition ${
                          isActive
                            ? 'bg-brand-500/30 text-brand-100'
                            : 'bg-slate-800 text-slate-300 group-hover:text-white'
                        }`}
                      >
                        <item.icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-slate-200'}`}>{item.label}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{item.hint}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="relative border-t border-slate-800 px-4 py-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-accent-500 font-bold text-white">
                    {initials || 'U'}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{user?.name || 'Authenticated User'}</p>
                    <p className="truncate text-xs text-slate-400">{user?.email || 'user@terratrust.local'}</p>
                  </div>
                </div>
                <Icons.Activity className="h-4 w-4 text-emerald-300" />
              </div>

              <button
                type="button"
                onClick={onLogout}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800/80 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700"
              >
                <Icons.LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
