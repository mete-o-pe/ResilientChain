import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header  from './Header'

export default function AppLayout() {
  return (
    <div style={{ display: 'flex', minHeight: '100dvh', background: 'var(--color-bg)' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header />
        <main style={{
          flex: 1, padding: 'var(--space-6)',
          overflowY: 'auto',
        }}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
