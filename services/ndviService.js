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

export const searchLocation = async (query) => {
  const response = await fetch(buildApiUrl(`/api/geo/search?q=${encodeURIComponent(query)}`), {
    method: 'GET',
    headers: authHeaders(),
  });
  return parseJsonResponse(response, 'Location search failed.');
};

export const fetchCurrentNdvi = async ({ polygon, selectionBounds, daysBack = 180 }) => {
  const response = await fetch(buildApiUrl('/api/ndvi/current'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ polygon, selectionBounds, daysBack }),
  });
  return parseJsonResponse(response, 'Failed to compute current NDVI.');
};

export const fetchNdviTimeline = async ({ polygon, selectionBounds, years = 5 }) => {
  const response = await fetch(buildApiUrl('/api/ndvi/timeline'), {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ polygon, selectionBounds, years }),
  });
  return parseJsonResponse(response, 'Failed to compute NDVI timeline.');
};
