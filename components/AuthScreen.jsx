import React, { useMemo, useState } from 'react';
import { Icons } from './Icons';
import { loginUser, saveSession, signupUser } from '../services/authService.js';

const initialSignupState = {
  name: '',
  email: '',
  password: '',
  confirmPassword: '',
  walletAddress: '',
};

const initialLoginState = {
  email: '',
  password: '',
};

export const AuthScreen = ({ onAuthenticated }) => {
  const [mode, setMode] = useState('login');
  const [signupForm, setSignupForm] = useState(initialSignupState);
  const [loginForm, setLoginForm] = useState(initialLoginState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');

  const title = useMemo(
    () => (mode === 'login' ? 'Welcome back' : 'Create account'),
    [mode]
  );

  const subtitle = useMemo(
    () =>
      mode === 'login'
        ? 'Login to access parcel analytics and land intelligence reports.'
        : 'Register a new user and anchor signup in the blockchain audit chain.',
    [mode]
  );

  const onSignupChange = (field, value) => {
    setSignupForm((prev) => ({ ...prev, [field]: value }));
  };

  const onLoginChange = (field, value) => {
    setLoginForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorText('');
    setIsSubmitting(true);

    try {
      if (mode === 'signup') {
        if (!signupForm.name.trim()) {
          throw new Error('Name is required.');
        }

        if (!signupForm.email.trim()) {
          throw new Error('Email is required.');
        }

        if (signupForm.password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }

        if (signupForm.password !== signupForm.confirmPassword) {
          throw new Error('Passwords do not match.');
        }

        const payload = await signupUser({
          name: signupForm.name.trim(),
          email: signupForm.email.trim(),
          password: signupForm.password,
          walletAddress: signupForm.walletAddress.trim(),
        });

        const session = { token: payload.token, user: payload.user };
        saveSession(session);
        onAuthenticated(session);
      } else {
        if (!loginForm.email.trim() || !loginForm.password) {
          throw new Error('Email and password are required.');
        }

        const payload = await loginUser({
          email: loginForm.email.trim(),
          password: loginForm.password,
        });

        const session = { token: payload.token, user: payload.user };
        saveSession(session);
        onAuthenticated(session);
      }
    } catch (error) {
      setErrorText(error?.message || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(900px_500px_at_10%_0%,rgba(16,95,65,0.15),transparent_55%),radial-gradient(1000px_560px_at_90%_0%,rgba(15,125,182,0.17),transparent_60%)] px-4 py-8">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="panel-surface rounded-3xl border border-white/70 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.11)]">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-brand-700">
            <Icons.Shield className="h-3.5 w-3.5" />
            Secure Access
          </p>
          <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-slate-900">
            Land & Property Intelligence Platform
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-600">
            AI-driven NDVI insights, map-based parcel validation, and blockchain-backed historical records for
            transparent land governance.
          </p>

          <div className="mt-8 space-y-3">
            {[
              'Satellite-based NDVI analysis with map parcel selection',
              'Tamper-evident user audit events recorded in auth blockchain log',
              'Secure backend session management with JWT authentication',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <span className="mt-0.5 grid h-6 w-6 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                  <Icons.Verified className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm text-slate-700">{item}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel-surface rounded-3xl border border-white/70 p-7 shadow-[0_24px_60px_rgba(15,23,42,0.11)] sm:p-8">
          <div className="mb-6 flex items-center rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorText('');
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                mode === 'login' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorText('');
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                mode === 'signup' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Sign Up
            </button>
          </div>

          <h2 className="font-display text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-2 text-sm text-slate-600">{subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Full name</span>
                <div className="relative">
                  <input
                    type="text"
                    value={signupForm.name}
                    onChange={(event) => onSignupChange('name', event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pl-10 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    placeholder="Samarth Singh"
                  />
                  <Icons.User className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                </div>
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Email</span>
              <div className="relative">
                <input
                  type="email"
                  value={mode === 'signup' ? signupForm.email : loginForm.email}
                  onChange={(event) =>
                    mode === 'signup'
                      ? onSignupChange('email', event.target.value)
                      : onLoginChange('email', event.target.value)
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pl-10 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  placeholder="you@example.com"
                />
                <Icons.Mail className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Password</span>
              <div className="relative">
                <input
                  type="password"
                  value={mode === 'signup' ? signupForm.password : loginForm.password}
                  onChange={(event) =>
                    mode === 'signup'
                      ? onSignupChange('password', event.target.value)
                      : onLoginChange('password', event.target.value)
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pl-10 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  placeholder="Minimum 6 characters"
                />
                <Icons.Key className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              </div>
            </label>

            {mode === 'signup' && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Confirm password
                  </span>
                  <div className="relative">
                    <input
                      type="password"
                      value={signupForm.confirmPassword}
                      onChange={(event) => onSignupChange('confirmPassword', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pl-10 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      placeholder="Re-enter password"
                    />
                    <Icons.Key className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                  </div>
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Wallet address (optional)
                  </span>
                  <div className="relative">
                    <input
                      type="text"
                      value={signupForm.walletAddress}
                      onChange={(event) => onSignupChange('walletAddress', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 pl-10 font-mono text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      placeholder="0x..."
                    />
                    <Icons.Wallet className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
                  </div>
                </label>
              </>
            )}

            {errorText && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorText}</p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Icons.Spinner className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  {mode === 'login' ? <Icons.LogIn className="h-4 w-4" /> : <Icons.UserPlus className="h-4 w-4" />}
                  {mode === 'login' ? 'Login' : 'Create Account'}
                </>
              )}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
