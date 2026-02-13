import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar.jsx';
import { Dashboard } from './components/Dashboard.jsx';
import { MapExplorer } from './components/MapExplorer.jsx';
import { LandRecords } from './components/LandRecords.jsx';
import { AppView } from './constants.js';
import { Icons } from './components/Icons.jsx';

function App() {
  const [currentView, setCurrentView] = useState(AppView.DASHBOARD);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const renderContent = () => {
    switch (currentView) {
      case AppView.DASHBOARD:
        return <Dashboard />;
      case AppView.EXPLORER:
        return <MapExplorer />;
      case AppView.RECORDS:
        return <LandRecords />;
      case AppView.SETTINGS:
        return (
          <div className="flex items-center justify-center h-full text-slate-400">
             <div className="text-center">
               <Icons.Settings className="w-12 h-12 mx-auto mb-4 opacity-50" />
               <p>Settings panel under development.</p>
             </div>
          </div>
        );
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar 
        currentView={currentView} 
        onChangeView={setCurrentView} 
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden flex items-center justify-between bg-white border-b border-slate-200 px-4 py-3">
          <div className="flex items-center">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-md text-slate-600 hover:bg-slate-100"
            >
              <Icons.Menu className="w-6 h-6" />
            </button>
            <span className="ml-3 font-semibold text-slate-900">TerraTrust AI</span>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}

export default App;