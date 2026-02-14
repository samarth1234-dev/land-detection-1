import { buildApiUrl, parseJsonResponse } from './apiClient.js';

const AUTH_STORAGE_KEY = 'root_auth_session_v1';
const safeSessionStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
};
const safeLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

const request = async (path, options = {}) => {
  const response = await fetch(buildApiUrl(`/api/auth${path}`), {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return parseJsonResponse(response, 'Authentication request failed.');
};

export const saveSession = (session) => {
  const sessionStore = safeSessionStorage();
  if (sessionStore) {
    sessionStore.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  }
  const legacyStore = safeLocalStorage();
  if (legacyStore) {
    legacyStore.removeItem(AUTH_STORAGE_KEY);
  }
};

export const loadSession = () => {
  try {
    const sessionStore = safeSessionStorage();
    const raw = sessionStore?.getItem(AUTH_STORAGE_KEY);
    const legacyStore = safeLocalStorage();
    if (!raw && legacyStore?.getItem(AUTH_STORAGE_KEY)) {
      legacyStore.removeItem(AUTH_STORAGE_KEY);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
};

export const clearSession = () => {
  const sessionStore = safeSessionStorage();
  if (sessionStore) {
    sessionStore.removeItem(AUTH_STORAGE_KEY);
  }
  const legacyStore = safeLocalStorage();
  if (legacyStore) {
    legacyStore.removeItem(AUTH_STORAGE_KEY);
  }
};

export const signupUser = async ({ name, email, password, walletAddress, role, employeeAccessCode, employeeId }) => {
  return request('/signup', {
    method: 'POST',
    body: { name, email, password, walletAddress, role, employeeAccessCode, employeeId },
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
