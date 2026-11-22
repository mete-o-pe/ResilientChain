
import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const TOKEN_KEY = 'bia_token'
const USER_KEY  = 'bia_user'

const AuthContext = createContext(null)

/** Lê e valida o token do sessionStorage (verifica expiração do JWT) */
function readTokenFromStorage() {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) return { token: null, user: null }

  try {
    // Decodifica o payload do JWT (sem verificar assinatura — só para checar exp)
    // Base64url → Base64 padrão antes de atob()
    const b64url = token.split('.')[1]
    const b64    = b64url.replace(/-/g, '+').replace(/_/g, '/')
                 + '='.repeat((4 - b64url.length % 4) % 4)
    const payload = JSON.parse(atob(b64))
    const expired = payload.exp && payload.exp * 1000 < Date.now()
    if (expired) {
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(USER_KEY)
      return { token: null, user: null }
    }
  } catch {
    // Token malformado — ignora
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    return { token: null, user: null }
  }

  const rawUser = sessionStorage.getItem(USER_KEY)
  const user = rawUser ? (() => { try { return JSON.parse(rawUser) } catch { return null } })() : null
  return { token, user }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => ({
    ...readTokenFromStorage(),
    // x25519KeyPair é derivado em cada sessão — nunca persistido em storage
    x25519KeyPair: null,
  }))

  // Verifica expiração do token periodicamente (a cada 30s)
  useEffect(() => {
    const id = setInterval(() => {
      const { token: t } = readTokenFromStorage()
      if (!t && auth.token) setAuth({ token: null, user: null, x25519KeyPair: null })
    }, 30_000)
    return () => clearInterval(id)
  }, [auth.token])

  /**
   * Chamado após login bem-sucedido.
   * @param {string} token
   * @param {object} user
   * @param {{ privateKey: CryptoKey, publicKey: CryptoKey, pubKeyBytes: Uint8Array }|null} x25519KeyPair
   */
  const login = useCallback((token, user, x25519KeyPair = null) => {
    sessionStorage.setItem(TOKEN_KEY, token)
    sessionStorage.setItem(USER_KEY, JSON.stringify(user))
    setAuth({ token, user, x25519KeyPair })
  }, [])

  /** Limpa a sessão e descarta as chaves derivadas */
  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(USER_KEY)
    setAuth({ token: null, user: null, x25519KeyPair: null })
  }, [])

  return (
    <AuthContext.Provider value={{
      token:           auth.token,
      user:            auth.user,
      isAuthenticated: !!auth.token,
      x25519KeyPair:   auth.x25519KeyPair,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
