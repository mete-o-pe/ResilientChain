// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./AccessManager.sol";

/**
 * @title BIARegistry
 * @notice Registra processos BIA sem expor seu conteúdo na blockchain.
 *
 * Os dados de negócio são cifrados no browser com a PMK do processo e
 * persistidos como bytes opacos. Status e timestamps permanecem públicos para
 * que as regras de ciclo de vida continuem verificáveis on-chain.
 */
contract BIARegistry {

    enum Status { DRAFT, ACTIVE, ARCHIVED }

    /// @dev Limite de armazenamento/gás para o envelope AES-GCM do processo.
    uint256 public constant MAX_ENCRYPTED_PROCESS_DATA_BYTES = 8192;

    struct BIAProcess {
        uint256 id;
        bytes encryptedData;
        address owner;
        Status status;
        uint256 createdAt;
        uint256 updatedAt;
        address createdBy;
    }

    AccessManager public immutable accessManager;
    uint256 private _processCounter;
    mapping(uint256 => BIAProcess) private _processes;
    mapping(address => uint256[]) private _processByOwner;
    uint256[] private _allProcessIds;

    event ProcessCreated(uint256 indexed id, address indexed owner);
    event ProcessUpdated(uint256 indexed id, address indexed updatedBy);
    event ProcessStatusChanged(
        uint256 indexed id,
        Status oldStatus,
        Status newStatus,
        address indexed changedBy
    );

    modifier onlyAnalyst() {
        AccessManager.Role role = accessManager.getRole(msg.sender);
        require(
            role == AccessManager.Role.ANALYST ||
            role == AccessManager.Role.ADMIN ||
            msg.sender == accessManager.owner(),
            "BIARegistry: apenas ANALYST ou ADMIN"
        );
        _;
    }

    modifier onlyViewer() {
        AccessManager.Role role = accessManager.getRole(msg.sender);
        require(
            role != AccessManager.Role.NONE || msg.sender == accessManager.owner(),
            "BIARegistry: acesso negado"
        );
        _;
    }

    modifier processExists(uint256 id) {
        require(_processes[id].id != 0, "BIARegistry: processo nao encontrado");
        _;
    }

    constructor(address accessManagerAddress) {
        require(accessManagerAddress != address(0), "BIARegistry: zero address");
        accessManager = AccessManager(accessManagerAddress);
    }

    function _validateEncryptedData(bytes calldata encryptedData) internal pure {
        require(encryptedData.length > 28, "BIARegistry: payload cifrado vazio ou invalido");
        require(
            encryptedData.length <= MAX_ENCRYPTED_PROCESS_DATA_BYTES,
            "BIARegistry: payload cifrado excede o limite"
        );
    }

    function createProcess(bytes calldata encryptedData)
        external
        onlyAnalyst
        returns (uint256)
    {
        _validateEncryptedData(encryptedData);

        _processCounter++;
        uint256 id = _processCounter;
        _processes[id] = BIAProcess({
            id: id,
            encryptedData: encryptedData,
            owner: msg.sender,
            status: Status.DRAFT,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            createdBy: msg.sender
        });
        _allProcessIds.push(id);
        _processByOwner[msg.sender].push(id);

        emit ProcessCreated(id, msg.sender);
        return id;
    }

    function updateProcess(uint256 id, bytes calldata encryptedData)
        external
        onlyAnalyst
        processExists(id)
    {
        require(
            _processes[id].status != Status.ARCHIVED,
            "BIARegistry: processo arquivado nao pode ser editado"
        );
        require(
            _processes[id].owner == msg.sender ||
            accessManager.getRole(msg.sender) == AccessManager.Role.ADMIN ||
            msg.sender == accessManager.owner(),
            "BIARegistry: apenas o proprietario ou ADMIN pode editar"
        );
        _validateEncryptedData(encryptedData);

        BIAProcess storage p = _processes[id];
        p.encryptedData = encryptedData;
        p.updatedAt = block.timestamp;
        emit ProcessUpdated(id, msg.sender);
    }

    function setStatus(uint256 id, Status newStatus)
        external
        onlyAnalyst
        processExists(id)
    {
        Status old = _processes[id].status;
        require(newStatus != old, "BIARegistry: processo ja possui este status");
        if (newStatus == Status.ARCHIVED || old == Status.ARCHIVED) {
            require(
                accessManager.getRole(msg.sender) == AccessManager.Role.ADMIN ||
                msg.sender == accessManager.owner(),
                "BIARegistry: apenas ADMIN pode arquivar ou desarquivar"
            );
        }
        _processes[id].status = newStatus;
        _processes[id].updatedAt = block.timestamp;
        emit ProcessStatusChanged(id, old, newStatus, msg.sender);
    }

    function getProcess(uint256 id)
        external
        view
        onlyViewer
        processExists(id)
        returns (BIAProcess memory)
    {
        return _processes[id];
    }

    function getAllProcessIds() external view onlyViewer returns (uint256[] memory) {
        return _allProcessIds;
    }

    function getProcessesByOwner(address owner)
        external
        view
        onlyViewer
        returns (uint256[] memory)
    {
        return _processByOwner[owner];
    }

    function getTotalProcesses() external view returns (uint256) {
        return _processCounter;
    }
}
