// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CultRemixRegistry} from "../src/CultRemixRegistry.sol";
import {vm} from "../test/utils/Vm.sol";

/// Deploys one registry. Each deployment environment gets its own registry.
///
///   DEPLOYER_PRIVATE_KEY  pays for the deployment (read from the environment, never an argument)
///   REGISTRY_ADMIN        optional; defaults to the deployer
///   REGISTRY_RELAYER      optional; defaults to the deployer
///
///   forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast
///
/// The deployed address is printed under "== Return ==".
contract Deploy {
    function run() external returns (CultRemixRegistry registry) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address admin = vm.envOr("REGISTRY_ADMIN", deployer);
        address relayer = vm.envOr("REGISTRY_RELAYER", deployer);

        vm.startBroadcast(deployerKey);
        registry = new CultRemixRegistry(admin, relayer);
        vm.stopBroadcast();
    }
}
