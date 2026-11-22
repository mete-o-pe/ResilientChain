
import { useEffect, useState } from 'react'
import { UserPlus, RefreshCw, Shield, Trash2, X, Check, ChevronDown } from 'lucide-react'
import { useUsers } from '@/hooks/useUsers'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'

const ROLE_LABELS = { ADMIN: 'Admin', ANALYST: 'Analyst', VIEWER: 'Viewer' }
const ROLE_COLORS = { ADMIN: '#a12c7b', ANALYST: '#01696f', VIEWER: '#437a22' }

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 'var(--text-xs)', fontWeight: 600,
      background: color + '1a', color,
    }}>{label}</span>
  )
}

function ChainRoleBadges({ chainRoles }) {
  if (!chainRoles) return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>sem carteira</span>
  const roles = []
  if (chainRoles.isAdmin)   roles.push({ label: 'Admin',   color: '#a12c7b' })
  if (chainRoles.isAnalyst) roles.push({ label: 'Analyst', color: '#01696f' })
  if (chainRoles.isViewer)  roles.push({ label: 'Viewer',  color: '#437a22' })
  if (!roles.length) return <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>sem papel</span>
  return <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{roles.map(r => <Badge key={r.label} {...r} />)}</div>
}

// ── Modal: novo usuário ───────────────────────────────────────────────────
function NewUserModal({ onClose, onCreate }) {
  const [form, setForm]   = useState({ walletAddress: '', role: 'VIEWER', email: '' })
  const [busy, setBusy]   = useState(false)
  const [err,  setErr]    = useState('')

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('')
    try { await onCreate(form); onClose() }
    catch (ex) { setErr(friendlyMetaMaskError(ex)) }
    finally { setBusy(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div className="card" style={{ width: 440, padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Novo Usuário</h2>
          <button onClick={onClose} style={{ color: 'var(--color-text-muted)' }}><X size={16} /></button>
        </div>
        {err && <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>{err}</p>}
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {[
            { label: 'Endereço de carteira *', key: 'walletAddress', type: 'text' },
            { label: 'E-mail (opcional)',       key: 'email',          type: 'email' },
          ].map(f => (
            <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>{f.label}</span>
              <input type={f.type} className="input" value={form[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />
            </label>
          ))}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>Perfil *</span>
            <select className="input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              <option value="VIEWER">Viewer — Apenas leitura</option>
              <option value="ANALYST">Analyst — Leitura e escrita</option>
              <option value="ADMIN">Admin — Acesso total</option>
            </select>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
              O papel será concedido automaticamente na blockchain ao criar o usuário.
            </span>
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit"  className="btn btn-primary" disabled={busy}>{busy ? 'Criando…' : 'Criar Usuário'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: papéis ──────────────────────────────────────────────
function RolesModal({ user, onClose, onSetRole }) {
  const [busy,       setBusy]       = useState('')
  const [err,        setErr]        = useState('')
  const [localRoles, setLocalRoles] = useState(user.chainRoles || {})

  async function toggle(roleKey, currentValue) {
    setBusy(roleKey); setErr('')
    const granting = !currentValue
    // Atualização otimista — reflete imediatamente na UI
    setLocalRoles(prev => ({
      isAdmin:   prev.isAdmin,
      isAnalyst: granting && roleKey === 'ANALYST',
      isViewer:  granting && roleKey === 'VIEWER',
    }))
    try {
      await onSetRole(user.walletAddress, roleKey, granting)
    } catch (ex) {
      setErr(friendlyMetaMaskError(ex))
      setLocalRoles(user.chainRoles || {})  // reverte em caso de erro
    } finally {
      setBusy('')
    }
  }

  const roles = localRoles

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'oklch(0 0 0 / .5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div className="card" style={{ width: 400, padding: 'var(--space-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
          <div>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Papéis</h2>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>{user.email}</p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--color-text-muted)' }}><X size={16} /></button>
        </div>

        {!user.walletAddress && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--space-6) 0' }}>
            Este usuário não tem carteira associada.<br />
            O usuário precisa realizar o login com MetaMask pelo menos uma vez.
          </p>
        )}

        {user.walletAddress && (
          <>
            <p style={{ fontSize: 'var(--text-xs)', background: 'var(--color-surface-offset)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-4)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {user.walletAddress}
            </p>
            {err && <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>{err}</p>}

            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
              Cada usuário possui um único papel na blockchain. Conceder ANALYST ou VIEWER substitui o papel atual. Para revogar, desative o papel ativo.
            </p>

            {[
              { key: 'ANALYST', label: 'Analyst', desc: 'Pode criar e editar processos BIA',  value: roles.isAnalyst, color: '#01696f' },
              { key: 'VIEWER',  label: 'Viewer',  desc: 'Somente leitura dos dados do BIA',    value: roles.isViewer,  color: '#437a22' },
            ].map(r => (
              <div key={r.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 'var(--space-3)', border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-2)',
              }}>
                <div>
                  <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: r.color }}>{r.label}</p>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{r.desc}</p>
                </div>
                <button
                  onClick={() => toggle(r.key, r.value)}
                  disabled={busy === r.key}
                  style={{
                    width: 40, height: 22, borderRadius: 11,
                    background: r.value ? r.color : 'var(--color-surface-offset)',
                    transition: 'background .2s', position: 'relative', flexShrink: 0,
                  }}>
                  <span style={{
                    position: 'absolute', top: 2, width: 18, height: 18, borderRadius: '50%',
                    background: '#fff', transition: 'left .2s',
                    left: r.value ? 20 : 2,
                    boxShadow: '0 1px 3px rgba(0,0,0,.3)',
                  }} />
                </button>
              </div>
            ))}
          </>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function UsersTab() {
  const { users, loading, error, loadUsers, createUser, deleteUser, setChainRole } = useUsers()
  const [showNew,    setShowNew]    = useState(false)
  const [rolesUser,  setRolesUser]  = useState(null)
  const [deleting,   setDeleting]   = useState(null)

  useEffect(() => { loadUsers() }, [])

  async function handleDelete(u) {
    if (!confirm(`Remover o usuário ${u.email}? Esta ação não pode ser desfeita.`)) return
    setDeleting(u.id)
    try { await deleteUser(u.id) } catch (e) { alert(friendlyMetaMaskError(e)) }
    finally { setDeleting(null) }
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          {users.length} {users.length === 1 ? 'usuário' : 'usuários'} cadastrado{users.length !== 1 ? 's' : ''}
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" onClick={loadUsers} disabled={loading}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
            Atualizar
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>
            <UserPlus size={14} /> Novo Usuário
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--color-error-highlight)', color: 'var(--color-error)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)' }}>{error}</div>
      )}

      {/* Tabela */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--color-surface-offset)', borderBottom: '1px solid var(--color-border)' }}>
              {['E-mail', 'Carteira', 'Perfil (App)', 'Papéis', 'Criado em', 'Ações'].map(h => (
                <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Carregando…</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Nenhum usuário encontrado</td></tr>
            )}
            {users.map((u, i) => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--color-divider)', background: i % 2 ? 'var(--color-surface)' : 'transparent' }}>
                <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)' }}>{u.email}</td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontFamily: 'monospace', color: 'var(--color-text-muted)' }}>
                  {u.walletAddress ? `${u.walletAddress.slice(0,6)}…${u.walletAddress.slice(-4)}` : '—'}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <Badge label={ROLE_LABELS[u.role] || u.role} color={ROLE_COLORS[u.role] || '#7a7974'} />
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <ChainRoleBadges chainRoles={u.chainRoles} />
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-BR') : '—'}
                </td>
                <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px' }}
                      onClick={() => setRolesUser(u)} title="Gerenciar papéis">
                      <Shield size={13} /> Papéis
                    </button>
                    <button className="btn btn-ghost" style={{ padding: '4px 8px', color: 'var(--color-error)' }}
                      disabled={deleting === u.id} onClick={() => handleDelete(u)} title="Remover usuário">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showNew   && <NewUserModal onClose={() => setShowNew(false)}  onCreate={createUser} />}
      {rolesUser && <RolesModal  user={rolesUser} onClose={() => { setRolesUser(null); loadUsers() }} onSetRole={setChainRole} />}
    </div>
  )
}
