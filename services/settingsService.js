import { loadSession } from './authService.js';

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || 'Settings request failed.');
    error.status = response.status;
    throw error;
  }

  return payload;
};

const authHeaders = () => {
  const session = loadSession();
  if (!session?.token) {
    throw new Error('Authentication required.');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.token}`,
  };
};

export const fetchSettingsProfile = async () => {
  const response = await fetch('/api/settings/profile', {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};

export const updateSettingsProfile = async (payload) => {
  const response = await fetch('/api/settings/profile', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
};

export const updateSettingsPreferences = async (payload) => {
  const response = await fetch('/api/settings/preferences', {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
};

export const updateSettingsPassword = async ({ currentPassword, nextPassword }) => {
  const response = await fetch('/api/settings/password', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ currentPassword, nextPassword }),
  });
  return parseResponse(response);
};
