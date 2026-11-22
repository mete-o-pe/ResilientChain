import { Sun, Moon, LogOut, Wallet } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'

export default function Header() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [dark, setDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark'
  )

  const toggleTheme = () => {
    const next = dark ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    sessionStorage.setItem('bia-theme', next)
    setDark(!dark)
  }

  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <header style={{
      height: 56, flexShrink: 0,
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 var(--space-6)',
    }}>
      {/* Info do usuário */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        {user?.walletAddress && (
          <>
            <Wallet size={14} color="var(--color-text-muted)" />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
              {user.walletAddress.slice(0, 6)}…{user.walletAddress.slice(-4)}
            </span>
          </>
        )}
        {user?.role && (
          <span className="badge badge-teal" style={{ marginLeft: 'var(--space-2)' }}>
            {user.role}
          </span>
        )}
      </div>

      {/* Ações */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          onClick={toggleTheme}
          className="btn btn-ghost"
          style={{ padding: 'var(--space-2)' }}
          aria-label={dark ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={handleLogout}
          className="btn btn-ghost"
          style={{ fontSize: 'var(--text-xs)' }}
        >
          <LogOut size={14} />
          Sair
        </button>
      </div>
    </header>
  )
}
