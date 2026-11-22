
import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { getProvider } from '@/services/contractService'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'

const ROLE_LABELS = { ADMIN: 'Administrador', ANALYST: 'Analista', VIEWER: 'Visualizador' }
const ROLE_COLORS = { ADMIN: '#a12c7b', ANALYST: '#01696f', VIEWER: '#437a22' }

const ROLES_ABI = [
  'function getRoles(address user) view returns (bool isAdmin, bool isAnalyst, bool isViewer)',
]

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', padding: 'var(--space-3) 0', borderBottom: '1px solid var(--color-divider)' }}>
      <span style={{ width: 160, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, wordBreak: 'break-all' }}>{value || '—'}</span>
    </div>
  )
}

export default function ProfileTab({ currentUser }) {
  const [chainRoles,      setChainRoles]      = useState(null)
  const [chainRolesError, setChainRolesError] = useState('')

  // Carrega papéis blockchain da carteira conectada
  useEffect(() => {
    async function load() {
      try {
        const provider = await getProvider()
        const addr     = await fetch('/contracts/addresses.json', { cache: 'no-store' }).then(r => r.json())
        const accounts = await provider.send('eth_accounts', [])
        if (!accounts[0] || !addr.AccessManager) return
        const am = new ethers.Contract(addr.AccessManager, ROLES_ABI, provider)
        const [isAdmin, isAnalyst, isViewer] = await am.getRoles(accounts[0])
        setChainRoles({ isAdmin, isAnalyst, isViewer, wallet: accounts[0] })
      } catch (e) {
        setChainRolesError(friendlyMetaMaskError(e))
      }
    }
    load()
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

      {/* Card: informações */}
      <div className="card">
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-4)' }}>Informações da Conta</h3>
          <InfoRow label="Carteira"           value={currentUser?.walletAddress} />
          <InfoRow label="Perfil (aplicação)" value={ROLE_LABELS[currentUser?.role] || currentUser?.role} />
          <InfoRow label="Usuário desde"      value={currentUser?.createdAt ? new Date(currentUser.createdAt).toLocaleDateString('pt-BR') : '—'} />
        </div>

      {/* Card: papéis na blockchain */}
      <div className="card">
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: 'var(--space-4)' }}>Papéis na Blockchain</h3>
          {!chainRoles && !chainRolesError && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Carregando… (ou MetaMask não conectado)
            </p>
          )}
          {chainRolesError && (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>
              {chainRolesError}
            </p>
          )}
          {chainRoles && (
            <>
              <p style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', background: 'var(--color-surface-offset)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)', wordBreak: 'break-all' }}>
                {chainRoles.wallet}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {[
                  { key: 'isAdmin',   label: 'Admin',   color: '#a12c7b' },
                  { key: 'isAnalyst', label: 'Analyst', color: '#01696f' },
                  { key: 'isViewer',  label: 'Viewer',  color: '#437a22' },
                ].map(r => (
                  <div key={r.key} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: 'var(--space-3)', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: chainRoles[r.key] ? r.color : 'var(--color-text-muted)' }}>
                      {r.label}
                    </span>
                    <span style={{
                      fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: 999,
                      background: chainRoles[r.key] ? r.color + '1a' : 'var(--color-surface-offset)',
                      color: chainRoles[r.key] ? r.color : 'var(--color-text-faint)',
                    }}>
                      {chainRoles[r.key] ? 'Concedido' : 'Não concedido'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
      </div>
    </div>
  )
}
