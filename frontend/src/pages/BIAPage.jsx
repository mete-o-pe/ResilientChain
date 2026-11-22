
import { useEffect, useState } from 'react'
import { Plus, Pencil, Folder, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useBIA, CRITICALITY, STATUS, minutesToHuman } from '@/hooks/useBIA'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'
import { useAuth } from '@/contexts/AuthContext'
import ProcessModal     from '@/components/bia/ProcessModal'
import FileManagerModal from '@/components/bia/FileManagerModal'

// ── Helpers visuais ──────────────────────────────────────────────────────
const CRIT_CLASS = { 0: 'badge-green', 1: 'badge-teal', 2: 'badge-yellow', 3: 'badge-red' }
const STAT_CLASS = { 0: 'badge',       1: 'badge-green', 2: 'badge-teal' }

function CritBadge({ v }) {
  return <span className={`badge ${CRIT_CLASS[v] || 'badge'}`}>{CRITICALITY[v] ?? v}</span>
}
function StatBadge({ v }) {
  const cls  = { 0: 'badge', 1: 'badge-green', 2: '' }[v] ?? 'badge'
  const base = cls || 'badge'
  return (
    <span className={`badge ${base}`} style={v === 2 ? { background: 'var(--color-surface-offset)', color: 'var(--color-text-muted)' } : {}}>
      {STATUS[v] ?? v}
    </span>
  )
}

// ── Componente principal ─────────────────────────────────────────────────
export default function BIAPage() {
  const { user: currentUser } = useAuth()
  const canWrite = currentUser?.role !== 'VIEWER'

  const {
    processes, loading, error,
    loadProcesses, createProcess, updateProcess, setStatus,
    loadFiles, uploadFile, downloadFile, removeFile,
  } = useBIA()

  const [processModal, setProcessModal] = useState({ open: false, initial: null })
  const [fileModal,    setFileModal]    = useState({ open: false, process: null })
  const [saving,       setSaving]       = useState(false)
  const [actionError,  setActionError]  = useState('')

  useEffect(() => { loadProcesses() }, [])

  // ── CRUD ────────────────────────────────────────────────────────────────
  const openNew  = () => setProcessModal({ open: true, initial: null })
  const openEdit = (p) => setProcessModal({ open: true, initial: p })
  const openFiles= (p) => setFileModal({ open: true, process: p })

  const handleSave = async (params) => {
    setSaving(true); setActionError('')
    try {
      if (processModal.initial) {
        await updateProcess(processModal.initial.id, params)
      } else {
        await createProcess(params)
      }
      setProcessModal({ open: false, initial: null })
    } catch (e) {
      setActionError(friendlyMetaMaskError(e))
    } finally { setSaving(false) }
  }

  const handleSetStatus = async (id, status) => {
    setActionError('')
    try { await setStatus(id, status) }
    catch (e) { setActionError(friendlyMetaMaskError(e)) }
  }

  // ── UI ──────────────────────────────────────────────────────────────────
  const total    = processes.length
  const ativos   = processes.filter(p => p.status === 1).length
  const criticos = processes.filter(p => p.criticality === 3).length

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, lineHeight: 1.2 }}>Matriz BIA</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Business Impact Analysis — processos registrados na blockchain
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" onClick={loadProcesses} disabled={loading}>
            <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          </button>
          {canWrite && (
            <button className="btn btn-primary" onClick={openNew}>
              <Plus size={14} /> Novo Processo
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        {[
          { label: 'Total de Processos', value: total,    color: 'var(--color-primary)' },
          { label: 'Ativos',             value: ativos,   color: 'var(--color-success)' },
          { label: 'Críticos',           value: criticos, color: 'var(--color-error)'   },
        ].map(({ label, value, color }) => (
          <div key={label} className="card" style={{ padding: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</p>
            <p style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color, marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Erro global */}
      {(error || actionError) && (
        <div style={{ background: 'var(--color-error-highlight)', color: 'var(--color-error)',
          padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
          {error || actionError}
        </div>
      )}

      {/* Tabela */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && processes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            Carregando processos da blockchain…
          </div>
        ) : processes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-text-muted)' }}>
            <p style={{ fontSize: 'var(--text-base)', marginBottom: 'var(--space-2)' }}>Nenhum processo cadastrado.</p>
            <p style={{ fontSize: 'var(--text-sm)' }}>Clique em <strong>Novo Processo</strong> para começar.</p>
            <p style={{ fontSize: 'var(--text-xs)', marginTop: 'var(--space-4)', color: 'var(--color-text-faint)' }}>
              Certifique-se de ter executado: <code>make node</code> e <code>make deploy</code>
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-offset)', borderBottom: '1px solid var(--color-border)' }}>
                  {['#','Processo','Unidade','Criticidade','RTO','RPO','MAO','Status','Ações'].map(h => (
                    <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left',
                      fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)',
                      whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {processes.map((p, i) => (
                  <tr key={p.id} style={{
                    borderBottom: '1px solid var(--color-divider)',
                    background: i % 2 === 0 ? 'transparent' : 'var(--color-surface)',
                  }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                      #{p.id}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{p.name}</span>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {p.businessUnit || '—'}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <CritBadge v={p.criticality} />
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
                      {minutesToHuman(p.rto)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
                      {minutesToHuman(p.rpo)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>
                      {minutesToHuman(p.mao)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <StatBadge v={p.status} />
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                        {/* Editar */}
                        {canWrite && (
                          <button className="btn btn-ghost" title="Editar processo"
                            style={{ padding: 'var(--space-1) var(--space-2)' }}
                            onClick={() => openEdit(p)}>
                            <Pencil size={13} />
                          </button>
                        )}
                        {/* Arquivos */}
                        <button className="btn btn-ghost" title="Gerenciar arquivos"
                          style={{ padding: 'var(--space-1) var(--space-2)' }}
                          onClick={() => openFiles(p)}>
                          <Folder size={13} />
                        </button>
                        {/* Status rápido */}
                        {canWrite && (
                          <select
                            value={p.status}
                            onChange={e => handleSetStatus(p.id, Number(e.target.value))}
                            style={{ fontSize: 'var(--text-xs)', padding: '2px var(--space-2)',
                              background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                              borderRadius: 'var(--radius-sm)', color: 'var(--color-text-muted)', cursor: 'pointer' }}
                            title="Alterar status">
                            <option value={0}>Rascunho</option>
                            <option value={1}>Ativo</option>
                            <option value={2}>Arquivado</option>
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modais */}
      <ProcessModal
        open={processModal.open}
        initial={processModal.initial}
        onClose={() => setProcessModal({ open: false, initial: null })}
        onSave={handleSave}
        saving={saving}
      />
      <FileManagerModal
        open={fileModal.open}
        process={fileModal.process}
        onClose={() => setFileModal({ open: false, process: null })}
        loadFiles={loadFiles}
        uploadFile={uploadFile}
        downloadFile={downloadFile}
        removeFile={removeFile}
        canWrite={canWrite}
      />
    </div>
  )
}
