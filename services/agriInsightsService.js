import { loadSession } from './authService.js';
import { buildApiUrl, parseJsonResponse } from './apiClient.js';

export const fetchAgricultureInsights = async ({ coords, ndviStats }) => {
  const session = loadSession();
  const response = await fetch(buildApiUrl('/api/agri/insights'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify({ coords, ndviStats }),
  });

  return parseJsonResponse(response, 'Failed to generate agricultural insights.');
};

export const fetchAgricultureHistory = async () => {
  const session = loadSession();
  if (!session?.token) {
    throw new Error('Authentication required to load agriculture history.');
  }

  const response = await fetch(buildApiUrl('/api/agri/insights/history'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  });

  return parseJsonResponse(response, 'Failed to load agriculture history.');
};
