
/**
 * Traduz erros do MetaMask / ethers.js para mensagens legíveis em PT-BR.
 *
 * Casos cobertos:
 *  - Usuário cancelou/rejeitou a assinatura ou conexão
 *  - MetaMask não instalado
 *  - Rede incorreta
 *  - Conta bloqueada / sem permissão
 *  - Timeout / sem resposta
 */
export function friendlyMetaMaskError(err) {
  if (!err) return 'Erro desconhecido.'

  const code = err?.code
  const msg  = (err?.message || err?.shortMessage || String(err)).toLowerCase()
  const rpcUrl = typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/rpc/`
    : 'a URL HTTPS publicada para este ambiente'

  // ── Usuário cancelou / rejeitou ──────────────────────────────────────────
  if (
    code === 4001 ||
    code === 'ACTION_REJECTED' ||
    msg.includes('user denied') ||
    msg.includes('user rejected') ||
    msg.includes('denied message signature') ||
    msg.includes('rejected the request')
  ) {
    return 'Assinatura cancelada pelo usuário. Clique em "Assinar com MetaMask" para tentar novamente.'
  }

  if (
    msg.includes('bia_secure_context_required') ||
    msg.includes('crypto.subtle') ||
    msg.includes("reading 'importkey'") ||
    msg.includes('reading "importkey"')
  ) {
    return 'Este DApp precisa ser acessado por HTTPS para usar a criptografia do navegador após a assinatura. Configure uma URL HTTPS e tente novamente.'
  }

  // ── MetaMask não instalado ───────────────────────────────────────────────
  if (
    !window.ethereum ||
    msg.includes('metamask is not installed') ||
    msg.includes('no ethereum provider')
  ) {
    return 'MetaMask não encontrado. Instale a extensão MetaMask e recarregue a página (F5).'
  }

  // ── Rede incorreta ───────────────────────────────────────────────────────
  if (
    code === 4902 ||
    msg.includes('unrecognized chain') ||
    msg.includes('chain id') ||
    msg.includes('wrong network')
  ) {
    return `Rede incorreta no MetaMask. Configure a rede BIA Besu (RPC: ${rpcUrl}, ChainID: 1337).`
  }

  // ── Conta bloqueada / MetaMask travado ───────────────────────────────────
  if (
    code === -32002 ||
    msg.includes('already processing') ||
    msg.includes('pending request')
  ) {
    return 'O MetaMask está aguardando sua confirmação. Abra a extensão e aceite ou rejeite a solicitação pendente.'
  }

  // ── Carteira não autorizada para este usuário ────────────────────────────
  if (msg.includes('carteira nao autorizada') || msg.includes('wallet not authorized')) {
    return 'Esta carteira não está associada à sua conta. Conecte a carteira correta ou entre em contato com o administrador.'
  }

  // ── Sem conta conectada ──────────────────────────────────────────────────
  if (msg.includes('no accounts') || msg.includes('eth_requestaccounts')) {
    return 'Nenhuma conta conectada no MetaMask. Desbloqueie o MetaMask e tente novamente.'
  }

  // ── Execução revertida pelo contrato ─────────────────────────────────────
  if (
    code === 'CALL_EXCEPTION' ||
    msg.includes('execution reverted') ||
    msg.includes('call exception')
  ) {
    const reason = err?.reason || err?.revert?.args?.[0] || ''
    if (reason.toLowerCase().includes('not admin') || reason.toLowerCase().includes('caller is not admin'))
      return 'Sem permissão: sua carteira não tem papel de administrador no contrato.'
    if (reason && !reason.toLowerCase().includes('require(false)'))
      return `Operação rejeitada pelo contrato: ${reason}`
    return 'A operação foi rejeitada pelo contrato. Verifique se sua carteira tem as permissões necessárias.'
  }

  // ── Saldo insuficiente de gas ─────────────────────────────────────────────
  if (
    code === 'INSUFFICIENT_FUNDS' ||
    msg.includes('insufficient funds') ||
    msg.includes('insufficient balance')
  ) {
    return 'Saldo insuficiente de ETH para pagar o gas da transação.'
  }

  // ── Nó blockchain indisponível ────────────────────────────────────────────
  if (
    code === 'NETWORK_ERROR' ||
    msg.includes('could not detect network') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('econnrefused') ||
    msg.includes('timeout')
  ) {
    return `Não foi possível conectar à rede blockchain. Verifique se o MetaMask está usando o RPC ${rpcUrl} na rede BIA Besu.`
  }

  // ── Transação recusada / parâmetros inválidos ─────────────────────────────
  if (
    code === 'INVALID_ARGUMENT' ||
    code === 'MISSING_ARGUMENT' ||
    msg.includes('invalid argument') ||
    msg.includes('missing argument')
  ) {
    return 'Dados inválidos ao enviar a transação. Verifique as informações e tente novamente.'
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return err?.reason || err?.shortMessage || err?.message || 'Erro inesperado. Tente novamente.'
}
