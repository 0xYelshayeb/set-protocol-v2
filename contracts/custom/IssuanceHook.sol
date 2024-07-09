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
import { IMultiSigOperator } from "./IMultiSigOperator.sol";
import { INAVIssuanceModule } from "../interfaces/INAVIssuanceModule.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { ISetValuer } from "../interfaces/ISetValuer.sol";
import { IOracleAdapter } from "../interfaces/IOracleAdapter.sol";
import { PreciseUnitMath } from "../lib/PreciseUnitMath.sol";
import "hardhat/console.sol";

contract IssuanceHook {

    using SafeCast for int256;
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    ISetToken public setToken;
    IGeneralIndexModule public indexModule;
    IMultiSigOperator public multiSigOperator;
    IERC20 public weth;
    INAVIssuanceModule public navIssuanceModule;
    ISetValuer public setValuer;
    IOracleAdapter public oracleAdapter;
    uint256 public constant BUFFER_MULTIPLIER = 0.97e18;

    constructor(
        IGeneralIndexModule _indexModule,
        IERC20 _weth,
        ISetToken _setToken,
        ISetValuer _setValuer,
        IOracleAdapter _oracleAdapter
    ) public {
        indexModule = _indexModule;
        weth = _weth;
        setToken = _setToken;
        setValuer = _setValuer;
        oracleAdapter = _oracleAdapter;
    }

    /**
     * @dev Set the address of the NavIssuanceModule contract
     * @param _navIssuanceModule The address of the deployed NavIssuanceModule contract
     */
    function setNavIssuanceModule(INAVIssuanceModule _navIssuanceModule) external {
        require(address(navIssuanceModule) == address(0), "NavIssuanceModule already set");
        navIssuanceModule = _navIssuanceModule;
    }

    function setMultiSigOperator(IMultiSigOperator _multiSigOperator) external {
        require(address(multiSigOperator) == address(0), "MultisigOperator already set");
        multiSigOperator = _multiSigOperator;
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
        _reserveAsset; _reserveAssetQuantity; _sender; _to; _setToken;
    }

    function invokePreRedeemHook(
        ISetToken _setToken,
        uint256 _redeemQuantity,
        address _sender,
        address _to
    )
        external
    {
        console.log("invokePreRedeemHook");
        uint256 wethBalance = weth.balanceOf(address(setToken));
        uint256 requiredWeth = calculateRequiredWeth(_redeemQuantity);

        if (wethBalance < requiredWeth) {
            console.log("wethBalance %s", wethBalance);
            uint256 wethShortage = requiredWeth.sub(wethBalance);
            console.log("wethShortage %s", wethShortage);
            _calculateAndInitiateRebalance(wethShortage);
            _tradeComponentsForWeth();
        }

        wethBalance = weth.balanceOf(address(setToken));
        console.log("wethBalance after rebalance %s", wethBalance);
    } 

    /**
     * Implement the logic to calculate the required WETH for the given redeem quantity
     **/
    function calculateRequiredWeth(uint256 _redeemQuantity) internal view returns (uint256) {
        uint256 setTokenValuation = setValuer.calculateSetTokenValuation(setToken, address(weth));
        uint256 requiredQuantity = _redeemQuantity.preciseMul(setTokenValuation);
        return requiredQuantity;
    }

    function _calculateAndInitiateRebalance(uint256 _wethShortage) internal {
        address[] memory newComponents = new address[](0); // No new components in priority rebalance
        uint256[] memory newComponentsTargetUnits = new uint256[](0); // No target units for new components
        address[] memory components = setToken.getComponents();
        uint256[] memory oldComponentsTargetUnits = new uint256[](components.length);

            // Get total supply of the SetToken
        uint256 totalSupply = setToken.totalSupply();

        // Calculate total value of SetToken in WETH
        uint256 totalValueInWETH = 0;
        for (uint256 i = 0; i < components.length; i++) {
            if (components[i] == address(weth)) {
                continue;
            }
            uint256 componentUnit = setToken.getDefaultPositionRealUnit(components[i]).toUint256();
            uint256 componentBalance = componentUnit.preciseMul(totalSupply);
            (bool success, uint256 componentPriceInWETH) = oracleAdapter.getPrice(components[i], address(weth));
            require(success, "Price retrieval failed");
            uint256 componentValueInWETH = componentPriceInWETH.preciseMul(componentBalance);
            totalValueInWETH = totalValueInWETH.add(componentValueInWETH);
        }

        // Calculate the adjusted total value in WETH
        uint256 adjustedTotalValueInWETH = totalValueInWETH.sub(_wethShortage);

        // Calculate the final reduction factor
        uint256 reductionFactor = adjustedTotalValueInWETH.preciseDiv(totalValueInWETH).preciseMul(BUFFER_MULTIPLIER);

        // Adjust each component's target units based on the final reduction factor
        for (uint256 i = 0; i < components.length; i++) {
            if (components[i] == address(weth)) {
                continue;
            }
            uint256 componentUnit = setToken.getDefaultPositionRealUnit(components[i]).toUint256();
            uint256 adjustedComponentUnit = componentUnit.preciseMul(reductionFactor);
            oldComponentsTargetUnits[i] = adjustedComponentUnit;
        }

        uint256 positionMultiplier = setToken.positionMultiplier().toUint256();

        multiSigOperator.priorityRebalance(
            newComponents,
            newComponentsTargetUnits,
            oldComponentsTargetUnits,
            positionMultiplier
        );
    }

    function _tradeComponentsForWeth() internal {
        address[] memory components = setToken.getComponents();

        for (uint256 i = 0; i < components.length; i++) {
            if (components[i] == address(weth)) {
                continue;
            }
            indexModule.trade(setToken, components[i], 0);
        }
    }
}