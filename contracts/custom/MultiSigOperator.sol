// SPDX-License-Identifier: MIT
pragma solidity ^0.6.10;

import { IICManager } from "./IICManager.sol";

contract MultiSigOperator {

    event SubmitRebalance(
        uint256 indexed rebalanceNum,
        address[] newComponents,
        uint256[] newComponentsTargetUnits,
        uint256[] oldComponentsTargetUnits, 
        uint256 positionMultiplier
    );

    event ConfirmRebalance(address indexed owner, uint256 indexed rebalanceNum);
    event RevokeConfirmation(address indexed owner, uint256 indexed rebalanceNum);
    event ExecuteRebalance(address indexed owner, uint256 indexed rebalanceNum);
    event SubmitOperation(uint256 indexed operationNum, bytes data);
    event ConfirmOperation(address indexed owner, uint256 indexed operationNum);
    event RevokeOperationConfirmation(address indexed owner, uint256 indexed operationNum);
    event ExecuteOperation(address indexed owner, uint256 indexed operationNum, bytes data);

    address[] public owners;
    address public operator;
    address public priorityOwner;
    mapping(address => bool) public isOwner;
    uint256 public numConfirmationsRequired;
    uint256 public numOperationConfirmationsRequired;
    uint256 public rebalanceNum;
    uint256 public operationNum;
    IICManager public manager;

    struct Rebalance {
        address[] newComponents;
        uint256[] newComponentsTargetUnits;
        uint256[] oldComponentsTargetUnits;
        uint256 positionMultiplier;
        bool executed;
        uint256 numConfirmations;
        uint256 rebalanceNum;
    }

    struct Operation {
        bytes data;
        bool executed;
        uint256 numConfirmations;
        uint256 operationNum;
    }

    // mapping from tx owner => bool
    mapping(address => bool) public rebalanceConfirmed;
    mapping(address => bool) public operationConfirmed;

    Rebalance public currentRebalance;
    Operation public currentOperation;

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    modifier notExecutedRebalance() {
        require(!currentRebalance.executed, "rebalance already executed");
        _;
    }

    modifier notExecutedOperation() {
        require(!currentOperation.executed, "operation already executed");
        _;
    }

    modifier notConfirmedRebalance() {
        require(!rebalanceConfirmed[msg.sender], "rebalance already confirmed");
        _;
    }

    modifier notConfirmedOperation() {
        require(!operationConfirmed[msg.sender], "operation already confirmed");
        _;
    }

    constructor(address[] memory _owners, uint256 _numConfirmationsRequired, uint256 _numOperationConfirmationsRequired, address _operator, IICManager _manager, address _priorityOwner) public {
        require(_owners.length > 0, "owners required");
        require(
            _numConfirmationsRequired > 0 &&
                _numConfirmationsRequired <= _owners.length,
            "invalid number of required confirmations"
        );

        require(
            _numOperationConfirmationsRequired > 0 &&
                _numOperationConfirmationsRequired <= _owners.length,
            "invalid number of required confirmations"
        );

        operator = _operator;
        manager = _manager;
        priorityOwner = _priorityOwner;

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];

            require(owner != address(0), "invalid owner");
            require(!isOwner[owner], "owner not unique");

            isOwner[owner] = true;
            owners.push(owner);
        }

        numConfirmationsRequired = _numConfirmationsRequired;
        numOperationConfirmationsRequired = _numOperationConfirmationsRequired;
        rebalanceNum = 0;
        operationNum = 0;
    }

    function priorityRebalance(
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    ) public {
        require(msg.sender == priorityOwner, "not priority owner");

        manager.startRebalance(_newComponents, _newComponentsTargetUnits, _oldComponentsTargetUnits, _positionMultiplier);

        emit ExecuteRebalance(msg.sender, rebalanceNum);
    }

    function submitRebalance(
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    ) public onlyOperator {
        for (uint256 i = 0; i < owners.length; i++) {
            rebalanceConfirmed[owners[i]] = false;
        }
        currentRebalance = Rebalance(_newComponents, _newComponentsTargetUnits, _oldComponentsTargetUnits, _positionMultiplier, false, 0, rebalanceNum);

        rebalanceNum += 1;

        emit SubmitRebalance(rebalanceNum, _newComponents, _newComponentsTargetUnits, _oldComponentsTargetUnits, _positionMultiplier);
    }

    function confirmRebalance() public onlyOwner notExecutedRebalance notConfirmedRebalance {
        currentRebalance.numConfirmations += 1;
        rebalanceConfirmed[msg.sender] = true;
        emit ConfirmRebalance(msg.sender, rebalanceNum);
    }

    function executeRebalance() public onlyOwner notExecutedRebalance {

        require(
            currentRebalance.numConfirmations >= numConfirmationsRequired,
            "cannot execute rebalance"
        );

        currentRebalance.executed = true;

        manager.startRebalance(currentRebalance.newComponents, currentRebalance.newComponentsTargetUnits, currentRebalance.oldComponentsTargetUnits, currentRebalance.positionMultiplier);

        emit ExecuteRebalance(msg.sender, rebalanceNum);
    }

    function revokeConfirmationRebalance() public onlyOwner notExecutedRebalance {

        require(rebalanceConfirmed[msg.sender], "rebalance not confirmed");

        currentRebalance.numConfirmations -= 1;
        rebalanceConfirmed[msg.sender] = false;

        emit RevokeConfirmation(msg.sender, rebalanceNum);
    }

    function submitOperation(bytes calldata data) public onlyOperator {
        for (uint256 i = 0; i < owners.length; i++) {
            operationConfirmed[owners[i]] = false;
        }
        currentOperation = Operation(data, false, 0, operationNum);

        operationNum += 1;

        emit SubmitOperation(operationNum, data);
    }

    function confirmOperation() public onlyOwner notExecutedOperation notConfirmedOperation {
        currentOperation.numConfirmations += 1;
        operationConfirmed[msg.sender] = true;
        emit ConfirmOperation(msg.sender, operationNum);
    }

    function executeOperation() public onlyOwner notExecutedOperation {

        require(
            currentOperation.numConfirmations >= numOperationConfirmationsRequired,
            "cannot execute operation"
        );

        currentOperation.executed = true;

        (bool success, ) = address(manager).call(currentOperation.data);
        require(success, "call to manager failed");

        emit ExecuteOperation(msg.sender, operationNum, currentOperation.data);
    }

    function revokeConfirmationOperation() public onlyOwner notExecutedOperation {

        require(operationConfirmed[msg.sender], "operation not confirmed");

        currentOperation.numConfirmations -= 1;
        operationConfirmed[msg.sender] = false;

        emit RevokeOperationConfirmation(msg.sender, operationNum);
    }

    function getOwners() public view returns (address[] memory) {
        return owners;
    }

    function getRebalance() public view returns (address[] memory, uint256[] memory, uint256[] memory, uint256, bool, uint256, uint256) {
        return (currentRebalance.newComponents, currentRebalance.newComponentsTargetUnits, currentRebalance.oldComponentsTargetUnits, currentRebalance.positionMultiplier, currentRebalance.executed, currentRebalance.numConfirmations, currentRebalance.rebalanceNum);
    }

    function getOperation() public view returns (bytes memory, bool, uint256, uint256) {
        return (currentOperation.data, currentOperation.executed, currentOperation.numConfirmations, currentOperation.operationNum);
    }
}
