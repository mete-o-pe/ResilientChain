'use client'
import { useState }              from 'react'
import { useNavigate }           from 'react-router-dom'
import { ethers }                from 'ethers'
import { useAuth }               from '@/contexts/AuthContext'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'
import { FIXED_SIGN_MESSAGE, deriveX25519KeyPair } from '@/crypto/cryptoUtils'
import { getContract }           from '@/services/contractService'
import { sendContractTransaction } from '@/utils/contractTransaction'
const AUTH_URL = import.meta.env.VITE_AUTH_URL ?? ''

async function apiPost(path, body) {
  const res = await fetch(AUTH_URL + path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
  return data
}

export default function LoginPage() {
  const { login }                 = useAuth()
  const navigate                  = useNavigate()
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [retryable, setRetryable] = useState(false)

  async function connectWallet() {
    setError('')
    setRetryable(false)
    setLoading(true)
    try {
      if (!window.ethereum)
        throw new Error('MetaMask não encontrado. Instale a extensão e recarregue a página.')

      const provider = new ethers.BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const signer  = await provider.getSigner()
      const address = await signer.getAddress()

      const { sessionId, nonce } = await apiPost('/api/auth/wallet-challenge', { walletAddress: address })

      const signature = await signer.signMessage(nonce)

      const data = await apiPost('/api/auth/wallet-verify', { sessionId, signature })

      // ── Derivação de chaves X25519 ───────────────────────────────────────
      // Assinatura sobre mensagem fixa (determinística) → PBKDF2 → X25519
      if (!window.isSecureContext || !crypto?.subtle) {
        throw new Error('BIA_SECURE_CONTEXT_REQUIRED')
      }
      const keySignature = await signer.signMessage(FIXED_SIGN_MESSAGE)
      const x25519KeyPair = await deriveX25519KeyPair(keySignature)

      // Registrar chave pública no AccessManager (somente se ainda não registrada)
      const accessMgr = await getContract('AccessManager')
      const { registered } = await accessMgr.getEncryptionPublicKey(address)
      if (!registered) {
        // bytes32: ethers.hexlify garante encoding como hex fixo de 32 bytes
        const pubKeyBytes32 = ethers.hexlify(x25519KeyPair.pubKeyBytes)
        await sendContractTransaction({
          operation: 'AccessManager.registerEncryptionKey',
          method: accessMgr.registerEncryptionKey,
          args: [pubKeyBytes32],
        })
      }

      login(data.token, data.user, x25519KeyPair)
      navigate('/', { replace: true })
    } catch (err) {
      const isCancelled =
        err?.code === 4001 ||
        err?.code === 'ACTION_REJECTED' ||
        (err?.message || '').toLowerCase().includes('denied') ||
        (err?.message || '').toLowerCase().includes('rejected')

      setError(friendlyMetaMaskError(err))
      setRetryable(isCancelled)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight:      '100dvh',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'var(--color-bg)',
      padding:        'var(--space-4)',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="card" style={{
          padding:       'var(--space-8)',
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--space-6)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
              BIA DApp
            </h1>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Conecte sua carteira para acessar o sistema.
            </p>
          </div>

          {error && (
            <div style={{
              background:   'var(--color-error-highlight)',
              color:        'var(--color-error)',
              padding:      'var(--space-3) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              fontSize:     'var(--text-sm)',
              lineHeight:   1.5,
            }}>
              {error}
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={connectWallet}
            disabled={loading}
            style={{ fontSize: 'var(--text-base)', padding: 'var(--space-4)' }}
          >
            {loading
              ? 'Aguardando MetaMask\u2026'
              : retryable
              ? '\u21a9 Tentar Novamente'
              : 'Conectar com MetaMask'}
          </button>

          <p style={{
            fontSize:  'var(--text-xs)',
            color:     'var(--color-text-faint)',
            textAlign: 'center',
          }}>
            Uma mensagem será assinada para verificar sua identidade.
            Nenhuma transação será realizada.
          </p>
        </div>
      </div>
    </div>
  )
}
