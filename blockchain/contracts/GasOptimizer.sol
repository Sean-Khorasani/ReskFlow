// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/metatx/ERC2771ContextUpgradeable.sol";

interface IDeliveryRegistry {
    function batchUpdateStatus(
        bytes32[] calldata _reskflowIds,
        uint8[] calldata _statuses,
        string[] calldata _locations
    ) external;
}

contract GasOptimizer is 
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ERC2771ContextUpgradeable
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant AGGREGATOR_ROLE = keccak256("AGGREGATOR_ROLE");

    struct BatchData {
        bytes32 merkleRoot;
        uint256 timestamp;
        uint256 reskflowCount;
        string ipfsHash; // Contains full reskflow data
        bool processed;
    }

    struct MetaTransaction {
        address from;
        address to;
        uint256 value;
        uint256 nonce;
        bytes data;
        bytes signature;
    }

    // State variables
    IDeliveryRegistry public reskflowRegistry;
    mapping(bytes32 => BatchData) public batches;
    mapping(bytes32 => mapping(uint256 => bool)) public processedLeaves;
    mapping(address => uint256) public nonces;
    
    uint256 public batchCount;
    uint256 public constant MAX_BATCH_SIZE = 100;
    uint256 public constant BATCH_INTERVAL = 5 minutes;
    uint256 public lastBatchTime;

    // Events
    event BatchCreated(
        bytes32 indexed batchId,
        bytes32 merkleRoot,
        uint256 reskflowCount,
        string ipfsHash
    );
    
    event BatchProcessed(
        bytes32 indexed batchId,
        uint256 processedCount
    );
    
    event MetaTransactionExecuted(
        address indexed from,
        address indexed to,
        uint256 nonce,
        bool success
    );
    
    event DeliveryVerified(
        bytes32 indexed batchId,
        bytes32 indexed reskflowId,
        uint256 leafIndex
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _trustedForwarder) ERC2771ContextUpgradeable(_trustedForwarder) {
        _disableInitializers();
    }

    function initialize(
        address _admin,
        address _reskflowRegistry
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        __ERC2771Context_init(_trustedForwarder());

        require(_reskflowRegistry != address(0), "Invalid registry");

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);

        reskflowRegistry = IDeliveryRegistry(_reskflowRegistry);
        lastBatchTime = block.timestamp;
    }

    function createBatch(
        bytes32 _merkleRoot,
        uint256 _reskflowCount,
        string calldata _ipfsHash
    ) external onlyRole(AGGREGATOR_ROLE) whenNotPaused {
        require(_reskflowCount > 0 && _reskflowCount <= MAX_BATCH_SIZE, "Invalid count");
        require(bytes(_ipfsHash).length > 0, "Invalid IPFS hash");
        require(block.timestamp >= lastBatchTime + BATCH_INTERVAL, "Too soon");

        bytes32 batchId = keccak256(
            abi.encodePacked(_merkleRoot, block.timestamp, batchCount)
        );

        batches[batchId] = BatchData({
            merkleRoot: _merkleRoot,
            timestamp: block.timestamp,
            reskflowCount: _reskflowCount,
            ipfsHash: _ipfsHash,
            processed: false
        });

        batchCount++;
        lastBatchTime = block.timestamp;

        emit BatchCreated(batchId, _merkleRoot, _reskflowCount, _ipfsHash);
    }

    function verifyAndUpdateDelivery(
        bytes32 _batchId,
        bytes32 _reskflowId,
        uint8 _status,
        string calldata _location,
        uint256 _leafIndex,
        bytes32[] calldata _proof
    ) external whenNotPaused {
        BatchData storage batch = batches[_batchId];
        require(batch.timestamp > 0, "Batch not found");
        require(!processedLeaves[_batchId][_leafIndex], "Already processed");

        // Construct leaf data
        bytes32 leaf = keccak256(abi.encodePacked(_reskflowId, _status, _location));

        // Verify Merkle proof
        require(
            MerkleProof.verify(_proof, batch.merkleRoot, leaf),
            "Invalid proof"
        );

        processedLeaves[_batchId][_leafIndex] = true;

        // Update reskflow status on-chain
        bytes32[] memory reskflowIds = new bytes32[](1);
        uint8[] memory statuses = new uint8[](1);
        string[] memory locations = new string[](1);

        reskflowIds[0] = _reskflowId;
        statuses[0] = _status;
        locations[0] = _location;

        reskflowRegistry.batchUpdateStatus(reskflowIds, statuses, locations);

        emit DeliveryVerified(_batchId, _reskflowId, _leafIndex);
    }

    function processBatch(
        bytes32 _batchId,
        bytes32[] calldata _reskflowIds,
        uint8[] calldata _statuses,
        string[] calldata _locations,
        bytes32[][] calldata _proofs,
        uint256[] calldata _leafIndices
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        BatchData storage batch = batches[_batchId];
        require(batch.timestamp > 0, "Batch not found");
        require(!batch.processed, "Already processed");
        require(_reskflowIds.length == _statuses.length, "Length mismatch");
        require(_reskflowIds.length == _locations.length, "Length mismatch");
        require(_reskflowIds.length == _proofs.length, "Length mismatch");
        require(_reskflowIds.length == _leafIndices.length, "Length mismatch");

        uint256 processedCount = 0;

        for (uint256 i = 0; i < _reskflowIds.length; i++) {
            if (!processedLeaves[_batchId][_leafIndices[i]]) {
                bytes32 leaf = keccak256(
                    abi.encodePacked(_reskflowIds[i], _statuses[i], _locations[i])
                );

                if (MerkleProof.verify(_proofs[i], batch.merkleRoot, leaf)) {
                    processedLeaves[_batchId][_leafIndices[i]] = true;
                    processedCount++;
                }
            }
        }

        if (processedCount > 0) {
            reskflowRegistry.batchUpdateStatus(_reskflowIds, _statuses, _locations);
        }

        batch.processed = true;
        emit BatchProcessed(_batchId, processedCount);
    }

    function executeMetaTransaction(
        MetaTransaction calldata _tx
    ) external onlyRole(RELAYER_ROLE) whenNotPaused returns (bool success) {
        require(_tx.nonce == nonces[_tx.from], "Invalid nonce");

        // Verify signature
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparatorV4(),
                keccak256(
                    abi.encode(
                        keccak256("MetaTransaction(address from,address to,uint256 value,uint256 nonce,bytes data)"),
                        _tx.from,
                        _tx.to,
                        _tx.value,
                        _tx.nonce,
                        keccak256(_tx.data)
                    )
                )
            )
        );

        address signer = _recover(digest, _tx.signature);
        require(signer == _tx.from, "Invalid signature");

        nonces[_tx.from]++;

        // Execute transaction
        (success, ) = _tx.to.call{value: _tx.value}(_tx.data);

        emit MetaTransactionExecuted(_tx.from, _tx.to, _tx.nonce, success);
    }

    function batchExecuteMetaTransactions(
        MetaTransaction[] calldata _transactions
    ) external onlyRole(RELAYER_ROLE) whenNotPaused {
        for (uint256 i = 0; i < _transactions.length; i++) {
            executeMetaTransaction(_transactions[i]);
        }
    }

    // State channel functions
    function openStateChannel(
        bytes32 _reskflowId,
        address _participant1,
        address _participant2
    ) external onlyRole(ADMIN_ROLE) {
        // Implementation for state channel opening
        // This is a simplified version - full implementation would include:
        // - Channel state management
        // - Dispute resolution
        // - Timeout mechanisms
    }

    function closeStateChannel(
        bytes32 _reskflowId,
        bytes calldata _finalState,
        bytes calldata _signatures
    ) external {
        // Implementation for state channel closing
        // Verify signatures and update final state
    }

    // Helper functions
    function _domainSeparatorV4() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("GasOptimizer")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function _recover(bytes32 _digest, bytes memory _signature) internal pure returns (address) {
        require(_signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(_signature, 0x20))
            s := mload(add(_signature, 0x40))
            v := byte(0, mload(add(_signature, 0x60)))
        }

        return ecrecover(_digest, v, r, s);
    }

    // View functions
    function getBatch(bytes32 _batchId) external view returns (BatchData memory) {
        return batches[_batchId];
    }

    function isLeafProcessed(bytes32 _batchId, uint256 _leafIndex) external view returns (bool) {
        return processedLeaves[_batchId][_leafIndex];
    }

    function getNonce(address _user) external view returns (uint256) {
        return nonces[_user];
    }

    // Admin functions
    function setDeliveryRegistry(address _registry) external onlyRole(ADMIN_ROLE) {
        require(_registry != address(0), "Invalid address");
        reskflowRegistry = IDeliveryRegistry(_registry);
    }

    function setBatchInterval(uint256 _interval) external onlyRole(ADMIN_ROLE) {
        require(_interval > 0, "Invalid interval");
        // Note: BATCH_INTERVAL is constant in this implementation
        // In production, you might want to make it configurable
    }

    function addRelayer(address _relayer) external onlyRole(ADMIN_ROLE) {
        grantRole(RELAYER_ROLE, _relayer);
    }

    function removeRelayer(address _relayer) external onlyRole(ADMIN_ROLE) {
        revokeRole(RELAYER_ROLE, _relayer);
    }

    function addAggregator(address _aggregator) external onlyRole(ADMIN_ROLE) {
        grantRole(AGGREGATOR_ROLE, _aggregator);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}

    // Override for ERC2771Context
    function _msgSender() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (address sender) {
        return ERC2771ContextUpgradeable._msgSender();
    }

    function _msgData() internal view virtual override(ContextUpgradeable, ERC2771ContextUpgradeable) returns (bytes calldata) {
        return ERC2771ContextUpgradeable._msgData();
    }
}