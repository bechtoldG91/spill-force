const AUTH_STORAGE_KEY = 'spill-force-auth';
const AUTH_COOKIE_NAME = 'sf_token';
const AUTH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function getBrowserStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readAuthCookie() {
  if (typeof document === 'undefined') {
    return '';
  }

  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`));

  return cookie ? decodeURIComponent(cookie.slice(AUTH_COOKIE_NAME.length + 1)) : '';
}

function authCookieOptions(maxAge = AUTH_COOKIE_MAX_AGE_SECONDS) {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  return `path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function readAuthSession() {
  let storedSession = null;
  const storage = getBrowserStorage();

  try {
    const raw = storage?.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      storedSession = JSON.parse(raw);
    }
  } catch {
    storedSession = null;
  }

  const token = storedSession?.token || readAuthCookie();
  if (!token) {
    return null;
  }

  return {
    token,
    user: storedSession?.user || null
  };
}

export function getAuthToken() {
  return readAuthSession()?.token || '';
}

export function setAuthSession(session) {
  if (!session?.token) {
    return;
  }

  const storage = getBrowserStorage();
  try {
    storage?.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Cookie persistence below still keeps the session available after refresh.
  }

  if (typeof document !== 'undefined') {
    document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(session.token)}; ${authCookieOptions()}`;
  }
}

export function clearAuthSession() {
  const storage = getBrowserStorage();
  try {
    storage?.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // The auth cookie is cleared below even if browser storage is unavailable.
  }

  if (typeof document !== 'undefined') {
    document.cookie = `${AUTH_COOKIE_NAME}=; ${authCookieOptions(0)}`;
  }
}

export function authHeaders(headers = {}) {
  const nextHeaders = new Headers(headers);
  const token = getAuthToken();

  if (token && !nextHeaders.has('Authorization')) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }

  return nextHeaders;
}

export function authFetch(input, options = {}) {
  return fetch(input, {
    ...options,
    credentials: options.credentials || 'same-origin',
    headers: authHeaders(options.headers)
  });
}
