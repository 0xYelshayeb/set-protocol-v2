// SPDX-License-Identifier: MIT
pragma solidity ^0.6.10;

interface IMultiSigOperator {
    function priorityRebalance(
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    ) external;
}