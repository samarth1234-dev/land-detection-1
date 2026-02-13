import React, { useEffect, useMemo, useState } from 'react';
import { Icons } from './Icons';
import {
  fetchSettingsProfile,
  updateSettingsPassword,
  updateSettingsPreferences,
  updateSettingsProfile,
} from '../services/settingsService.js';

const layerOptions = [
  { value: 'SAT', label: 'Satellite' },
  { value: 'OSM', label: 'OpenStreetMap' },
];

const languageOptions = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
];

const defaultProfileForm = {
  name: '',
  email: '',
  walletAddress: '',
  organization: '',
  roleTitle: '',
  phone: '',
  preferredLanguage: 'en',
};

const defaultPrefForm = {
  defaultMapLayer: 'SAT',
  mapLat: '28.6139',
  mapLng: '77.2090',
  mapZoom: '12',
  notifyDisputeUpdates: true,
  notifyNdviReady: true,
  notifyWeeklyDigest: false,
};

const defaultPasswordForm = {
  currentPassword: '',
  nextPassword: '',
  confirmPassword: '',
};

export const SettingsPanel = ({ onUserUpdate }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [profileForm, setProfileForm] = useState(defaultProfileForm);
  const [prefForm, setPrefForm] = useState(defaultPrefForm);
  const [passwordForm, setPasswordForm] = useState(defaultPasswordForm);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lastLedger, setLastLedger] = useState(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError('');
      try {
        const payload = await fetchSettingsProfile();
        if (!active) return;
        const user = payload.user || {};
        const settings = payload.settings || {};
        const center = Array.isArray(settings.mapDefaultCenter) ? settings.mapDefaultCenter : [28.6139, 77.2090];
        setProfileForm({
          name: user.name || '',
          email: user.email || '',
          walletAddress: user.walletAddress || '',
          organization: settings.organization || '',
          roleTitle: settings.roleTitle || '',
          phone: settings.phone || '',
          preferredLanguage: settings.preferredLanguage || 'en',
        });
        setPrefForm({
          defaultMapLayer: settings.defaultMapLayer || 'SAT',
          mapLat: String(center[0]),
          mapLng: String(center[1]),
          mapZoom: String(settings.mapDefaultZoom ?? 12),
          notifyDisputeUpdates: settings.notifications?.disputeUpdates !== false,
          notifyNdviReady: settings.notifications?.ndviReady !== false,
          notifyWeeklyDigest: settings.notifications?.weeklyDigest === true,
        });
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load settings.');
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const resetAlerts = () => {
    setError('');
    setSuccess('');
  };

  const handleProfileChange = (key, value) => {
    setProfileForm((prev) => ({ ...prev, [key]: value }));
    resetAlerts();
  };

  const handlePrefChange = (key, value) => {
    setPrefForm((prev) => ({ ...prev, [key]: value }));
    resetAlerts();
  };

  const handlePasswordChange = (key, value) => {
    setPasswordForm((prev) => ({ ...prev, [key]: value }));
    resetAlerts();
  };

  const handleSaveProfile = async (event) => {
    event.preventDefault();
    if (!profileForm.name.trim()) {
      setError('Name is required.');
      return;
    }

    setIsSavingProfile(true);
    resetAlerts();
    try {
      const payload = await updateSettingsProfile({
        name: profileForm.name,
        walletAddress: profileForm.walletAddress,
        organization: profileForm.organization,
        roleTitle: profileForm.roleTitle,
        phone: profileForm.phone,
        preferredLanguage: profileForm.preferredLanguage,
      });
      if (payload?.user && onUserUpdate) {
        onUserUpdate(payload.user);
      }
      setLastLedger(payload?.ledgerBlock || null);
      setSuccess('Profile settings updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save profile settings.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSavePreferences = async (event) => {
    event.preventDefault();

    const lat = Number(prefForm.mapLat);
    const lng = Number(prefForm.mapLng);
    const zoom = Number(prefForm.mapZoom);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError('Map center must be valid latitude/longitude.');
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError('Map center coordinates are out of range.');
      return;
    }
    if (!Number.isFinite(zoom) || zoom < 3 || zoom > 18) {
      setError('Map zoom must be between 3 and 18.');
      return;
    }

    setIsSavingPrefs(true);
    resetAlerts();
    try {
      const payload = await updateSettingsPreferences({
        defaultMapLayer: prefForm.defaultMapLayer,
        mapDefaultCenter: [lat, lng],
        mapDefaultZoom: zoom,
        notifications: {
          disputeUpdates: prefForm.notifyDisputeUpdates,
          ndviReady: prefForm.notifyNdviReady,
          weeklyDigest: prefForm.notifyWeeklyDigest,
        },
      });

      const settings = payload?.settings;
      if (settings) {
        setPrefForm({
          defaultMapLayer: settings.defaultMapLayer || prefForm.defaultMapLayer,
          mapLat: String(settings.mapDefaultCenter?.[0] ?? lat),
          mapLng: String(settings.mapDefaultCenter?.[1] ?? lng),
          mapZoom: String(settings.mapDefaultZoom ?? zoom),
          notifyDisputeUpdates: settings.notifications?.disputeUpdates !== false,
          notifyNdviReady: settings.notifications?.ndviReady !== false,
          notifyWeeklyDigest: settings.notifications?.weeklyDigest === true,
        });
      }
      setLastLedger(payload?.ledgerBlock || null);
      setSuccess('Preference settings updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save preference settings.');
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    if (!passwordForm.currentPassword || !passwordForm.nextPassword) {
      setError('Both password fields are required.');
      return;
    }
    if (passwordForm.nextPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (passwordForm.nextPassword !== passwordForm.confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }

    setIsSavingPassword(true);
    resetAlerts();
    try {
      const payload = await updateSettingsPassword({
        currentPassword: passwordForm.currentPassword,
        nextPassword: passwordForm.nextPassword,
      });
      setPasswordForm(defaultPasswordForm);
      setLastLedger(payload?.ledgerBlock || null);
      setSuccess(payload?.message || 'Password updated.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to update password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const ledgerInfo = useMemo(() => {
    if (!lastLedger?.hash) return null;
    return `${lastLedger.hash.slice(0, 10)}...${lastLedger.hash.slice(-8)} (#${lastLedger.index})`;
  }, [lastLedger]);

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="panel-surface rounded-2xl px-6 py-5 text-center">
          <Icons.Spinner className="mx-auto h-6 w-6 animate-spin text-brand-600" />
          <p className="mt-3 text-sm text-slate-600">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {(error || success) && (
        <section className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error || success}
          {ledgerInfo && (
            <p className="mt-1 text-xs text-slate-600">Ledger: {ledgerInfo}</p>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">Account Profile</h3>
          <form className="mt-4 space-y-3" onSubmit={handleSaveProfile}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Name</label>
                <input
                  value={profileForm.name}
                  onChange={(event) => handleProfileChange('name', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Email</label>
                <input
                  value={profileForm.email}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Wallet Address</label>
                <input
                  value={profileForm.walletAddress}
                  onChange={(event) => handleProfileChange('walletAddress', event.target.value)}
                  placeholder="Optional wallet"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Preferred Language</label>
                <select
                  value={profileForm.preferredLanguage}
                  onChange={(event) => handleProfileChange('preferredLanguage', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {languageOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Organization</label>
                <input
                  value={profileForm.organization}
                  onChange={(event) => handleProfileChange('organization', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Role / Title</label>
                <input
                  value={profileForm.roleTitle}
                  onChange={(event) => handleProfileChange('roleTitle', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Phone</label>
              <input
                value={profileForm.phone}
                onChange={(event) => handleProfileChange('phone', event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </div>

            <button
              type="submit"
              disabled={isSavingProfile}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {isSavingProfile ? <Icons.Spinner className="h-4 w-4 animate-spin" /> : <Icons.User className="h-4 w-4" />}
              {isSavingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </article>

        <article className="panel-surface rounded-2xl p-5">
          <h3 className="font-display text-lg font-bold text-slate-900">Map & Notification Preferences</h3>
          <form className="mt-4 space-y-3" onSubmit={handleSavePreferences}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Default Map Layer</label>
                <select
                  value={prefForm.defaultMapLayer}
                  onChange={(event) => handlePrefChange('defaultMapLayer', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {layerOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Default Zoom</label>
                <input
                  type="number"
                  min={3}
                  max={18}
                  value={prefForm.mapZoom}
                  onChange={(event) => handlePrefChange('mapZoom', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Map Center Latitude</label>
                <input
                  value={prefForm.mapLat}
                  onChange={(event) => handlePrefChange('mapLat', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">Map Center Longitude</label>
                <input
                  value={prefForm.mapLng}
                  onChange={(event) => handlePrefChange('mapLng', event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-200 bg-white/80 p-3">
              <label className="flex items-center justify-between text-sm text-slate-700">
                <span>Dispute status updates</span>
                <input
                  type="checkbox"
                  checked={prefForm.notifyDisputeUpdates}
                  onChange={(event) => handlePrefChange('notifyDisputeUpdates', event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between text-sm text-slate-700">
                <span>NDVI completion alerts</span>
                <input
                  type="checkbox"
                  checked={prefForm.notifyNdviReady}
                  onChange={(event) => handlePrefChange('notifyNdviReady', event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between text-sm text-slate-700">
                <span>Weekly digest summary</span>
                <input
                  type="checkbox"
                  checked={prefForm.notifyWeeklyDigest}
                  onChange={(event) => handlePrefChange('notifyWeeklyDigest', event.target.checked)}
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={isSavingPrefs}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {isSavingPrefs ? <Icons.Spinner className="h-4 w-4 animate-spin" /> : <Icons.Settings className="h-4 w-4" />}
              {isSavingPrefs ? 'Saving...' : 'Save Preferences'}
            </button>
          </form>
        </article>
      </section>

      <section className="panel-surface rounded-2xl p-5">
        <h3 className="font-display text-lg font-bold text-slate-900">Security</h3>
        <form className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3" onSubmit={handleChangePassword}>
          <input
            type="password"
            value={passwordForm.currentPassword}
            onChange={(event) => handlePasswordChange('currentPassword', event.target.value)}
            placeholder="Current password"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <input
            type="password"
            value={passwordForm.nextPassword}
            onChange={(event) => handlePasswordChange('nextPassword', event.target.value)}
            placeholder="New password"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <input
            type="password"
            value={passwordForm.confirmPassword}
            onChange={(event) => handlePasswordChange('confirmPassword', event.target.value)}
            placeholder="Confirm new password"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="submit"
            disabled={isSavingPassword}
            className="md:col-span-3 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {isSavingPassword ? <Icons.Spinner className="h-4 w-4 animate-spin" /> : <Icons.Key className="h-4 w-4" />}
            {isSavingPassword ? 'Updating...' : 'Change Password'}
          </button>
        </form>
      </section>
    </div>
  );
};
