// SPDX-License-Identifier: Apache License, Version 2.0
pragma solidity ^0.6.10;

contract MockOracle {
    // Mapping from token address to exchange rate (Token to WETH)
    mapping(address => uint256) private rates;

    // Function to set the exchange rate for a token
    function setRate(address token, uint256 rate) external {
        rates[token] = rate;
    }

    // Function to get the exchange rate for a token
    function getRate(address token) external view returns (uint256) {
        return rates[token];
    }
}