// SPDX-License-Identifier: Apache License, Version 2.0
pragma solidity ^0.6.10;

import { INAVIssuanceHook } from "../interfaces/INAVIssuanceHook.sol";
import { ISetToken } from "../interfaces/ISetToken.sol";

// BasicIssuanceHook Example
contract IssuanceHook is INAVIssuanceHook {
    function invokePreIssueHook(
        ISetToken _setToken,
        address _reserveAsset,
        uint256 _reserveAssetQuantity,
        address _caller,
        address _to
    )
        external
        override
    {
        // Custom logic before issuance. For example:
        // Validate the transaction, update states, emit an event, etc.
    }

    function invokePreRedeemHook(
        ISetToken _setToken,
        uint256 _setTokenQuantity,
        address _caller,
        address _to
    )
        external
        override
    {
        // Custom logic before redemption. Similar to issuance hook.
    }
}
