
import { useState, useCallback, useEffect, useMemo } from 'react'
import { useBIA } from '@/hooks/useBIA'

export const CRITICALITY_LABEL = ['Baixo', 'Médio', 'Alto', 'Crítico']
export const STATUS_LABEL      = ['Rascunho', 'Ativo', 'Arquivado']

// Cores fixas (hex) — recharts SVG não aceita CSS variables
export const CRIT_COLORS   = ['#437a22', '#01696f', '#964219', '#a12c7b']
export const STATUS_COLORS = ['#bab9b4', '#437a22', '#7a7974']

export function minutesToHuman(mins) {
  const m = Number(mins)
  if (!m) return '—'
  if (m < 60)   return `${m}min`
  if (m < 1440) return `${(m / 60).toFixed(0)}h`
  return `${(m / 1440).toFixed(1)}d`
}

function avg(arr, key) {
  if (!arr.length) return 0
  return arr.reduce((s, p) => s + p[key], 0) / arr.length
}

export function useDashboard() {
  const { processes, loading, error, loadProcesses, loadFiles } = useBIA()
  const [totalFiles, setTotalFiles] = useState(0)

  const loadDashboard = useCallback(async () => {
    await loadProcesses()
  }, [loadProcesses])

  // Conta apenas os anexos que esta carteira consegue localizar e decifrar.
  // Não há mais uma consulta global que revele a relação entre anexos e processos.
  useEffect(() => {
    let cancelled = false
    Promise.all(processes.map(process => loadFiles(process)))
      .then(groups => { if (!cancelled) setTotalFiles(groups.reduce((sum, files) => sum + files.length, 0)) })
      .catch(() => { if (!cancelled) setTotalFiles(0) })
    return () => { cancelled = true }
  }, [processes, loadFiles])

  const data = useMemo(() => {
      const procs = processes.map(p => ({ ...p, businessUnit: p.businessUnit || 'Não informado' }))

      // ── Distribuições ────────────────────────────────────────────────────
      const byCriticality = CRITICALITY_LABEL.map((name, i) => ({
        name, value: procs.filter(p => p.criticality === i).length, color: CRIT_COLORS[i],
      }))

      const byStatus = STATUS_LABEL.map((name, i) => ({
        name, value: procs.filter(p => p.status === i).length, color: STATUS_COLORS[i],
      }))

      // Top 8 unidades de negócio
      const unitMap = {}
      procs.forEach(p => { unitMap[p.businessUnit] = (unitMap[p.businessUnit] || 0) + 1 })
      const byUnit = Object.entries(unitMap)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)

      // Impactos médios (para radar)
      const impactData = procs.length ? [
        { subject: 'Financeiro',    A: +avg(procs, 'financialImpact').toFixed(2)    },
        { subject: 'Operacional',   A: +avg(procs, 'operationalImpact').toFixed(2)  },
        { subject: 'Reputacional',  A: +avg(procs, 'reputationalImpact').toFixed(2) },
        { subject: 'Regulatório',   A: +avg(procs, 'regulatoryImpact').toFixed(2)   },
      ] : []

      // RTO/RPO — distribuição por faixas (horas)
      const rtoBuckets = { '< 1h': 0, '1–4h': 0, '4–24h': 0, '> 24h': 0 }
      procs.forEach(p => {
        const h = p.rto / 60
        if (h < 1)       rtoBuckets['< 1h']++
        else if (h <= 4)  rtoBuckets['1–4h']++
        else if (h <= 24) rtoBuckets['4–24h']++
        else              rtoBuckets['> 24h']++
      })
      const rtoDistrib = Object.entries(rtoBuckets).map(([name, value]) => ({ name, value }))

      return {
        total:      procs.length,
        active:     procs.filter(p => p.status === 1).length,
        critical:   procs.filter(p => p.criticality === 3).length,
        totalFiles,
        avgRTO: Math.round(avg(procs, 'rto')),
        avgRPO: Math.round(avg(procs, 'rpo')),
        byCriticality,
        byStatus,
        byUnit,
        impactData,
        rtoDistrib,
        recent: [...procs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5),
      }
  }, [processes, totalFiles])

  return { data, loading, error, loadDashboard }
}
