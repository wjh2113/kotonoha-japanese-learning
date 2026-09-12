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

export async function readApiJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text()
  const trimmed = text.trim()
  if (/<\s*html\b/i.test(trimmed) || /502\s*Bad\s*Gateway/i.test(trimmed) || /nginx\/\d/i.test(trimmed)) {
    throw new Error(response.status >= 500 ? '课文服务暂时不可用，请稍后重试。' : '课文服务返回异常，请稍后重试。')
  }
  try {
    return JSON.parse(trimmed) as T
  } catch {
    throw new Error(response.status >= 500 ? '课文服务暂时不可用，请稍后重试。' : '课文服务返回异常，请稍后重试。')
  }
}
