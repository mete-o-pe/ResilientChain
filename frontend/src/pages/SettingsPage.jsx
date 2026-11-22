
import { useState } from 'react'
import { Users, User } from 'lucide-react'
import UsersTab   from '@/components/settings/UsersTab'
import ProfileTab from '@/components/settings/ProfileTab'
import { useAuth } from '@/contexts/AuthContext'

const TABS = [
  { id: 'users',   label: 'Usuários',    icon: Users },
  { id: 'profile', label: 'Meu Perfil',  icon: User  },
]

export default function SettingsPage() {
  const { user: currentUser } = useAuth()
  const isAdmin = currentUser?.role === 'ADMIN'
  const [tab, setTab] = useState(isAdmin ? 'users' : 'profile')

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>Configurações</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
          Gerenciamento de usuários e perfis de acesso
        </p>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', borderBottom: '1px solid var(--color-border)', marginBottom: 'var(--space-6)' }}>
        {TABS.map(t => {
          const Icon    = t.icon
          const active  = tab === t.id
          // Aba Usuários somente para ADMIN
          if (t.id === 'users' && currentUser?.role !== 'ADMIN') return null
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)',
              fontSize: 'var(--text-sm)', fontWeight: active ? 600 : 400,
              color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
              borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1, background: 'none', cursor: 'pointer',
              transition: 'color var(--transition-interactive)',
            }}>
              <Icon size={14} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'users'   && isAdmin && <UsersTab />}
      {tab === 'profile' && <ProfileTab currentUser={currentUser} />}
    </div>
  )
}
