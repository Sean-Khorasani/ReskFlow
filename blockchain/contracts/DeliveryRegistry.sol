// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract DeliveryRegistry is 
    Initializable, 
    UUPSUpgradeable, 
    AccessControlUpgradeable, 
    PausableUpgradeable,
    ReentrancyGuardUpgradeable 
{
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant DRIVER_ROLE = keccak256("DRIVER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    enum DeliveryStatus {
        Created,
        Assigned,
        PickedUp,
        InTransit,
        Delivered,
        Cancelled,
        Failed
    }

    struct Delivery {
        bytes32 id;
        address sender;
        address recipient;
        address driver;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 value;
        DeliveryStatus status;
        string ipfsHash; // Points to detailed data on IPFS
        bytes32 trackingHash;
    }

    struct DeliveryUpdate {
        uint256 timestamp;
        DeliveryStatus status;
        string location;
        string proof; // IPFS hash for photo/signature
    }

    // State variables
    mapping(bytes32 => Delivery) public deliveries;
    mapping(bytes32 => DeliveryUpdate[]) public deliveryUpdates;
    mapping(address => bytes32[]) public driverDeliveries;
    mapping(address => bytes32[]) public senderDeliveries;
    mapping(address => uint256) public driverRatings;
    mapping(address => uint256) public driverCompletedDeliveries;

    uint256 public totalDeliveries;
    uint256 public constant MAX_BATCH_SIZE = 100;

    // Events
    event DeliveryCreated(
        bytes32 indexed deliveryId,
        address indexed sender,
        address indexed recipient,
        uint256 value
    );
    
    event DeliveryAssigned(
        bytes32 indexed deliveryId,
        address indexed driver
    );
    
    event StatusUpdated(
        bytes32 indexed deliveryId,
        DeliveryStatus indexed status,
        string location
    );
    
    event DeliveryCompleted(
        bytes32 indexed deliveryId,
        address indexed driver,
        uint256 completionTime
    );
    
    event BatchUpdate(
        bytes32[] deliveryIds,
        DeliveryStatus[] statuses,
        uint256 timestamp
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _admin) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
    }

    function createDelivery(
        bytes32 _deliveryId,
        address _recipient,
        string calldata _ipfsHash,
        uint256 _value
    ) external whenNotPaused {
        require(deliveries[_deliveryId].id == 0, "Delivery already exists");
        require(_recipient != address(0), "Invalid recipient");
        require(bytes(_ipfsHash).length > 0, "Invalid IPFS hash");

        deliveries[_deliveryId] = Delivery({
            id: _deliveryId,
            sender: msg.sender,
            recipient: _recipient,
            driver: address(0),
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            value: _value,
            status: DeliveryStatus.Created,
            ipfsHash: _ipfsHash,
            trackingHash: keccak256(abi.encodePacked(_deliveryId, msg.sender, _recipient))
        });

        senderDeliveries[msg.sender].push(_deliveryId);
        totalDeliveries++;

        emit DeliveryCreated(_deliveryId, msg.sender, _recipient, _value);
    }

    function assignDriver(
        bytes32 _deliveryId,
        address _driver
    ) external onlyRole(ADMIN_ROLE) whenNotPaused {
        Delivery storage delivery = deliveries[_deliveryId];
        require(delivery.id != 0, "Delivery not found");
        require(delivery.status == DeliveryStatus.Created, "Invalid status");
        require(hasRole(DRIVER_ROLE, _driver), "Not a registered driver");

        delivery.driver = _driver;
        delivery.status = DeliveryStatus.Assigned;
        delivery.updatedAt = block.timestamp;

        driverDeliveries[_driver].push(_deliveryId);

        emit DeliveryAssigned(_deliveryId, _driver);
    }

    function updateDeliveryStatus(
        bytes32 _deliveryId,
        DeliveryStatus _status,
        string calldata _location,
        string calldata _proof
    ) external whenNotPaused {
        Delivery storage delivery = deliveries[_deliveryId];
        require(delivery.id != 0, "Delivery not found");
        require(
            msg.sender == delivery.driver || hasRole(ADMIN_ROLE, msg.sender),
            "Unauthorized"
        );
        require(_status > delivery.status, "Invalid status transition");

        delivery.status = _status;
        delivery.updatedAt = block.timestamp;

        deliveryUpdates[_deliveryId].push(DeliveryUpdate({
            timestamp: block.timestamp,
            status: _status,
            location: _location,
            proof: _proof
        }));

        emit StatusUpdated(_deliveryId, _status, _location);

        if (_status == DeliveryStatus.Delivered) {
            driverCompletedDeliveries[delivery.driver]++;
            emit DeliveryCompleted(_deliveryId, delivery.driver, block.timestamp);
        }
    }

    function batchUpdateStatus(
        bytes32[] calldata _deliveryIds,
        DeliveryStatus[] calldata _statuses,
        string[] calldata _locations
    ) external onlyRole(ORACLE_ROLE) whenNotPaused {
        require(_deliveryIds.length == _statuses.length, "Array length mismatch");
        require(_deliveryIds.length == _locations.length, "Array length mismatch");
        require(_deliveryIds.length <= MAX_BATCH_SIZE, "Batch too large");

        for (uint256 i = 0; i < _deliveryIds.length; i++) {
            Delivery storage delivery = deliveries[_deliveryIds[i]];
            if (delivery.id != 0 && _statuses[i] > delivery.status) {
                delivery.status = _statuses[i];
                delivery.updatedAt = block.timestamp;

                deliveryUpdates[_deliveryIds[i]].push(DeliveryUpdate({
                    timestamp: block.timestamp,
                    status: _statuses[i],
                    location: _locations[i],
                    proof: ""
                }));

                if (_statuses[i] == DeliveryStatus.Delivered) {
                    driverCompletedDeliveries[delivery.driver]++;
                }
            }
        }

        emit BatchUpdate(_deliveryIds, _statuses, block.timestamp);
    }

    function rateDriver(address _driver, uint256 _rating) external {
        require(_rating >= 1 && _rating <= 5, "Invalid rating");
        require(hasRole(DRIVER_ROLE, _driver), "Not a registered driver");
        
        // Simple average calculation (can be improved with weighted average)
        uint256 completedDeliveries = driverCompletedDeliveries[_driver];
        require(completedDeliveries > 0, "No completed deliveries");
        
        uint256 currentRating = driverRatings[_driver];
        driverRatings[_driver] = (currentRating * (completedDeliveries - 1) + _rating) / completedDeliveries;
    }

    // View functions
    function getDelivery(bytes32 _deliveryId) external view returns (Delivery memory) {
        return deliveries[_deliveryId];
    }

    function getDeliveryUpdates(bytes32 _deliveryId) external view returns (DeliveryUpdate[] memory) {
        return deliveryUpdates[_deliveryId];
    }

    function getDriverDeliveries(address _driver) external view returns (bytes32[] memory) {
        return driverDeliveries[_driver];
    }

    function getSenderDeliveries(address _sender) external view returns (bytes32[] memory) {
        return senderDeliveries[_sender];
    }

    function getDriverStats(address _driver) external view returns (
        uint256 completed,
        uint256 rating,
        uint256 activeDeliveries
    ) {
        completed = driverCompletedDeliveries[_driver];
        rating = driverRatings[_driver];
        
        bytes32[] memory deliveries = driverDeliveries[_driver];
        uint256 active = 0;
        for (uint256 i = 0; i < deliveries.length; i++) {
            if (deliveries[i] != 0) {
                DeliveryStatus status = deliveries[deliveries[i]].status;
                if (status != DeliveryStatus.Delivered && 
                    status != DeliveryStatus.Cancelled && 
                    status != DeliveryStatus.Failed) {
                    active++;
                }
            }
        }
        activeDeliveries = active;
    }

    // Admin functions
    function registerDriver(address _driver) external onlyRole(ADMIN_ROLE) {
        grantRole(DRIVER_ROLE, _driver);
    }

    function removeDriver(address _driver) external onlyRole(ADMIN_ROLE) {
        revokeRole(DRIVER_ROLE, _driver);
    }

    function registerOracle(address _oracle) external onlyRole(ADMIN_ROLE) {
        grantRole(ORACLE_ROLE, _oracle);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}
}