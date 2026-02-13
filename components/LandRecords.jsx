import React, { useState } from 'react';
import { Icons } from './Icons';

const MOCK_RECORDS = [
  { id: 'T-882190', owner: 'Green Valley Farms', location: '34.05N, 118.24W', size: '45.2 Ha', verified: true, date: '2023-10-12' },
  { id: 'T-882191', owner: 'Urban Dev Corp', location: '34.01N, 118.29W', size: '12.5 Ha', verified: true, date: '2023-10-15' },
  { id: 'T-882192', owner: 'Private Holding', location: '34.12N, 118.35W', size: '2.1 Ha', verified: false, date: '2023-11-01' },
  { id: 'T-882193', owner: 'State Reserve', location: '34.45N, 118.10W', size: '120.0 Ha', verified: true, date: '2023-11-05' },
  { id: 'T-882194', owner: 'AgriTech Industries', location: '35.01N, 119.50W', size: '67.8 Ha', verified: true, date: '2023-11-12' },
];

export const LandRecords = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredRecords = MOCK_RECORDS.filter(r => 
    r.owner.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h1 className="text-2xl font-bold text-slate-900">Land Registry Ledger</h1>
           <p className="text-slate-500">Immutable blockchain records of verified land parcels.</p>
        </div>
        <div className="relative">
          <input 
            type="text" 
            placeholder="Search by Owner or ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <Icons.Search className="w-5 h-5 text-slate-400 absolute left-3 top-2.5" />
        </div>
      </header>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
             <thead>
               <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-semibold">
                 <th className="px-6 py-4">Transaction ID</th>
                 <th className="px-6 py-4">Owner</th>
                 <th className="px-6 py-4">Coordinates</th>
                 <th className="px-6 py-4">Size</th>
                 <th className="px-6 py-4">Date Recorded</th>
                 <th className="px-6 py-4">Verification</th>
                 <th className="px-6 py-4 text-right">Actions</th>
               </tr>
             </thead>
             <tbody>
               {filteredRecords.length > 0 ? filteredRecords.map((record, index) => (
                 <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                   <td className="px-6 py-4">
                     <div className="flex items-center">
                        <Icons.Database className="w-4 h-4 text-brand-400 mr-2" />
                        <span className="font-mono text-sm text-slate-700">{record.id}</span>
                     </div>
                   </td>
                   <td className="px-6 py-4 font-medium text-slate-900">{record.owner}</td>
                   <td className="px-6 py-4 text-slate-500 text-sm">{record.location}</td>
                   <td className="px-6 py-4 text-slate-900">{record.size}</td>
                   <td className="px-6 py-4 text-slate-500 text-sm">{record.date}</td>
                   <td className="px-6 py-4">
                     {record.verified ? (
                       <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 border border-emerald-200">
                         <Icons.Verified className="w-3 h-3 mr-1" /> Verified
                       </span>
                     ) : (
                       <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                         <Icons.Alert className="w-3 h-3 mr-1" /> Pending
                       </span>
                     )}
                   </td>
                   <td className="px-6 py-4 text-right">
                     <button className="text-brand-600 hover:text-brand-800 font-medium text-sm">View Cert</button>
                   </td>
                 </tr>
               )) : (
                 <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                        No records found matching your search.
                    </td>
                 </tr>
               )}
             </tbody>
          </table>
        </div>
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex items-center justify-between text-sm text-slate-500">
          <span>Showing {filteredRecords.length} records</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50">Previous</button>
            <button className="px-3 py-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
};