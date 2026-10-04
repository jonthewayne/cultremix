// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// The Foundry cheatcodes these tests and scripts use. Kept local so the project has no
/// vendored dependencies; signatures match Foundry's Vm interface.
interface Vm {
    function addr(uint256 privateKey) external pure returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        pure
        returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function chainId(uint256 newChainId) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 revertData) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData)
        external;
    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData,
        address emitter
    ) external;
    function readFile(string calldata path) external view returns (string memory);
    function parseJsonUint(string calldata json, string calldata key)
        external
        pure
        returns (uint256);
    function parseJsonAddress(string calldata json, string calldata key)
        external
        pure
        returns (address);
    function parseJsonBytes32(string calldata json, string calldata key)
        external
        pure
        returns (bytes32);
    function parseJsonBytes(string calldata json, string calldata key)
        external
        pure
        returns (bytes memory);
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
