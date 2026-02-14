import { loadSession } from './authService.js';
import { buildApiUrl, parseJsonResponse } from './apiClient.js';

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
  const response = await fetch(buildApiUrl('/api/settings/profile'), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load settings profile.');
};

export const updateSettingsProfile = async (payload) => {
  const response = await fetch(buildApiUrl('/api/settings/profile'), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, 'Failed to update profile settings.');
};

export const updateSettingsPreferences = async (payload) => {
  const response = await fetch(buildApiUrl('/api/settings/preferences'), {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response, 'Failed to update preference settings.');
};

export const updateSettingsPassword = async ({ currentPassword, nextPassword }) => {
  const response = await fetch(buildApiUrl('/api/settings/password'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ currentPassword, nextPassword }),
  });
  return parseJsonResponse(response, 'Failed to update password.');
};
