/*
    Copyright 2020 Set Labs Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache License, Version 2.0
*/
pragma solidity ^0.6.10;

import { ISetToken } from "../interfaces/ISetToken.sol";
import { IGeneralIndexModule } from "../interfaces/IGeneralIndexModule.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract IssuanceHook {
    ISetToken public retrievedSetToken;
    address public retrievedReserveAsset;
    uint256 public retrievedReserveAssetQuantity;
    address public retrievedSender;
    uint256 public retrievedRedeemQuantity;
    address public retrievedTo;
    IGeneralIndexModule public indexModule;

    constructor(IGeneralIndexModule _indexModule) public {
        indexModule = _indexModule;
    }

    function invokePreIssueHook(
        ISetToken _setToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity,
        address _sender,
        address _to
    )
        external
    {
        retrievedSetToken = _setToken;
        retrievedReserveAsset = _reserveAsset;
        retrievedReserveAssetQuantity = _reserveAssetQuantity;
        retrievedSender = _sender;
        retrievedTo = _to;
    }

    function invokePreRedeemHook(
        ISetToken _setToken,
        uint256 _redeemQuantity,
        address _sender,
        address _to
    )
        external
    {
        retrievedSetToken = _setToken;
        retrievedRedeemQuantity = _redeemQuantity;
        retrievedSender = _sender;
        retrievedTo = _to;
       
    } 
}