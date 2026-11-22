const DEFAULT_GAS_MARGIN_PERCENT = 25
const TELEMETRY_STORAGE_KEY = 'bia.transactionTelemetry.v1'
const TELEMETRY_STORAGE_LIMIT = 200

function configuredGasMarginPercent() {
  const configured = Number(import.meta.env?.VITE_TX_GAS_MARGIN_PERCENT)
  return Number.isInteger(configured) && configured >= 0 && configured <= 100
    ? configured
    : DEFAULT_GAS_MARGIN_PERCENT
}

export function addGasSafetyMargin(estimatedGas, marginPercent = configuredGasMarginPercent()) {
  const gas = BigInt(estimatedGas)
  if (!Number.isInteger(marginPercent) || marginPercent < 0 || marginPercent > 100) {
    throw new RangeError('A margem de gas deve ser um inteiro entre 0 e 100')
  }

  const multiplier = BigInt(100 + marginPercent)
  return (gas * multiplier + 99n) / 100n
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function elapsedMs(start, end) {
  return Number((end - start).toFixed(1))
}

function transactionId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function persistTelemetry(record) {
  if (typeof window === 'undefined') return

  try {
    const previous = JSON.parse(window.localStorage.getItem(TELEMETRY_STORAGE_KEY) || '[]')
    const records = Array.isArray(previous) ? previous : []
    records.push(record)
    window.localStorage.setItem(
      TELEMETRY_STORAGE_KEY,
      JSON.stringify(records.slice(-TELEMETRY_STORAGE_LIMIT)),
    )
  } catch (error) {
    console.warn('[BIA tx] Não foi possível persistir a telemetria local:', error)
  }

  window.dispatchEvent(new CustomEvent('bia:transaction-telemetry', { detail: record }))
}

function completeTelemetry(record) {
  persistTelemetry(record)
  console.info('[BIA tx]', record)
  return record
}

/**
 * Estima gas, acrescenta uma margem de segurança e mede as fases de uma
 * escrita EVM. A telemetria não inclui calldata nem dados de negócio: fica no
 * console e nas 200 entradas mais recentes do localStorage do navegador.
 */
export async function sendContractTransaction({ operation, method, args = [], confirmations = 1 }) {
  if (typeof method !== 'function' || typeof method.estimateGas !== 'function') {
    throw new TypeError(`Método de contrato inválido para ${operation}`)
  }

  const marginPercent = configuredGasMarginPercent()
  const startedAt = nowMs()
  const startedAtIso = new Date().toISOString()
  let phase = 'estimateGas'
  let estimateCompletedAt
  let broadcastAt
  let estimatedGas
  let gasLimit
  let tx

  try {
    estimatedGas = await method.estimateGas(...args)
    estimateCompletedAt = nowMs()
    gasLimit = addGasSafetyMargin(estimatedGas, marginPercent)

    phase = 'walletApprovalAndBroadcast'
    tx = await method(...args, { gasLimit })
    broadcastAt = nowMs()

    phase = 'confirmation'
    const receipt = await tx.wait(confirmations)
    const confirmedAt = nowMs()
    const telemetry = completeTelemetry({
      id: transactionId(),
      operation,
      outcome: 'confirmed',
      startedAt: startedAtIso,
      transactionHash: tx.hash,
      blockNumber: Number(receipt.blockNumber),
      status: Number(receipt.status),
      estimatedGas: estimatedGas.toString(),
      gasLimit: gasLimit.toString(),
      marginPercent,
      durationsMs: {
        estimateGas: elapsedMs(startedAt, estimateCompletedAt),
        walletApprovalAndBroadcast: elapsedMs(estimateCompletedAt, broadcastAt),
        confirmation: elapsedMs(broadcastAt, confirmedAt),
        total: elapsedMs(startedAt, confirmedAt),
      },
    })

    return { transaction: tx, receipt, telemetry }
  } catch (error) {
    const failedAt = nowMs()
    const telemetry = completeTelemetry({
      id: transactionId(),
      operation,
      outcome: 'failed',
      failedPhase: phase,
      startedAt: startedAtIso,
      transactionHash: tx?.hash ?? error?.transactionHash ?? error?.receipt?.hash ?? null,
      estimatedGas: estimatedGas?.toString() ?? null,
      gasLimit: gasLimit?.toString() ?? null,
      marginPercent,
      durationMs: elapsedMs(startedAt, failedAt),
      error: {
        code: error?.code ?? null,
        message: error?.shortMessage ?? error?.message ?? String(error),
      },
    })
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      error.biaTransactionTelemetry = telemetry
    }
    throw error
  }
}

export {
  DEFAULT_GAS_MARGIN_PERCENT,
  TELEMETRY_STORAGE_KEY,
}
