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

export const fetchOwnedParcels = async (scope = '') => {
  const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
  const response = await fetch(buildApiUrl(`/api/land/parcels${query}`), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load parcel registry.');
};

export const fetchLandClaims = async (params = {}) => {
  const query = new URLSearchParams();
  if (params.scope) query.set('scope', params.scope);
  if (params.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const response = await fetch(buildApiUrl(`/api/land/claims${suffix}`), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load land claims.');
};

export const submitLandClaim = async ({ pid, claimNote, polygon }) => {
  const response = await fetch(buildApiUrl('/api/land/claims'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ pid, claimNote, polygon }),
  });
  return parseJsonResponse(response, 'Failed to submit land claim.');
};

export const reviewLandClaim = async ({ claimId, action, verifiedPid, reviewNote }) => {
  const response = await fetch(buildApiUrl(`/api/land/claims/${encodeURIComponent(claimId)}/review`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ action, verifiedPid, reviewNote }),
  });
  return parseJsonResponse(response, 'Failed to review claim.');
};

export const fetchLandSummary = async () => {
  const response = await fetch(buildApiUrl('/api/land/summary'), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load land summary.');
};

export const fetchLandBoundaries = async ({ includeRemoved = false } = {}) => {
  const query = includeRemoved ? '?includeRemoved=true' : '';
  const response = await fetch(buildApiUrl(`/api/land/boundaries${query}`), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to load boundary dataset.');
};

export const createLandBoundary = async ({ code, name, location, polygon }) => {
  const response = await fetch(buildApiUrl('/api/land/boundaries'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ code, name, location, polygon }),
  });
  return parseJsonResponse(response, 'Failed to create boundary.');
};

export const updateLandBoundary = async ({ boundaryId, code, name, location, polygon, status }) => {
  const response = await fetch(buildApiUrl(`/api/land/boundaries/${encodeURIComponent(boundaryId)}`), {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ code, name, location, polygon, status }),
  });
  return parseJsonResponse(response, 'Failed to update boundary.');
};

export const removeLandBoundary = async ({ boundaryId }) => {
  const response = await fetch(buildApiUrl(`/api/land/boundaries/${encodeURIComponent(boundaryId)}`), {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Failed to remove boundary.');
};
