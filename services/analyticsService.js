import { loadSession } from './authService.js';

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || 'Analytics request failed.');
    error.status = response.status;
    throw error;
  }

  return payload;
};

export const fetchGovernanceAnalytics = async () => {
  const session = loadSession();
  if (!session?.token) {
    throw new Error('Authentication required.');
  }

  const response = await fetch('/api/analytics/overview', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  });

  return parseResponse(response);
};
