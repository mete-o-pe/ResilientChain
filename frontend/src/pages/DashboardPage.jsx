
import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import {
  useDashboard, CRITICALITY_LABEL, CRIT_COLORS, STATUS_COLORS, minutesToHuman,
} from '@/hooks/useDashboard'

// ── KPI card ─────────────────────────────────────────────────────────────
function KPI({ label, value, sub, accent }) {
  return (
    <div className="card" style={{ padding: 'var(--space-5)' }}>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>
        {label}
      </p>
      <p style={{
        fontSize: 'var(--text-xl)', fontWeight: 700,
        color: accent || 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
      }}>
        {value ?? '—'}
      </p>
      {sub && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: 'var(--space-1)' }}>{sub}</p>}
    </div>
  )
}

// ── Título de seção ───────────────────────────────────────────────────────
function SectionTitle({ children }) {
  return (
    <h2 style={{
      fontSize: 'var(--text-sm)', fontWeight: 600,
      color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)',
      textTransform: 'uppercase', letterSpacing: '.06em',
    }}>
      {children}
    </h2>
  )
}

// ── Tooltip customizado ───────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)', padding: 'var(--space-3)',
      fontSize: 'var(--text-xs)', boxShadow: 'var(--shadow-md)',
    }}>
      {label && <p style={{ fontWeight: 600, marginBottom: 4 }}>{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color || entry.fill }}>
          {entry.name}: <strong>{entry.value}</strong>
        </p>
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
export default function DashboardPage() {
  const { data, loading, error, loadDashboard } = useDashboard()

  useEffect(() => { loadDashboard() }, [])

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>Dashboard BIA</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
            Indicadores em tempo real — dados lidos direto da blockchain
          </p>
        </div>
        <button className="btn btn-ghost" onClick={loadDashboard} disabled={loading}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          Atualizar
        </button>
      </div>

      {/* Erro */}
      {error && (
        <div style={{ background: 'var(--color-error-highlight)', color: 'var(--color-error)',
          padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-sm)', marginBottom: 'var(--space-6)' }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: 'var(--space-16)', color: 'var(--color-text-muted)' }}>
          Carregando dados da blockchain…
        </div>
      )}

      {data && (
        <>
          {/* ── KPIs ─────────────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-8)' }}>
            <KPI label="Total de Processos" value={data.total} />
            <KPI label="Processos Ativos"   value={data.active}   accent="#437a22" />
            <KPI label="Processos Críticos" value={data.critical} accent="#a12c7b" />
            <KPI label="Anexos visíveis"   value={data.totalFiles} />
            <KPI label="RTO Médio" value={minutesToHuman(data.avgRTO)} sub="Recovery Time Obj." />
            <KPI label="RPO Médio" value={minutesToHuman(data.avgRPO)} sub="Recovery Point Obj." />
          </div>

          {/* ── Distribuições ────────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>

            {/* Donut — por criticidade */}
            <div className="card">
              <SectionTitle>Processos por Criticidade</SectionTitle>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={data.byCriticality} cx="50%" cy="50%"
                    innerRadius={60} outerRadius={95}
                    paddingAngle={3} dataKey="value">
                    {data.byCriticality.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} cursor={false} />
                  <Legend formatter={(v) => v} iconType="circle" iconSize={8} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar — por status */}
            <div className="card">
              <SectionTitle>Processos por Status</SectionTitle>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.byStatus} barSize={40}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-divider)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#7a7974' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#7a7974' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={false} />
                  <Bar dataKey="value" name="Processos" radius={[4, 4, 0, 0]}>
                    {data.byStatus.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Unidades + Impactos ──────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>

            {/* Horizontal bar — por unidade de negócio */}
            <div className="card">
              <SectionTitle>Processos por Unidade de Negócio</SectionTitle>
              {data.byUnit.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: 'var(--space-8) 0', textAlign: 'center' }}>
                  Nenhuma unidade cadastrada
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(180, data.byUnit.length * 36)}>
                  <BarChart data={data.byUnit} layout="vertical" barSize={18}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-divider)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#7a7974' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#7a7974' }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={false} />
                    <Bar dataKey="value" name="Processos" fill="#01696f" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Radar — impactos médios */}
            <div className="card">
              <SectionTitle>Impacto Médio por Dimensão (escala 1–5)</SectionTitle>
              {data.impactData.length === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: 'var(--space-8) 0', textAlign: 'center' }}>
                  Sem dados de impacto
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={data.impactData}>
                    <PolarGrid stroke="var(--color-divider)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#7a7974' }} />
                    <Radar name="Impacto médio" dataKey="A" fill="#01696f" fillOpacity={0.25} stroke="#01696f" strokeWidth={2} />
                    <Tooltip content={<CustomTooltip />} cursor={false} />
                  </RadarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ── Distribuição RTO ─────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
            <div className="card">
              <SectionTitle>Distribuição de RTO</SectionTitle>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.rtoDistrib} barSize={40}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-divider)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#7a7974' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#7a7974' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} cursor={false} />
                  <Bar dataKey="value" name="Processos" fill="#964219" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Processos críticos em destaque */}
            <div className="card">
              <SectionTitle>Processos Críticos</SectionTitle>
              {data.byCriticality[3]?.value === 0 ? (
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: 'var(--space-8) 0', textAlign: 'center' }}>
                  Nenhum processo crítico cadastrado
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  {[3, 2, 1, 0].map(c => {
                    const count = data.byCriticality[c]?.value || 0
                    const pct   = data.total ? (count / data.total * 100).toFixed(0) : 0
                    return (
                      <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <span style={{ width: 60, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                          {CRITICALITY_LABEL[c]}
                        </span>
                        <div style={{ flex: 1, background: 'var(--color-surface-offset)', borderRadius: 4, height: 10 }}>
                          <div style={{
                            width: `${pct}%`, height: '100%',
                            background: CRIT_COLORS[c], borderRadius: 4,
                            transition: 'width .6s ease',
                          }} />
                        </div>
                        <span style={{ width: 28, fontSize: 'var(--text-xs)', fontWeight: 600, color: CRIT_COLORS[c], textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {count}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── Processos recentes ───────────────────────────────────── */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: 'var(--space-5) var(--space-6) var(--space-4)' }}>
              <SectionTitle>Registros Recentes na Blockchain</SectionTitle>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-surface-offset)', borderBottom: '1px solid var(--color-border)' }}>
                  {['#', 'Processo', 'Unidade', 'Criticidade', 'RTO', 'Status', 'Registrado em'].map(h => (
                    <th key={h} style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'left', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.recent.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                    Nenhum processo registrado ainda.
                  </td></tr>
                ) : data.recent.map((p, i) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--color-divider)', background: i % 2 ? 'var(--color-surface)' : 'transparent' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>#{p.id}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', fontWeight: 500 }}>{p.name}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{p.businessUnit}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 'var(--text-xs)', fontWeight: 500, background: CRIT_COLORS[p.criticality] + '22', color: CRIT_COLORS[p.criticality] }}>
                        {CRITICALITY_LABEL[p.criticality]}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', fontVariantNumeric: 'tabular-nums' }}>{minutesToHuman(p.rto)}</td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: ['#bab9b4','#437a22','#7a7974'][p.status] }}>
                      {['Rascunho','Ativo','Arquivado'][p.status]}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      {p.createdAt ? new Date(p.createdAt * 1000).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
