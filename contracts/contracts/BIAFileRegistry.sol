// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "./AccessManager.sol";

/**
 * @title BIAFileRegistry
 * @notice Registra anexos sem revelar o processo ao qual pertencem.
 *
 * O browser gera uma referência aleatória por processo. A referência, CID e
 * demais metadados são mantidos fora dos dados legíveis do processo; apenas a
 * referência opaca e o envelope cifrado são persistidos aqui.
 */
contract BIAFileRegistry {
    uint256 public constant MAX_ENCRYPTED_FILE_METADATA_BYTES = 2048;

    struct BIAFile {
        uint256 id;
        bytes32 opaqueProcessRef;
        bytes encryptedMetadata;
        address uploadedBy;
        uint256 uploadedAt;
        bool active;
    }

    AccessManager public immutable accessManager;
    uint256 private _fileCounter;
    mapping(uint256 => BIAFile) private _files;
    mapping(bytes32 => uint256[]) private _filesByOpaqueProcessRef;

    event FileAdded(uint256 indexed fileId, bytes32 indexed opaqueProcessRef, address indexed uploadedBy);
    event FileRemoved(uint256 indexed fileId, bytes32 indexed opaqueProcessRef, address indexed removedBy);

    modifier onlyAnalyst() {
        AccessManager.Role role = accessManager.getRole(msg.sender);
        require(
            role == AccessManager.Role.ANALYST ||
            role == AccessManager.Role.ADMIN ||
            msg.sender == accessManager.owner(),
            "BIAFileRegistry: apenas ANALYST ou ADMIN"
        );
        _;
    }

    modifier onlyViewer() {
        AccessManager.Role role = accessManager.getRole(msg.sender);
        require(
            role != AccessManager.Role.NONE || msg.sender == accessManager.owner(),
            "BIAFileRegistry: acesso negado"
        );
        _;
    }

    modifier fileExists(uint256 fileId) {
        require(_files[fileId].id != 0, "BIAFileRegistry: arquivo nao encontrado");
        _;
    }

    constructor(address accessManagerAddress) {
        require(accessManagerAddress != address(0), "BIAFileRegistry: zero address");
        accessManager = AccessManager(accessManagerAddress);
    }

    function addFile(bytes32 opaqueProcessRef, bytes calldata encryptedMetadata)
        external
        onlyAnalyst
        returns (uint256)
    {
        require(opaqueProcessRef != bytes32(0), "BIAFileRegistry: referencia opaca obrigatoria");
        require(encryptedMetadata.length > 28, "BIAFileRegistry: metadados cifrados invalidos");
        require(
            encryptedMetadata.length <= MAX_ENCRYPTED_FILE_METADATA_BYTES,
            "BIAFileRegistry: metadados cifrados excedem o limite"
        );

        _fileCounter++;
        uint256 id = _fileCounter;
        _files[id] = BIAFile({
            id: id,
            opaqueProcessRef: opaqueProcessRef,
            encryptedMetadata: encryptedMetadata,
            uploadedBy: msg.sender,
            uploadedAt: block.timestamp,
            active: true
        });
        _filesByOpaqueProcessRef[opaqueProcessRef].push(id);
        emit FileAdded(id, opaqueProcessRef, msg.sender);
        return id;
    }

    function removeFile(uint256 fileId)
        external
        onlyAnalyst
        fileExists(fileId)
    {
        require(_files[fileId].active, "BIAFileRegistry: arquivo ja removido");
        require(
            _files[fileId].uploadedBy == msg.sender ||
            accessManager.getRole(msg.sender) == AccessManager.Role.ADMIN ||
            msg.sender == accessManager.owner(),
            "BIAFileRegistry: apenas o uploader ou ADMIN pode remover"
        );
        _files[fileId].active = false;
        emit FileRemoved(fileId, _files[fileId].opaqueProcessRef, msg.sender);
    }

    function getFile(uint256 fileId)
        external
        view
        onlyViewer
        fileExists(fileId)
        returns (BIAFile memory)
    {
        return _files[fileId];
    }

    function getActiveFilesByOpaqueProcessRef(bytes32 opaqueProcessRef)
        external
        view
        onlyViewer
        returns (BIAFile[] memory)
    {
        uint256[] storage ids = _filesByOpaqueProcessRef[opaqueProcessRef];
        uint256 count;
        for (uint256 i = 0; i < ids.length; i++) if (_files[ids[i]].active) count++;

        BIAFile[] memory result = new BIAFile[](count);
        uint256 j;
        for (uint256 i = 0; i < ids.length; i++) {
            if (_files[ids[i]].active) result[j++] = _files[ids[i]];
        }
        return result;
    }

}
