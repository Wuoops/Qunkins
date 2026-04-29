export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const apiKey = localStorage.getItem('qunkins_api_key');
  
  const headers = new Headers(options.headers || {});
  if (apiKey) {
    headers.set('Authorization', `Bearer ${apiKey}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401) {
      // Allow AuthContext to handle auto-logout via /api/me check, but throw so callers know it failed
      throw new Error('Unauthorized');
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}
