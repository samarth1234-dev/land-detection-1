import { loadSession } from './authService.js';

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || 'Agricultural insights request failed.');
    error.status = response.status;
    throw error;
  }

  return payload;
};

export const fetchAgricultureInsights = async ({ coords, ndviStats }) => {
  const session = loadSession();
  const response = await fetch('/api/agri/insights', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify({ coords, ndviStats }),
  });

  return parseResponse(response);
};

export const fetchAgricultureHistory = async () => {
  const session = loadSession();
  if (!session?.token) {
    throw new Error('Authentication required to load agriculture history.');
  }

  const response = await fetch('/api/agri/insights/history', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  });

  return parseResponse(response);
};
