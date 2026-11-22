import { ethers } from 'ethers'

// Cache em memória para ABIs (não mudam sem redeploy explícito)
// addresses.json é sempre buscado fresco (cache-busting via timestamp)
const _abiCache = {}

async function loadJSON(path) {
  if (_abiCache[path]) return _abiCache[path]
  const res = await fetch(path)
  if (!res.ok) throw new Error(`Não foi possível carregar ${path}: ${res.status}`)
  const data = await res.json()
  _abiCache[path] = data
  return data
}

async function loadAddresses() {
  // Timestamp impede que o browser sirva versão cacheada após make deploy
  const res = await fetch(`/contracts/addresses.json?t=${Date.now()}`)
  if (!res.ok) throw new Error(`Não foi possível carregar addresses.json: ${res.status}`)
  return res.json()
}

/** Força recarga do addresses.json (útil após make deploy) */
export function clearContractCache() {
  Object.keys(_abiCache).forEach(k => delete _abiCache[k])
}

export async function getProvider() {
  if (!window.ethereum) throw new Error('MetaMask não encontrado. Instale a extensão.')
  return new ethers.BrowserProvider(window.ethereum)
}

export async function getSigner() {
  const provider = await getProvider()
  await provider.send('eth_requestAccounts', [])
  return await provider.getSigner()
}

export async function signMessage(message) {
  const signer = await getSigner()
  return signer.signMessage(message)
}

export async function getWalletAddress() {
  const signer = await getSigner()
  return signer.getAddress()
}

/**
 * Conecta a um contrato implantado.
 * addresses.json é sempre buscado fresco (sem cache) para garantir
 * que endereços novos após make deploy sejam usados imediatamente.
 * ABIs ficam em cache (não mudam sem recompilação).
 */
export async function getContract(name) {
  const addresses = await loadAddresses()

  if (!addresses[name]) {
    clearContractCache()
    throw new Error(
      `Contrato "${name}" não encontrado. Execute: make node && make deploy`
    )
  }

  const abi    = await loadJSON(`/contracts/abis/${name}.json`)
  const signer = await getSigner()
  return new ethers.Contract(addresses[name], abi, signer)
}
