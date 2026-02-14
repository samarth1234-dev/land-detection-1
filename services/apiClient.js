const API_BASE = String(import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export const buildApiUrl = (path) => {
  if (!path) return API_BASE || '';
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
};

export const parseJsonResponse = async (response, fallbackMessage) => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || fallbackMessage || 'Request failed.');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
};
