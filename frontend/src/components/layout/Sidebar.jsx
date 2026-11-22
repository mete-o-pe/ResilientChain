import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Table2, Settings, ShieldCheck } from 'lucide-react'

const NAV = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/bia',       icon: Table2,          label: 'Matriz BIA'  },
  { to: '/settings',  icon: Settings,        label: 'Configurações' },
]

const linkStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
  padding: 'var(--space-2) var(--space-3)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--text-sm)', fontWeight: 500,
  color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
  background: active ? 'var(--color-primary-highlight)' : 'transparent',
  textDecoration: 'none',
  transition: 'background var(--transition), color var(--transition)',
})

export default function Sidebar() {
  return (
    <aside style={{
      width: 'var(--sidebar-w)', flexShrink: 0,
      borderRight: '1px solid var(--color-border)',
      background: 'var(--color-surface)',
      display: 'flex', flexDirection: 'column',
      padding: 'var(--space-4)',
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-3)',
        marginBottom: 'var(--space-6)',
      }}>
        <ShieldCheck size={22} color="var(--color-primary)" />
        <span style={{ fontWeight: 700, fontSize: 'var(--text-base)', letterSpacing: '-.01em' }}>
          BIA DApp
        </span>
      </div>

      {/* Navegação */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', flex: 1 }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} style={({ isActive }) => linkStyle(isActive)}>
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Versão */}
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', padding: 'var(--space-2) var(--space-3)' }}>
        v0.5.0
      </span>
    </aside>
  )
}
