// SPDX-License-Identifier: Apache License, Version 2.0
pragma solidity ^0.6.10;
pragma experimental ABIEncoderV2;

interface IICManager {
    /**
     * @notice Start rebalance in IndexModule. Set new target units, zeroing out any units for components being removed from index.
     * Log position multiplier to adjust target units in case fees are accrued.
     *
     * @param _newComponents                    Array of new components to add to allocation
     * @param _newComponentsTargetUnits         Array of target units at end of rebalance for new components, maps to same index of component
     * @param _oldComponentsTargetUnits         Array of target units at end of rebalance for old component, maps to same index of component,
     *                                          if component being removed set to 0.
     * @param _positionMultiplier               Position multiplier when target units were calculated, needed in order to adjust target units
     *                                          if fees accrued
     */
    function startRebalance(
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    ) external;

    /**
     * @notice Update the operator address.
     *
     * @param _newOperator           New operator address
     */
    function updateOperator(address _newOperator) external;

    /**
     * METHODOLOGIST ONLY: Update the methodologist address
     *
     * @param _newMethodologist           New methodologist address
     */
    function updateMethodologist(address _newMethodologist) external;

    function updateExchangeData(address[] memory _components, bytes[] memory _exchangeData) external;
}
