// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IAaveV3PoolAddressesProvider {
    function getPool() external view returns (address);
}
