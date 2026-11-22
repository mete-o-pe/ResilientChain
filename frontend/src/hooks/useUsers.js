
import { useState, useCallback } from 'react'
import { ethers } from 'ethers'
import { getContract, getProvider } from '@/services/contractService'
import { userService } from '@/services/userService'
import { friendlyMetaMaskError } from '@/utils/metamaskErrors'
import { sendContractTransaction } from '@/utils/contractTransaction'

const ROLES_ABI = [
  'function grantRole(address user, uint8 role) external',
  'function getRoles(address user) view returns (bool isAdmin, bool isAnalyst, bool isViewer)',
]

export function useUsers() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  // Carrega usuários da API + roles do contrato para cada carteira cadastrada
  const loadUsers = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { users: list } = await userService.list()
      const provider = await getProvider()
      const addr     = await fetch('/contracts/addresses.json', { cache: 'no-store' }).then(r => r.json())
      const am       = new ethers.Contract(addr.AccessManager, ROLES_ABI, provider)

      const enriched = await Promise.all(
        list.map(async u => {
          if (!u.walletAddress) return { ...u, chainRoles: null }
          try {
            const [isAdmin, isAnalyst, isViewer] = await am.getRoles(u.walletAddress)
            return { ...u, chainRoles: { isAdmin, isAnalyst, isViewer } }
          } catch {
            return { ...u, chainRoles: null }
          }
        })
      )
      setUsers(enriched)
    } catch (e) {
      setError(friendlyMetaMaskError(e))
    } finally { setLoading(false) }
  }, [])

  const createUser = useCallback(async (data) => {
    await userService.create(data)
    // Concede automaticamente o papel na blockchain ao criar o usuário
    if (data.walletAddress && data.role && data.role !== 'NONE') {
      const roleNumber = data.role === 'ADMIN' ? 3 : data.role === 'ANALYST' ? 2 : 1
      try {
        const am = await getContract('AccessManager')
        await sendContractTransaction({
          operation: 'AccessManager.grantRole.createUser',
          method: am.grantRole,
          args: [data.walletAddress, roleNumber],
        })
      } catch (err) {
        console.warn('[useUsers] grantRole blockchain falhou:', err.message)
        // Não bloqueia a criação — usuário salvo no backend, papel blockchain pendente
      }
    }
    await loadUsers()
  }, [loadUsers])

  const updateUser = useCallback(async (id, data) => {
    await userService.update(id, data)
    await loadUsers()
  }, [loadUsers])

  const deleteUser = useCallback(async (id) => {
    await userService.remove(id)
    await loadUsers()
  }, [loadUsers])

  // Concede ou revoga um papel na blockchain (requer MetaMask - wallet ADMIN)
  // Enum Role do contrato: NONE=0, VIEWER=1, ANALYST=2, ADMIN=3
  const setChainRole = useCallback(async (walletAddress, roleKey, grant) => {
    const am = await getContract('AccessManager')  // usa signer (MetaMask)

    const roleNumber = grant
      ? (roleKey === 'ADMIN' ? 3 : roleKey === 'ANALYST' ? 2 : 1)
      : 0  // NONE — revoga o papel atual

    await sendContractTransaction({
      operation: 'AccessManager.grantRole.setChainRole',
      method: am.grantRole,
      args: [walletAddress, roleNumber],
    })
    await loadUsers()
  }, [loadUsers])

  return { users, loading, error, loadUsers, createUser, updateUser, deleteUser, setChainRole }
}
