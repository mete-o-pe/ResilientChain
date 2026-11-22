import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Download, Trash2, FileText, Loader } from 'lucide-react'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'

function formatBytes(n) {
  const num = Number(n)
  if (num < 1024)    return `${num} B`
  if (num < 1048576) return `${(num / 1024).toFixed(1)} KB`
  return `${(num / 1048576).toFixed(1)} MB`
}

function formatDate(ts) {
  return new Date(Number(ts) * 1000).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Estilos inline do overlay/modal ──────────────────────────────────────────
// Usamos inline styles no overlay para garantir position:fixed + z-index
// independentemente do CSS global do projeto.
const S = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  },
  box: {
    position: 'relative',
    background: 'var(--color-surface, #fff)',
    borderRadius: 'var(--radius-lg, 0.75rem)',
    boxShadow: 'var(--shadow-lg, 0 12px 32px rgba(0,0,0,.18))',
    width: '100%',
    maxWidth: '860px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '1.25rem 1.5rem',
    borderBottom: '1px solid var(--color-border, #e5e7eb)',
    flexShrink: 0,
  },
  headerInfo: { flex: 1, minWidth: 0 },
  title: {
    margin: 0,
    fontSize: 'var(--text-lg, 1.125rem)',
    fontWeight: 600,
    color: 'var(--color-text, #111)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  subtitle: {
    margin: '0.2rem 0 0',
    fontSize: 'var(--text-sm, 0.875rem)',
    color: 'var(--color-text-muted, #6b7280)',
  },
  headerActions: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '1rem 1.5rem 1.5rem',
  },
  alert: (type) => ({
    margin: '0 1.5rem',
    marginTop: '0.75rem',
    padding: '0.65rem 1rem',
    borderRadius: 'var(--radius-md, 0.5rem)',
    fontSize: 'var(--text-sm, 0.875rem)',
    background: type === 'error'
      ? 'var(--color-error-highlight, #fee2e2)'
      : 'var(--color-success-highlight, #dcfce7)',
    color: type === 'error'
      ? 'var(--color-error, #b91c1c)'
      : 'var(--color-success, #15803d)',
    flexShrink: 0,
  }),
}

export default function FileManagerModal({
  open, process, onClose,
  loadFiles, uploadFile, downloadFile, removeFile,
  canWrite = true,
}) {
  const [files,     setFiles]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [actionId,  setActionId]  = useState(null)
  const [error,     setError]     = useState('')
  const [success,   setSuccess]   = useState('')
  const inputRef = useRef()

  useEffect(() => {
    if (open && process) {
      setError(''); setSuccess(''); setFiles([])
      fetchFiles()
    }
  }, [open, process])

  // Bloqueia scroll do body enquanto o modal está aberto
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const fetchFiles = async () => {
    setLoading(true); setError('')
    try {
      const list = await loadFiles(process)
      setFiles(list)
    } catch (e) {
      setError(friendlyMetaMaskError(e))
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    e.target.value = ''
    setUploading(true); setError(''); setSuccess('')
    try {
      await uploadFile(process, file)
      setSuccess(`"${file.name}" enviado e registrado na blockchain.`)
      await fetchFiles()
    } catch (e) {
      setError(friendlyMetaMaskError(e))
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async (file) => {
    setActionId(file.id); setError('')
    try {
      await downloadFile(file)
    } catch (e) {
      setError(friendlyMetaMaskError(e))
    } finally {
      setActionId(null)
    }
  }

  const handleRemove = async (file) => {
    if (!confirm(
      `Remover "${file.filename}" do processo?\n\n` +
      `• O arquivo será desafixado do nó IPFS (armazenamento liberado).\n` +
      `• O CID permanece registrado na blockchain para auditoria.`
    )) return

    setActionId(file.id); setError('')
    try {
      // Passa o objeto completo — removeFile precisa do CID para o unpin
      await removeFile(file)
      setSuccess(`"${file.filename}" removido do IPFS.`)
      await fetchFiles()
    } catch (e) {
      setError(friendlyMetaMaskError(e))
    } finally {
      setActionId(null)
    }
  }

  if (!open || !process) return null

  return createPortal(
    <div style={S.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Gerenciador de arquivos">

      <div style={S.box} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={S.header}>
          <div style={S.headerInfo}>
            <h2 style={S.title}>{process.name}</h2>
            <p style={S.subtitle}>{files.length} arquivo(s) ativo(s)</p>
          </div>
          <div style={S.headerActions}>
            {canWrite && (
              <button
                className="btn btn-primary"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? <><Loader size={16} className="spin" /> Enviando…</>
                  : <><Upload size={16} /> Enviar arquivo</>}
              </button>
            )}
            <button
              className="btn btn-ghost icon-btn"
              onClick={onClose}
              aria-label="Fechar"
            >
              <X size={20} />
            </button>
          </div>
          <input ref={inputRef} type="file" hidden onChange={handleUpload} />
        </div>

        {/* ── Feedback ── */}
        {error   && <div style={S.alert('error')}>{error}</div>}
        {success && <div style={S.alert('success')}>{success}</div>}

        {/* ── Body ── */}
        <div style={S.body}>
          {loading ? (
            <div className="loading-state" style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'2rem', color:'var(--color-text-muted)' }}>
              <Loader className="spin" size={20} /> Carregando arquivos…
            </div>
          ) : files.length === 0 ? (
            <div className="empty-state" style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', padding:'3rem 1rem', color:'var(--color-text-muted)' }}>
              <FileText size={40} style={{ marginBottom:'1rem', opacity:0.4 }} />
              <p style={{ fontWeight:600, marginBottom:'0.25rem' }}>Nenhum arquivo vinculado a este processo.</p>
              <span style={{ fontSize:'var(--text-sm, 0.875rem)' }}>Clique em "Enviar arquivo" para começar.</span>
            </div>
          ) : (
            <table className="file-table" style={{ width:'100%', borderCollapse:'collapse', fontSize:'var(--text-sm, 0.875rem)' }}>
              <thead>
                <tr>
                  {['Arquivo', 'Tamanho', 'Enviado em', 'CID', 'Ações'].map(h => (
                    <th key={h} style={{ textAlign:'left', padding:'0.5rem 0.75rem', borderBottom:'1px solid var(--color-border,#e5e7eb)', color:'var(--color-text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map(f => (
                  <tr key={f.id} style={{ borderBottom:'1px solid var(--color-divider,#f3f4f6)' }}>
                    <td style={{ padding:'0.6rem 0.75rem', maxWidth:'220px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', overflow:'hidden' }}>
                        <FileText size={15} style={{ flexShrink:0, color:'var(--color-text-muted)' }} />
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={f.filename}>
                          {f.filename}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding:'0.6rem 0.75rem', whiteSpace:'nowrap' }}>{formatBytes(f.fileSize)}</td>
                    <td style={{ padding:'0.6rem 0.75rem', whiteSpace:'nowrap' }}>{formatDate(f.uploadedAt)}</td>
                    <td style={{ padding:'0.6rem 0.75rem' }}>
                      <code
                        title={f.cid}
                        style={{ fontSize:'0.78rem', background:'var(--color-surface-offset,#f3f4f6)', padding:'0.15rem 0.4rem', borderRadius:'var(--radius-sm,0.375rem)', cursor:'default' }}
                      >
                        {f.cid.slice(0, 14)}…
                      </code>
                    </td>
                    <td style={{ padding:'0.6rem 0.75rem', whiteSpace:'nowrap' }}>
                      <button
                        className="btn btn-ghost icon-btn"
                        title="Baixar arquivo"
                        disabled={actionId === f.id}
                        onClick={() => handleDownload(f)}
                        aria-label={`Baixar ${f.filename}`}
                        style={{ marginRight:'0.25rem' }}
                      >
                        {actionId === f.id
                          ? <Loader size={16} className="spin" />
                          : <Download size={16} />}
                      </button>
                      {canWrite && (
                        <button
                          className="btn btn-ghost icon-btn"
                          title="Remover arquivo"
                          disabled={actionId === f.id}
                          onClick={() => handleRemove(f)}
                          aria-label={`Remover ${f.filename}`}
                          style={{ color:'var(--color-error,#dc2626)' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>,
    document.body,
  )
}
