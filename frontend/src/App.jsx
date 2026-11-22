import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute  from '@/components/ProtectedRoute'
import AppLayout       from '@/components/layout/AppLayout'
import LoginPage       from '@/pages/LoginPage'
import DashboardPage   from '@/pages/DashboardPage'
import BIAPage         from '@/pages/BIAPage'
import SettingsPage    from '@/pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      {/* Rota pública */}
      <Route path="/login" element={<LoginPage />} />

      {/* Rotas protegidas — exigem JWT válido */}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/bia"       element={<BIAPage />} />
          <Route path="/settings"  element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
