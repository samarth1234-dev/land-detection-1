import { loadSession } from './authService.js';
import { buildApiUrl, parseJsonResponse } from './apiClient.js';

export const fetchGovernanceAnalytics = async () => {
  const session = loadSession();
  if (!session?.token) {
    throw new Error('Authentication required.');
  }

  const response = await fetch(buildApiUrl('/api/analytics/overview'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.token}`,
    },
  });

  return parseJsonResponse(response, 'Failed to load governance analytics.');
};
