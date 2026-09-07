export const ACCESS_TOKEN_KEY = 'kotonoha-access-token'
export const AUTH_REQUIRED_EVENT = 'kotonoha-auth-required'

export function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY) || ''
}

export function setAccessToken(token: string) {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token)
  else localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers)
  const token = getAccessToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, { ...options, headers })
  if (response.status === 401 && !url.includes('/api/auth/')) {
    setAccessToken('')
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT))
  }
  return response
}
