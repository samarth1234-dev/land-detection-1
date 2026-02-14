import { loadSession } from './authService.js';

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || 'Land claim request failed.');
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

export const fetchOwnedParcels = async (scope = '') => {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const response = await fetch(`/api/land/parcels${query}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};

export const fetchLandClaims = async (params = {}) => {
  const query = new URLSearchParams();
  if (params.scope) query.set('scope', params.scope);
  if (params.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const response = await fetch(`/api/land/claims${suffix}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};

export const submitLandClaim = async ({ pid, claimNote, polygon }) => {
  const response = await fetch('/api/land/claims', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pid, claimNote, polygon }),
  });
  return parseResponse(response);
};

export const reviewLandClaim = async ({ claimId, action, verifiedPid, reviewNote }) => {
  const response = await fetch(`/api/land/claims/${encodeURIComponent(claimId)}/review`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ action, verifiedPid, reviewNote }),
  });
  return parseResponse(response);
};

export const fetchLandSummary = async () => {
  const response = await fetch('/api/land/summary', {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseResponse(response);
};
