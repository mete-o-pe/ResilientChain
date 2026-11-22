
// SPDX-License-Identifier: MIT
// pragma solidity ^0.8.20;
pragma solidity ^0.8.27;

/**
 * @title  AccessManager
 * @notice Gerencia papéis, chaves de criptografia X25519 e PMKs cifradas por processo.
 *         Fase 9 — BIA DApp
 *
 * Fluxo:
 *   1. Admin concede papéis (VIEWER / ANALYST / ADMIN) via grantRole()
 *   2. Cada usuário registra sua chave pública X25519 via registerEncryptionKey()
 *   3. Ao criar um processo, o criador armazena o PMK cifrado para si via storePMK()
 *   4. Para conceder acesso: detentor do PMK o decifra off-chain e o cifra para o
 *      destinatário, depois chama storePMK() novamente
 *   5. Admin pode revogar acesso via revokePMK()
 */
contract AccessManager {

    // ── Papéis ────────────────────────────────────────────────────────────
    enum Role { NONE, VIEWER, ANALYST, ADMIN }

    address public owner;
    mapping(address => Role) private _roles;

    // ── Chaves de criptografia X25519 (32 bytes por usuário) ─────────────
    mapping(address => bytes32) private _encKeys;
    mapping(address => bool)    private _encKeySet;

    // ── PMK cifrado: processId → usuário → blob (92 bytes típico) ────────
    mapping(uint256 => mapping(address => bytes)) private _pmk;
    // Lista de usuários que já receberam PMK (para listagem)
    mapping(uint256 => address[]) private _pmkUsers;

    // ── Eventos ───────────────────────────────────────────────────────────
    event RoleGranted(address indexed user, Role role);
    event EncryptionKeyRegistered(address indexed user, bytes32 pubKey);
    event PMKStored(uint256 indexed processId, address indexed user);
    event PMKRevoked(uint256 indexed processId, address indexed user);

    // ── Modificadores ─────────────────────────────────────────────────────
    modifier onlyOwnerOrAdmin() {
        require(
            msg.sender == owner || _roles[msg.sender] == Role.ADMIN,
            "AccessManager: caller is not admin"
        );
        _;
    }

    modifier onlyAnalystOrAdmin() {
        require(
            msg.sender == owner ||
            _roles[msg.sender] == Role.ADMIN ||
            _roles[msg.sender] == Role.ANALYST,
            "AccessManager: caller is not analyst or admin"
        );
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────
    constructor() {
        owner = msg.sender;
        _roles[msg.sender] = Role.ADMIN;
        emit RoleGranted(msg.sender, Role.ADMIN);
    }

    // ════════════════════════════════════════════════════════════════════════
    // Papéis
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Concede um papel a um endereço. Somente admin.
    function grantRole(address user, Role role) external onlyOwnerOrAdmin {
        require(user != address(0), "AccessManager: zero address");
        _roles[user] = role;
        emit RoleGranted(user, role);
    }

    /// @notice Retorna os papéis de um endereço.
    function getRoles(address user)
        external view
        returns (bool isAdmin, bool isAnalyst, bool isViewer)
    {
        Role r = _roles[user];
        isAdmin   = (r == Role.ADMIN);
        isAnalyst = (r == Role.ANALYST);
        isViewer  = (r == Role.VIEWER);
    }

    /// @notice Retorna o papel numérico (0=NONE, 1=VIEWER, 2=ANALYST, 3=ADMIN).
    function getRole(address user) external view returns (Role) {
        return _roles[user];
    }

    // ════════════════════════════════════════════════════════════════════════
    // Chaves de criptografia
    // ════════════════════════════════════════════════════════════════════════

    /**
     * @notice Registra a chave pública X25519 do chamador.
     *         Deve ser chamado uma vez por usuário no primeiro login.
     * @param pubKey  32 bytes da chave pública X25519 (derivada off-chain do MetaMask)
     */
    function registerEncryptionKey(bytes32 pubKey) external {
        require(pubKey != bytes32(0), "AccessManager: empty key");
        require(!_encKeySet[msg.sender], "AccessManager: chave ja registrada; use rotateEncryptionKey para rotacionar");
        _encKeys[msg.sender]   = pubKey;
        _encKeySet[msg.sender] = true;
        emit EncryptionKeyRegistered(msg.sender, pubKey);
    }

    /**
     * @notice Permite ao usuário rotacionar sua chave X25519.
     *         Requer aprovação de admin para evitar invalidação acidental de PMKs.
     *         PMKs existentes devem ser re-cifrados antes ou após a rotação.
     */
    function rotateEncryptionKey(bytes32 newPubKey) external onlyOwnerOrAdmin {
        require(newPubKey != bytes32(0), "AccessManager: empty key");
        _encKeys[msg.sender]   = newPubKey;
        _encKeySet[msg.sender] = true;
        emit EncryptionKeyRegistered(msg.sender, newPubKey);
    }

    /**
     * @notice Retorna a chave pública X25519 de um endereço.
     * @return pubKey     bytes32 - a chave (zeros se nao registrada)
     * @return registered bool    - se o usuario ja registrou sua chave
     */
    function getEncryptionPublicKey(address user)
        external view
        returns (bytes32 pubKey, bool registered)
    {
        return (_encKeys[user], _encKeySet[user]);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PMK (Process Master Key) — armazenamento cifrado
    // ═════════════════════════════════════════════════════════════════════════


    /**
     * @notice Armazena o PMK cifrado para um usuário específico.
     *         — O chamador pode armazenar para si mesmo (self-encrypt ao criar processo).
     *         — Para armazenar para outro, o chamador deve ser ANALYST ou ADMIN.
     *
     * @param processId  ID do processo
     * @param user       Endereço do destinatário
     * @param encPMK     PMK cifrado (92 bytes: [senderPubKey:32][iv:12][cipher:48])
     */
    function storePMK(
        uint256 processId,
        address user,
        bytes calldata encPMK
    ) external {
        require(encPMK.length == 92, "AccessManager: encPMK deve ter exatamente 92 bytes");
        require(_encKeySet[user], "AccessManager: destinatario sem chave de cifragem registrada");

        if (user != msg.sender) {
            // Apenas ADMIN pode conceder acesso arbitrariamente;
            // ANALYST só pode compartilhar se já tiver o PMK do processo (acesso legítimo)
            bool isAdminCaller = msg.sender == owner || _roles[msg.sender] == Role.ADMIN;
            bool hasOwnPMK     = _pmk[processId][msg.sender].length > 0;
            require(
                isAdminCaller || hasOwnPMK,
                "AccessManager: sem autorizacao para conceder acesso a este processo"
            );
        }

        // Adiciona à lista somente se for novo
        if (_pmk[processId][user].length == 0) {
            _pmkUsers[processId].push(user);
        }
        _pmk[processId][user] = encPMK;
        emit PMKStored(processId, user);
    }

    /**
     * @notice Retorna o PMK cifrado do CHAMADOR para um processo.
     *         Cada usuário só vê o seu próprio PMK.
     */
    function getPMK(uint256 processId)
        external view
        returns (bytes memory)
    {
        return _pmk[processId][msg.sender];
    }

    /**
     * @notice Revoga o acesso de um usuário ao PMK de um processo.
     *         Somente ADMIN pode revogar acesso de outros.
     */
    function revokePMK(uint256 processId, address user) external onlyOwnerOrAdmin {
        require(user != msg.sender, "AccessManager: cannot revoke own access");
        delete _pmk[processId][user];
        emit PMKRevoked(processId, user);
    }

    /**
     * @notice Lista os endereços que já receberam PMK para um processo.
     *         Inclui revogados — filtre pelo evento PMKRevoked off-chain.
     */
    function getPMKUsers(uint256 processId)
        external view
        returns (address[] memory)
    {
        return _pmkUsers[processId];
    }
}
