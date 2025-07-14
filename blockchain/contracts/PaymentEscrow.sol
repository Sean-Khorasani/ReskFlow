// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDeliveryRegistry {
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
        string ipfsHash;
        bytes32 trackingHash;
    }
    
    function getDelivery(bytes32 _reskflowId) external view returns (Delivery memory);
}

contract PaymentEscrow is 
    Initializable,
    UUPSUpgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    struct Escrow {
        uint256 amount;
        address token; // address(0) for native token
        address payer;
        uint256 createdAt;
        uint256 driverShare; // in basis points (e.g., 8000 = 80%)
        uint256 platformFee; // in basis points (e.g., 500 = 5%)
        bool released;
        bool refunded;
    }

    // State variables
    IDeliveryRegistry public reskflowRegistry;
    mapping(bytes32 => Escrow) public escrows;
    mapping(address => uint256) public driverBalances;
    mapping(address => mapping(address => uint256)) public driverTokenBalances;
    mapping(address => bool) public supportedTokens;
    
    address public treasuryAddress;
    uint256 public defaultDriverShare; // in basis points
    uint256 public defaultPlatformFee; // in basis points
    uint256 public totalEscrowedNative;
    mapping(address => uint256) public totalEscrowedTokens;

    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant MIN_ESCROW_AMOUNT = 0.001 ether;

    // Events
    event EscrowCreated(
        bytes32 indexed reskflowId,
        address indexed payer,
        uint256 amount,
        address token
    );
    
    event PaymentReleased(
        bytes32 indexed reskflowId,
        address indexed driver,
        uint256 driverAmount,
        uint256 platformAmount
    );
    
    event PaymentRefunded(
        bytes32 indexed reskflowId,
        address indexed payer,
        uint256 amount
    );
    
    event DriverWithdrawal(
        address indexed driver,
        address indexed token,
        uint256 amount
    );
    
    event TokenSupported(address indexed token, bool supported);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _admin,
        address _reskflowRegistry,
        address _treasury,
        uint256 _defaultDriverShare,
        uint256 _defaultPlatformFee
    ) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        require(_reskflowRegistry != address(0), "Invalid registry");
        require(_treasury != address(0), "Invalid treasury");
        require(_defaultDriverShare + _defaultPlatformFee <= BASIS_POINTS, "Invalid fees");

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(TREASURY_ROLE, _treasury);

        reskflowRegistry = IDeliveryRegistry(_reskflowRegistry);
        treasuryAddress = _treasury;
        defaultDriverShare = _defaultDriverShare;
        defaultPlatformFee = _defaultPlatformFee;
    }

    function createEscrow(
        bytes32 _reskflowId,
        uint256 _driverShare,
        uint256 _platformFee
    ) external payable whenNotPaused nonReentrant {
        require(msg.value >= MIN_ESCROW_AMOUNT, "Amount too small");
        require(_driverShare + _platformFee <= BASIS_POINTS, "Invalid fees");
        
        IDeliveryRegistry.Delivery memory reskflow = reskflowRegistry.getDelivery(_reskflowId);
        require(reskflow.id != 0, "Delivery not found");
        require(reskflow.sender == msg.sender, "Not the sender");
        require(escrows[_reskflowId].amount == 0, "Escrow already exists");

        escrows[_reskflowId] = Escrow({
            amount: msg.value,
            token: address(0),
            payer: msg.sender,
            createdAt: block.timestamp,
            driverShare: _driverShare > 0 ? _driverShare : defaultDriverShare,
            platformFee: _platformFee > 0 ? _platformFee : defaultPlatformFee,
            released: false,
            refunded: false
        });

        totalEscrowedNative += msg.value;

        emit EscrowCreated(_reskflowId, msg.sender, msg.value, address(0));
    }

    function createTokenEscrow(
        bytes32 _reskflowId,
        address _token,
        uint256 _amount,
        uint256 _driverShare,
        uint256 _platformFee
    ) external whenNotPaused nonReentrant {
        require(supportedTokens[_token], "Token not supported");
        require(_amount > 0, "Invalid amount");
        require(_driverShare + _platformFee <= BASIS_POINTS, "Invalid fees");
        
        IDeliveryRegistry.Delivery memory reskflow = reskflowRegistry.getDelivery(_reskflowId);
        require(reskflow.id != 0, "Delivery not found");
        require(reskflow.sender == msg.sender, "Not the sender");
        require(escrows[_reskflowId].amount == 0, "Escrow already exists");

        IERC20(_token).safeTransferFrom(msg.sender, address(this), _amount);

        escrows[_reskflowId] = Escrow({
            amount: _amount,
            token: _token,
            payer: msg.sender,
            createdAt: block.timestamp,
            driverShare: _driverShare > 0 ? _driverShare : defaultDriverShare,
            platformFee: _platformFee > 0 ? _platformFee : defaultPlatformFee,
            released: false,
            refunded: false
        });

        totalEscrowedTokens[_token] += _amount;

        emit EscrowCreated(_reskflowId, msg.sender, _amount, _token);
    }

    function releasePayment(bytes32 _reskflowId) external whenNotPaused nonReentrant {
        Escrow storage escrow = escrows[_reskflowId];
        require(escrow.amount > 0, "No escrow found");
        require(!escrow.released && !escrow.refunded, "Already processed");

        IDeliveryRegistry.Delivery memory reskflow = reskflowRegistry.getDelivery(_reskflowId);
        require(
            reskflow.status == IDeliveryRegistry.DeliveryStatus.Delivered,
            "Not delivered"
        );
        require(
            msg.sender == reskflow.driver || 
            msg.sender == reskflow.sender || 
            hasRole(ADMIN_ROLE, msg.sender),
            "Unauthorized"
        );

        escrow.released = true;

        uint256 platformAmount = (escrow.amount * escrow.platformFee) / BASIS_POINTS;
        uint256 driverAmount = (escrow.amount * escrow.driverShare) / BASIS_POINTS;
        uint256 remainingAmount = escrow.amount - platformAmount - driverAmount;

        if (remainingAmount > 0) {
            // Any remaining amount goes to the driver
            driverAmount += remainingAmount;
        }

        if (escrow.token == address(0)) {
            // Native token
            driverBalances[reskflow.driver] += driverAmount;
            driverBalances[treasuryAddress] += platformAmount;
            totalEscrowedNative -= escrow.amount;
        } else {
            // ERC20 token
            driverTokenBalances[reskflow.driver][escrow.token] += driverAmount;
            driverTokenBalances[treasuryAddress][escrow.token] += platformAmount;
            totalEscrowedTokens[escrow.token] -= escrow.amount;
        }

        emit PaymentReleased(_reskflowId, reskflow.driver, driverAmount, platformAmount);
    }

    function refundPayment(bytes32 _reskflowId) external whenNotPaused nonReentrant {
        Escrow storage escrow = escrows[_reskflowId];
        require(escrow.amount > 0, "No escrow found");
        require(!escrow.released && !escrow.refunded, "Already processed");

        IDeliveryRegistry.Delivery memory reskflow = reskflowRegistry.getDelivery(_reskflowId);
        require(
            reskflow.status == IDeliveryRegistry.DeliveryStatus.Cancelled ||
            reskflow.status == IDeliveryRegistry.DeliveryStatus.Failed,
            "Invalid status for refund"
        );
        require(
            msg.sender == escrow.payer || hasRole(ADMIN_ROLE, msg.sender),
            "Unauthorized"
        );

        escrow.refunded = true;

        if (escrow.token == address(0)) {
            totalEscrowedNative -= escrow.amount;
            payable(escrow.payer).transfer(escrow.amount);
        } else {
            totalEscrowedTokens[escrow.token] -= escrow.amount;
            IERC20(escrow.token).safeTransfer(escrow.payer, escrow.amount);
        }

        emit PaymentRefunded(_reskflowId, escrow.payer, escrow.amount);
    }

    function withdrawBalance() external whenNotPaused nonReentrant {
        uint256 balance = driverBalances[msg.sender];
        require(balance > 0, "No balance to withdraw");

        driverBalances[msg.sender] = 0;
        payable(msg.sender).transfer(balance);

        emit DriverWithdrawal(msg.sender, address(0), balance);
    }

    function withdrawTokenBalance(address _token) external whenNotPaused nonReentrant {
        uint256 balance = driverTokenBalances[msg.sender][_token];
        require(balance > 0, "No balance to withdraw");

        driverTokenBalances[msg.sender][_token] = 0;
        IERC20(_token).safeTransfer(msg.sender, balance);

        emit DriverWithdrawal(msg.sender, _token, balance);
    }

    function batchWithdraw(address[] calldata _tokens) external whenNotPaused nonReentrant {
        // Withdraw native balance
        uint256 nativeBalance = driverBalances[msg.sender];
        if (nativeBalance > 0) {
            driverBalances[msg.sender] = 0;
            payable(msg.sender).transfer(nativeBalance);
            emit DriverWithdrawal(msg.sender, address(0), nativeBalance);
        }

        // Withdraw token balances
        for (uint256 i = 0; i < _tokens.length; i++) {
            uint256 tokenBalance = driverTokenBalances[msg.sender][_tokens[i]];
            if (tokenBalance > 0) {
                driverTokenBalances[msg.sender][_tokens[i]] = 0;
                IERC20(_tokens[i]).safeTransfer(msg.sender, tokenBalance);
                emit DriverWithdrawal(msg.sender, _tokens[i], tokenBalance);
            }
        }
    }

    // Admin functions
    function setSupportedToken(address _token, bool _supported) external onlyRole(ADMIN_ROLE) {
        supportedTokens[_token] = _supported;
        emit TokenSupported(_token, _supported);
    }

    function setTreasuryAddress(address _treasury) external onlyRole(ADMIN_ROLE) {
        require(_treasury != address(0), "Invalid address");
        treasuryAddress = _treasury;
        _grantRole(TREASURY_ROLE, _treasury);
    }

    function setDefaultFees(
        uint256 _driverShare,
        uint256 _platformFee
    ) external onlyRole(ADMIN_ROLE) {
        require(_driverShare + _platformFee <= BASIS_POINTS, "Invalid fees");
        defaultDriverShare = _driverShare;
        defaultPlatformFee = _platformFee;
    }

    function emergencyWithdraw(
        address _token,
        address _to,
        uint256 _amount
    ) external onlyRole(ADMIN_ROLE) {
        require(_to != address(0), "Invalid address");
        
        if (_token == address(0)) {
            payable(_to).transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(_to, _amount);
        }
    }

    // View functions
    function getEscrowDetails(bytes32 _reskflowId) external view returns (Escrow memory) {
        return escrows[_reskflowId];
    }

    function getDriverBalance(address _driver) external view returns (uint256) {
        return driverBalances[_driver];
    }

    function getDriverTokenBalance(
        address _driver,
        address _token
    ) external view returns (uint256) {
        return driverTokenBalances[_driver][_token];
    }

    function getTotalEscrowedAmount(address _token) external view returns (uint256) {
        if (_token == address(0)) {
            return totalEscrowedNative;
        }
        return totalEscrowedTokens[_token];
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(ADMIN_ROLE) {}

    receive() external payable {
        // Allow contract to receive ETH
    }
}