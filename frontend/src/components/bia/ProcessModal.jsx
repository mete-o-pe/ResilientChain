
import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

const EMPTY = {
  name: '', businessUnit: '',
  criticality: 0,
  rto: 60, rpo: 60, mao: 120,
  financialImpact: 1, operationalImpact: 1,
  reputationalImpact: 1, regulatoryImpact: 1,
  observations: '',
}

const CRIT_OPTS = [
  { value: 0, label: 'Baixo',   color: 'var(--color-success)' },
  { value: 1, label: 'Médio',   color: 'var(--color-primary)' },
  { value: 2, label: 'Alto',    color: 'var(--color-warning)' },
  { value: 3, label: 'Crítico', color: 'var(--color-error)'   },
]

function ImpactSelector({ label, value, onChange }) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
        {[1,2,3,4,5].map(n => (
          <button key={n} type="button" onClick={() => onChange(n)} style={{
            width: 32, height: 32, borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            background: value >= n ? 'var(--color-primary)' : 'var(--color-surface-offset)',
            color:      value >= n ? 'var(--color-text-inverse)' : 'var(--color-text-muted)',
            fontWeight: 600, fontSize: 'var(--text-xs)', cursor: 'pointer',
            transition: 'background var(--transition)',
          }}>{n}</button>
        ))}
      </div>
    </div>
  )
}

export default function ProcessModal({ open, initial, onClose, onSave, saving }) {
  const [form, setForm] = useState(EMPTY)
  const [err,  setErr]  = useState('')

  useEffect(() => {
    setForm(initial ? { ...EMPTY, ...initial } : { ...EMPTY })
    setErr('')
  }, [initial, open])

  if (!open) return null

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setErr('Nome do processo é obrigatório.')
    if (form.rto <= 0 || form.rpo <= 0 || form.mao <= 0) return setErr('RTO, RPO e MAO devem ser maiores que zero.')
    setErr('')
    onSave({
      name:               form.name.trim(),
      businessUnit:       form.businessUnit.trim(),
      criticality:        Number(form.criticality),
      rto:                Number(form.rto),
      rpo:                Number(form.rpo),
      mao:                Number(form.mao),
      financialImpact:    Number(form.financialImpact),
      operationalImpact:  Number(form.operationalImpact),
      reputationalImpact: Number(form.reputationalImpact),
      regulatoryImpact:   Number(form.regulatoryImpact),
      observations:       form.observations,
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 50,
      background: 'oklch(0.15 0.01 80 / 0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'var(--space-4)',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="card" style={{ width: '100%', maxWidth: 580, maxHeight: '90dvh', overflowY: 'auto', padding: 'var(--space-6)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600 }}>
            {initial ? 'Editar Processo' : 'Novo Processo BIA'}
          </h2>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 'var(--space-2)' }}>
            <X size={16} />
          </button>
        </div>

        {err && (
          <div style={{ background: 'var(--color-error-highlight)', color: 'var(--color-error)',
            padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            {err}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Identificação */}
          <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-faint)',
            textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 'var(--space-3)' }}>
            Identificação
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="input-label">Nome do Processo *</label>
              <input className="input" value={form.name}
                onChange={e => set('name', e.target.value)} placeholder="Ex: Faturamento Mensal" />
            </div>
            <div>
              <label className="input-label">Unidade de Negócio</label>
              <input className="input" value={form.businessUnit}
                onChange={e => set('businessUnit', e.target.value)} placeholder="Ex: Financeiro" />
            </div>
            <div>
              <label className="input-label">Criticidade</label>
              <select className="input" value={form.criticality} onChange={e => set('criticality', e.target.value)}>
                {CRIT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Disponibilidade */}
          <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-faint)',
            textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 'var(--space-3)' }}>
            Disponibilidade (minutos)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            {[['rto','RTO — Recovery Time Objective'],['rpo','RPO — Recovery Point Objective'],['mao','MAO — Maximum Acceptable Outage']].map(([k, lbl]) => (
              <div key={k}>
                <label className="input-label">{lbl}</label>
                <input className="input" type="number" min={1} value={form[k]}
                  onChange={e => set(k, e.target.value)} />
              </div>
            ))}
          </div>

          {/* Impactos */}
          <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-faint)',
            textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 'var(--space-3)' }}>
            Impactos (1 = Mínimo · 5 = Máximo)
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
            <ImpactSelector label="Financeiro"    value={form.financialImpact}    onChange={v => set('financialImpact', v)} />
            <ImpactSelector label="Operacional"   value={form.operationalImpact}  onChange={v => set('operationalImpact', v)} />
            <ImpactSelector label="Reputacional"  value={form.reputationalImpact} onChange={v => set('reputationalImpact', v)} />
            <ImpactSelector label="Regulatório"   value={form.regulatoryImpact}   onChange={v => set('regulatoryImpact', v)} />
          </div>

          {/* Observações */}
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <label className="input-label">Observações</label>
            <textarea
              className="input"
              value={form.observations}
              maxLength={4000}
              rows={4}
              onChange={e => set('observations', e.target.value)}
              placeholder="Informações complementares do processo"
              style={{ resize: 'vertical' }}
            />
            <p style={{ marginTop: 'var(--space-1)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', textAlign: 'right' }}>
              {new TextEncoder().encode(form.observations).byteLength}/4000 bytes
            </p>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Salvando na blockchain...' : (initial ? 'Salvar alterações' : 'Registrar processo')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
