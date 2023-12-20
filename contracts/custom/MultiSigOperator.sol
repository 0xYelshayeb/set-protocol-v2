// SPDX-License-Identifier: MIT
pragma solidity ^0.6.10;

import {IICManager} from "./IICManager.sol";

contract MultiSigOperator {

    event SubmitRebalance(
        uint indexed rebalanceNum,
        address[] newComponents,
        uint256[] newComponentsTargetUnits,
        uint256[] oldComponentsTargetUnits, 
        uint256 positionMultiplier
    );

    event SubmitNewOperator(
        address indexed newOperator
    );

    event NewOperator(address indexed newOperator);
    event ConfirmRebalance(address indexed owner, uint indexed rebalanceNum);
    event ConfirmNewOperator(address indexed owner, address indexed newOperator);
    event RevokeConfirmation(address indexed owner, uint indexed rebalanceNum);
    event ExecuteRebalance(address indexed owner, uint indexed rebalanceNum);

    address[] public owners;
    address public operator;
    mapping(address => bool) public isOwner;
    uint public numConfirmationsRequired;
    uint public numConfirmationsRequiredOperator;
    uint public rebalanceNum;
    IICManager public manager;

   struct Rebalance {
        address[] newComponents;
        uint256[] newComponentsTargetUnits;
        uint256[] oldComponentsTargetUnits;
        uint256 positionMultiplier;
        bool executed;
        uint numConfirmations;
        uint rebalanceNum;
    }

    struct OperatorProposal{
        address newOperator;
        uint numConfirmations;
    }

    // mapping from tx owner => bool
    mapping(address => bool) public rebalanceConfirmed;
    mapping(address => bool) public operatorConfirmed;

    Rebalance public currentRebalance;
    OperatorProposal public operatorProposal;

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "not operator");
        _;
    }

    modifier notExecuted() {
        require(!currentRebalance.executed, "rebalance already executed");
        _;
    }

    modifier notConfirmed() {
        require(!rebalanceConfirmed[msg.sender], "rebalance already confirmed");
        _;
    }

    modifier notConfirmedOperator() {
        require(!operatorConfirmed[msg.sender], "operator already confirmed");
        _;
    }

    constructor(address[] memory _owners, uint _numConfirmationsRequired, uint _numConfirmationsRequiredOperator, address _operator, IICManager _manager) public {
        require(_owners.length > 0, "owners required");
        require(
            _numConfirmationsRequired > 0 &&
                _numConfirmationsRequired <= _owners.length,
            "invalid number of required confirmations"
        );

        require(
            _numConfirmationsRequiredOperator > 0 &&
                _numConfirmationsRequiredOperator <= _owners.length,
            "invalid number of required confirmations"
        );

        operator = _operator;
        manager = _manager;

        for (uint i = 0; i < _owners.length; i++) {
            address owner = _owners[i];

            require(owner != address(0), "invalid owner");
            require(!isOwner[owner], "owner not unique");

            isOwner[owner] = true;
            owners.push(owner);
        }

        numConfirmationsRequired = _numConfirmationsRequired;
        numConfirmationsRequiredOperator = _numConfirmationsRequiredOperator;
        rebalanceNum = 0;
    }

    function submitNewOperator(address _newOperator) public onlyOwner {
        operatorProposal = OperatorProposal(_newOperator, 0);
        operatorConfirmed[msg.sender] = true;
        operatorProposal.numConfirmations += 1;
        emit SubmitNewOperator(_newOperator);
    }

    function confirmNewOperator() public onlyOwner notConfirmedOperator {
        operatorProposal.numConfirmations += 1;
        operatorConfirmed[msg.sender] = true;
        emit ConfirmNewOperator(msg.sender, operatorProposal.newOperator);
    }

    function executeNewOperator() public onlyOwner {
        require(
            operatorProposal.numConfirmations >= numConfirmationsRequiredOperator,
            "cannot execute new operator"
        );

        operator = operatorProposal.newOperator;
        emit NewOperator(operator);
        manager.updateOperator(operator);

    }

    function submitRebalance(
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    ) public onlyOperator {
        currentRebalance = Rebalance(_newComponents, _newComponentsTargetUnits, _oldComponentsTargetUnits, _positionMultiplier, false, 0, rebalanceNum);

        rebalanceNum += 1;

        emit SubmitRebalance(rebalanceNum, _newComponents, _newComponentsTargetUnits, _oldComponentsTargetUnits, _positionMultiplier);
    }

    function confirmRebalance() public onlyOwner notExecuted() notConfirmed() {
        currentRebalance.numConfirmations += 1;
        rebalanceConfirmed[msg.sender] = true;
        emit ConfirmRebalance(msg.sender, rebalanceNum);
    }

    function executeRebalance() public onlyOwner notExecuted() {

        require(
            currentRebalance.numConfirmations >= numConfirmationsRequired,
            "cannot execute rebalance"
        );

        currentRebalance.executed = true;

        manager.startRebalance(currentRebalance.newComponents, currentRebalance.newComponentsTargetUnits, currentRebalance.oldComponentsTargetUnits, currentRebalance.positionMultiplier);

        emit ExecuteRebalance(msg.sender, rebalanceNum);
    }

    function revokeConfirmation() public onlyOwner notExecuted() {

        require(rebalanceConfirmed[msg.sender], "rebalance not confirmed");

        currentRebalance.numConfirmations -= 1;
        rebalanceConfirmed[msg.sender] = false;

        emit RevokeConfirmation(msg.sender, rebalanceNum);
    }

    function getOwners() public view returns (address[] memory) {
        return owners;
    }

    function getRebalance() public view returns (address[] memory, uint256[] memory, uint256[] memory, uint256, bool, uint, uint) {
        return (currentRebalance.newComponents, currentRebalance.newComponentsTargetUnits, currentRebalance.oldComponentsTargetUnits, currentRebalance.positionMultiplier, currentRebalance.executed, currentRebalance.numConfirmations, currentRebalance.rebalanceNum);
    }
}
