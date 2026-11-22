
const BASE = import.meta.env.VITE_AUTH_URL ?? ''

const TOKEN_KEY = 'bia_token'

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY)
}

function authHeaders() {
  const token = getToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: authHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data
}

export const userService = {
  list:   ()       => req('GET',    '/api/users'),
  create: (body)   => req('POST',   '/api/users', body),
  update: (id, b)  => req('PUT',    `/api/users/${id}`, b),
  remove: (id)     => req('DELETE', `/api/users/${id}`),
  me:     ()       => req('GET',    '/api/users/me'),
}
