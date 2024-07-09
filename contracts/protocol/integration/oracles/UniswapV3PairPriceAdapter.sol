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

pragma solidity 0.6.10;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { IUniswapV3Pool } from "../../../interfaces/external/IUniswapV3Pool.sol";
import { PreciseUnitMath } from "../../../lib/PreciseUnitMath.sol";
import "hardhat/console.sol";


contract UniswapV3PairPriceAdapter is Ownable {
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;

    /* ============ Structs ============ */
    
    struct PoolSettings {
        address tokenOne;
        address tokenTwo;
        uint256 tokenOneBaseUnit;
        uint256 tokenTwoBaseUnit;
        bool isValid;
    }

    /* ============ State Variables ============ */

    // Uniswap allowed pools to settings mapping
    mapping(address => PoolSettings) public uniswapPoolsToSettings;

    // Uniswap allowed pools
    address[] public allowedUniswapPools;

    /* ============ Constructor ============ */

    /**
     * Set state variables
     *
     * @param _uniswapPools       Array of allowed Uniswap pools
     */
    constructor(
        IUniswapV3Pool[] memory _uniswapPools
    )
        public
    {
        // Add each of initial addresses to state
        for (uint256 i = 0; i < _uniswapPools.length; i++) {
            IUniswapV3Pool uniswapPoolToAdd = _uniswapPools[i];

            // Require pools are unique
            require(
                !uniswapPoolsToSettings[address(uniswapPoolToAdd)].isValid,
                "Uniswap pool address must be unique."
            );

            // Initialize pool settings
            PoolSettings memory poolSettings;
            poolSettings.tokenOne = uniswapPoolToAdd.token0();
            poolSettings.tokenTwo = uniswapPoolToAdd.token1();
            uint256 tokenOneDecimals = ERC20(poolSettings.tokenOne).decimals();
            poolSettings.tokenOneBaseUnit = 10 ** tokenOneDecimals;
            uint256 tokenTwoDecimals = ERC20(poolSettings.tokenTwo).decimals();
            poolSettings.tokenTwoBaseUnit = 10 ** tokenTwoDecimals;
            poolSettings.isValid = true;

            // Add to storage
            allowedUniswapPools.push(address(uniswapPoolToAdd));
            uniswapPoolsToSettings[address(uniswapPoolToAdd)] = poolSettings;
        } 
    }

    /* ============ External Functions ============ */

    /**
     * Calculate price from Uniswap. Note: must be system contract to be able to retrieve price.
     *
     * @param _assetOne         Address of first asset in pair
     * @param _assetTwo         Address of second asset in pair
     */
    function getPrice(address _assetOne, address _assetTwo) external view returns (bool, uint256) {
        if (_assetOne == _assetTwo) {
            return (true, uint256(1e18));
        }
        address poolAddress = _findPool(_assetOne, _assetTwo);
        if (poolAddress == address(0)) {
            return (false, 0);
        }

        uint256 price = _getUniswapPoolPrice(poolAddress, _assetOne, _assetTwo);

        return (true, price);
    }

    function addPool(address _poolAddress) external onlyOwner {
        require (
            !uniswapPoolsToSettings[_poolAddress].isValid,
            "Uniswap pool address already added"
        );
        IUniswapV3Pool poolToken = IUniswapV3Pool(_poolAddress);

        PoolSettings memory poolSettings;
        poolSettings.tokenOne = poolToken.token0();
        poolSettings.tokenTwo = poolToken.token1();
        uint256 tokenOneDecimals = ERC20(poolSettings.tokenOne).decimals();
        poolSettings.tokenOneBaseUnit = 10 ** tokenOneDecimals;
        uint256 tokenTwoDecimals = ERC20(poolSettings.tokenTwo).decimals();
        poolSettings.tokenTwoBaseUnit = 10 ** tokenTwoDecimals;
        poolSettings.isValid = true;

        allowedUniswapPools.push(_poolAddress);
        uniswapPoolsToSettings[_poolAddress] = poolSettings;
    }

    function removePool(address _poolAddress) external onlyOwner {
        require (
            uniswapPoolsToSettings[_poolAddress].isValid,
            "Uniswap pool address does not exist"
        );

        // Remove pool from the allowedUniswapPools array
        for (uint256 i = 0; i < allowedUniswapPools.length; i++) {
            if (allowedUniswapPools[i] == _poolAddress) {
                allowedUniswapPools[i] = allowedUniswapPools[allowedUniswapPools.length - 1];
                allowedUniswapPools.pop();
                break;
            }
        }

        delete uniswapPoolsToSettings[_poolAddress];
    }

    function getAllowedUniswapPools() external view returns (address[] memory) {
        return allowedUniswapPools;
    }

    /* ============ Internal Functions ============ */

    function _getUniswapPoolPrice(
        address _poolAddress,
        address _assetOne,
        address _assetTwo
    )
        internal
        view
        returns (uint256)
    {
        PoolSettings memory poolInfo = uniswapPoolsToSettings[_poolAddress];
        IUniswapV3Pool poolToken = IUniswapV3Pool(_poolAddress);

        (uint160 sqrtPriceX96,,,,,,) = poolToken.slot0();

        // Calculate the price from the sqrtPriceX96
        uint256 price = uint256(sqrtPriceX96).mul(uint256(sqrtPriceX96)).mul(1e18).div(1 << 192);
        
        if (_assetOne == poolInfo.tokenOne && _assetTwo == poolInfo.tokenTwo) {
            uint256 adjustedPrice = price.mul(poolInfo.tokenOneBaseUnit).div(poolInfo.tokenTwoBaseUnit);
            return adjustedPrice;
        } else if (_assetOne == poolInfo.tokenTwo && _assetTwo == poolInfo.tokenOne) {
            uint256 reversedPrice = uint256(1e36).mul(poolInfo.tokenTwoBaseUnit).div(price.mul(poolInfo.tokenOneBaseUnit));
            return reversedPrice;
        } else {
            revert("Invalid token pair");
        }
    }

    function _findPool(address _assetOne, address _assetTwo) internal view returns (address) {
        for (uint256 i = 0; i < allowedUniswapPools.length; i++) {
            PoolSettings memory poolInfo = uniswapPoolsToSettings[allowedUniswapPools[i]];
            if ((poolInfo.tokenOne == _assetOne && poolInfo.tokenTwo == _assetTwo) || 
                (poolInfo.tokenOne == _assetTwo && poolInfo.tokenTwo == _assetOne)) {
                return allowedUniswapPools[i];
            }
        }
        return address(0);
    }
}
