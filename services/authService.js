const AUTH_STORAGE_KEY = 'terratrust_auth_session_v1';

const parseResponse = async (response) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || 'Authentication request failed.');
    error.status = response.status;
    throw error;
  }

  return payload;
};

const request = async (path, options = {}) => {
  const response = await fetch(`/api/auth${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return parseResponse(response);
};

export const saveSession = (session) => {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
};

export const loadSession = () => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
};

export const clearSession = () => {
  localStorage.removeItem(AUTH_STORAGE_KEY);
};

export const signupUser = async ({ name, email, password, walletAddress }) => {
  return request('/signup', {
    method: 'POST',
    body: { name, email, password, walletAddress },
  });
};

export const loginUser = async ({ email, password }) => {
  return request('/login', {
    method: 'POST',
    body: { email, password },
  });
};

export const fetchCurrentUser = async (token) => {
  return request('/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
};

export const verifyAuthChain = async () => {
  return request('/chain/verify');
};
