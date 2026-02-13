import React from 'react';
import { AppView } from '../types';
import { Icons } from './Icons';

interface SidebarProps {
  currentView: AppView;
  onChangeView: (view: AppView) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, isOpen, setIsOpen }) => {
  const menuItems = [
    { id: AppView.DASHBOARD, label: 'Dashboard', icon: Icons.Dashboard },
    { id: AppView.EXPLORER, label: 'Geo-Explorer', icon: Icons.Map },
    { id: AppView.RECORDS, label: 'Land Registry', icon: Icons.Database },
    { id: AppView.SETTINGS, label: 'Settings', icon: Icons.Settings },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      <div 
        className={`fixed inset-0 z-20 bg-black/50 transition-opacity lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={() => setIsOpen(false)}
      />

      {/* Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-30 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-auto
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex h-16 items-center px-6 border-b border-slate-800 bg-slate-900">
          <Icons.Leaf className="w-6 h-6 text-accent-500 mr-3" />
          <span className="text-xl font-bold tracking-tight">ROOT</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onChangeView(item.id);
                setIsOpen(false);
              }}
              className={`flex w-full items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors
                ${currentView === item.id 
                  ? 'bg-brand-600 text-white shadow-lg shadow-brand-900/50' 
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }
              `}
            >
              <item.icon className="w-5 h-5 mr-3" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center p-3 rounded-lg bg-slate-800/50">
             <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-400 to-accent-500 flex items-center justify-center text-white font-bold">
               JD
             </div>
             <div className="ml-3 overflow-hidden">
               <p className="text-sm font-medium text-white truncate">John Doe</p>
               <p className="text-xs text-slate-400 truncate">Senior Surveyor</p>
             </div>
          </div>
        </div>
      </div>
    </>
  );
};
