// SPDX-License-Identifier: Apache License, Version 2.0
pragma solidity ^0.6.10;
pragma experimental "ABIEncoderV2";

import { ISetToken } from "./ISetToken.sol";

interface IGeneralIndexModule {
    function startRebalance(
        ISetToken _setToken,
        address[] calldata _newComponents,
        uint256[] calldata _newComponentsTargetUnits,
        uint256[] calldata _oldComponentsTargetUnits,
        uint256 _positionMultiplier
    ) external;

    function setTradeMaximums(
        ISetToken _setToken,
        address[] calldata _components,
        uint256[] calldata _tradeMaximums
    ) external;

    function setExchanges(
        ISetToken _setToken,
        address[] calldata _components,
        uint256[] calldata _exchanges
    ) external;

    function setExchangeData(
        ISetToken _setToken,
        address[] memory _components,
        bytes[] memory _exchangeData
    ) external;

    function setCoolOffPeriods(
        ISetToken _setToken,
        address[] calldata _components,
        uint256[] calldata _coolOffPeriods
    ) external;

    function setTraderStatus(ISetToken _setToken, address[] calldata _traders, bool[] calldata _statuses) external;

    function setAnyoneTrade(ISetToken _setToken, bool _status) external;

    function trade(
        ISetToken _setToken,
        address _component,
        uint256 _quantity
    ) external;
}