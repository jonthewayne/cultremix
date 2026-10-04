// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CultRemixRegistry as Registry} from "../src/CultRemixRegistry.sol";
import {Test} from "./utils/Test.sol";
import {vm} from "./utils/Vm.sol";

contract CultRemixRegistryTest is Test {
    event WorkRegistered(
        bytes32 indexed workId,
        address indexed creator,
        bytes32 indexed parentId,
        uint64 family,
        uint32 expression,
        uint8 kind,
        bytes32 contentHash,
        bytes32 uriHash
    );
    event Backed(bytes32 indexed workId, address indexed backer, uint256 ordinal, uint256 week);
    event LineageAmended(
        bytes32 indexed workId,
        bytes32 indexed newParentId,
        uint8 newKind,
        bytes32 reasonHash,
        uint256 sequence
    );
    event EconomicConfigRegistered(uint256 indexed version, bytes32 configHash);

    uint256 constant ADMIN_KEY = 0xA11CE;
    uint256 constant RELAYER_KEY = 0xBEEF;
    uint256 constant ALICE_KEY = 0xA1;
    uint256 constant BOB_KEY = 0xB0B;
    uint256 constant CARA_KEY = 0xCA4A;
    uint256 constant DEV_KEY = 0xDE5;
    uint256 constant EVE_KEY = 0xE5E;

    uint8 constant ORIGINAL = 0;
    uint8 constant VARIATION = 1;
    uint8 constant FORK = 2;
    uint256 constant EPOCH = 1790553600;

    Registry reg;
    address admin;
    address relayer;

    function setUp() public {
        admin = vm.addr(ADMIN_KEY);
        relayer = vm.addr(RELAYER_KEY);
        vm.warp(EPOCH + 1 days);
        reg = new Registry(admin, relayer);
    }

    // ------------------------------------------------------------ helpers

    function id(string memory name) internal pure returns (bytes32) {
        return keccak256(bytes(name));
    }

    function work(
        string memory name,
        uint64 family,
        uint32 expression,
        uint8 kind,
        bytes32 parentId,
        uint256 creatorKey
    ) internal view returns (Registry.RegisterWork memory) {
        return Registry.RegisterWork({
            workId: id(name),
            family: family,
            expression: expression,
            kind: kind,
            parentId: parentId,
            contentHash: sha256(bytes(name)),
            uriHash: keccak256(abi.encodePacked("https://cultremix.com/cr/", name)),
            creator: vm.addr(creatorKey),
            deadline: block.timestamp + 10 minutes
        });
    }

    function signWork(Registry.RegisterWork memory w, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        return signDigest(key, reg.hashRegisterWork(w));
    }

    function register(Registry.RegisterWork memory w, uint256 key) internal {
        bytes memory sig = signWork(w, key);
        vm.prank(relayer);
        reg.registerWork(w, sig);
    }

    function expectRegisterRevert(Registry.RegisterWork memory w, uint256 key, bytes4 err)
        internal
    {
        bytes memory sig = signWork(w, key);
        vm.prank(relayer);
        vm.expectRevert(err);
        reg.registerWork(w, sig);
    }

    function backMsg(bytes32 workId, uint256 backerKey)
        internal
        view
        returns (Registry.Back memory)
    {
        return Registry.Back({
            workId: workId,
            backer: vm.addr(backerKey),
            deadline: block.timestamp + 10 minutes
        });
    }

    function backWork(bytes32 workId, uint256 backerKey) internal {
        Registry.Back memory b = backMsg(workId, backerKey);
        bytes memory sig = signDigest(backerKey, reg.hashBack(b));
        vm.prank(relayer);
        reg.back(b, sig);
    }

    function expectBackRevert(bytes32 workId, uint256 backerKey, bytes4 err) internal {
        Registry.Back memory b = backMsg(workId, backerKey);
        bytes memory sig = signDigest(backerKey, reg.hashBack(b));
        vm.prank(relayer);
        vm.expectRevert(err);
        reg.back(b, sig);
    }

    function amend(bytes32 workId, bytes32 newParentId, uint8 newKind, uint256 sequence)
        internal
    {
        vm.prank(admin);
        reg.amendLineage(workId, newParentId, newKind, id("reason"), sequence);
    }

    function expectAmendRevert(
        bytes32 workId,
        bytes32 newParentId,
        uint8 newKind,
        uint256 sequence,
        bytes4 err
    ) internal {
        vm.prank(admin);
        vm.expectRevert(err);
        reg.amendLineage(workId, newParentId, newKind, id("reason"), sequence);
    }

    /// Family 101: root (alice) and variation 101-002 (bob).
    function seedFamily101() internal {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        register(work("101-002", 101, 2, VARIATION, id("101-001"), BOB_KEY), BOB_KEY);
    }

    // ----------------------------------------------------------- register

    function test_EpochIsMondaySeptember28() public view {
        assertEq(reg.EPOCH(), EPOCH, "epoch");
        // 1970-01-01 was a Thursday; Monday is 4 days later in the weekly cycle.
        assertEq(((EPOCH / 1 days) + 3) % 7, 0, "monday");
        assertEq(EPOCH % 1 days, 0, "midnight");
    }

    function test_RegisterOriginal() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        bytes memory sig = signWork(w, ALICE_KEY);
        vm.expectEmit(true, true, true, true, address(reg));
        emit WorkRegistered(w.workId, w.creator, 0, 101, 1, ORIGINAL, w.contentHash, w.uriHash);
        vm.prank(relayer);
        reg.registerWork(w, sig);

        Registry.Work memory stored = reg.getWork(w.workId);
        assertEq(stored.creator, vm.addr(ALICE_KEY), "creator");
        assertEq(stored.family, 101, "family");
        assertEq(stored.expression, 1, "expression");
        assertEq(stored.kind, ORIGINAL, "kind");
        assertEq(stored.parentId, bytes32(0), "parent");
        assertEq(stored.contentHash, w.contentHash, "content hash");
        assertEq(stored.uriHash, w.uriHash, "uri hash");
        assertEq(stored.registeredAt, block.timestamp, "registered at");
        assertEq(reg.workIdAt(101, 1), w.workId, "workIdAt");
        assertTrue(reg.familyUsed(101), "family used");
        assertTrue(reg.isRegistered(w.workId), "registered");
    }

    function test_RegisterVariation() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        Registry.RegisterWork memory w =
            work("101-002", 101, 2, VARIATION, id("101-001"), BOB_KEY);
        bytes memory sig = signWork(w, BOB_KEY);
        vm.expectEmit(true, true, true, true, address(reg));
        emit WorkRegistered(
            w.workId, w.creator, id("101-001"), 101, 2, VARIATION, w.contentHash, w.uriHash
        );
        vm.prank(relayer);
        reg.registerWork(w, sig);
        assertEq(reg.getWork(w.workId).parentId, id("101-001"), "parent");
        assertEq(reg.workIdAt(101, 2), w.workId, "workIdAt");
    }

    function test_RegisterFork() public {
        seedFamily101();
        Registry.RegisterWork memory w = work("102-001", 102, 1, FORK, id("101-002"), CARA_KEY);
        bytes memory sig = signWork(w, CARA_KEY);
        vm.expectEmit(true, true, true, true, address(reg));
        emit WorkRegistered(
            w.workId, w.creator, id("101-002"), 102, 1, FORK, w.contentHash, w.uriHash
        );
        vm.prank(relayer);
        reg.registerWork(w, sig);
        assertTrue(reg.familyUsed(102), "family used");
        assertEq(reg.getWork(w.workId).kind, FORK, "kind");
    }

    function test_RegisterOwnWorkVariationAllowed() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        register(work("101-002", 101, 2, VARIATION, id("101-001"), ALICE_KEY), ALICE_KEY);
        assertTrue(reg.isRegistered(id("101-002")), "registered");
    }

    function test_RevertWhen_WrongSigner() public {
        // Signed by Bob, claims Alice as creator.
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        expectRegisterRevert(w, BOB_KEY, Registry.InvalidSignature.selector);
    }

    function test_RevertWhen_SignatureIsMalformed() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        vm.prank(relayer);
        vm.expectRevert(Registry.InvalidSignature.selector);
        reg.registerWork(w, hex"1234");
    }

    function test_RevertWhen_SignatureIsMalleableCopy() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_KEY, reg.hashRegisterWork(w));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory flipped = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? 28 : 27);
        vm.prank(relayer);
        vm.expectRevert(Registry.InvalidSignature.selector);
        reg.registerWork(w, flipped);
    }

    function test_RevertWhen_CreatorIsZero() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        w.creator = address(0);
        expectRegisterRevert(w, ALICE_KEY, Registry.InvalidSignature.selector);
    }

    function test_RevertWhen_RegisterNotRelayer() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        bytes memory sig = signWork(w, ALICE_KEY);
        vm.prank(vm.addr(EVE_KEY));
        vm.expectRevert(Registry.NotRelayer.selector);
        reg.registerWork(w, sig);
        // The admin is not a relayer either.
        vm.prank(admin);
        vm.expectRevert(Registry.NotRelayer.selector);
        reg.registerWork(w, sig);
    }

    function test_RevertWhen_DuplicateWorkId() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        Registry.RegisterWork memory w = work("101-001", 102, 1, ORIGINAL, 0, ALICE_KEY);
        expectRegisterRevert(w, ALICE_KEY, Registry.WorkAlreadyRegistered.selector);
    }

    function test_RevertWhen_DuplicateFamilyExpression() public {
        seedFamily101();
        Registry.RegisterWork memory w =
            work("101-002-again", 101, 2, VARIATION, id("101-001"), CARA_KEY);
        expectRegisterRevert(w, CARA_KEY, Registry.ExpressionTaken.selector);
    }

    function test_RevertWhen_ZeroWorkId() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        w.workId = bytes32(0);
        expectRegisterRevert(w, ALICE_KEY, Registry.InvalidWorkId.selector);
    }

    function test_RevertWhen_UnknownKind() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, 3, 0, ALICE_KEY);
        expectRegisterRevert(w, ALICE_KEY, Registry.InvalidKind.selector);
    }

    function test_RevertWhen_OriginalWithParent() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        Registry.RegisterWork memory w = work("102-001", 102, 1, ORIGINAL, id("101-001"), BOB_KEY);
        expectRegisterRevert(w, BOB_KEY, Registry.ParentNotAllowed.selector);
    }

    function test_RevertWhen_OriginalNotExpressionOne() public {
        Registry.RegisterWork memory w = work("101-002", 101, 2, ORIGINAL, 0, ALICE_KEY);
        expectRegisterRevert(w, ALICE_KEY, Registry.InvalidExpression.selector);
    }

    function test_RevertWhen_OriginalIntoUsedFamily() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        Registry.RegisterWork memory w = work("101-001b", 101, 1, ORIGINAL, 0, BOB_KEY);
        expectRegisterRevert(w, BOB_KEY, Registry.FamilyTaken.selector);
    }

    function test_RevertWhen_VariationIntoAnotherFamily() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        register(work("102-001", 102, 1, ORIGINAL, 0, CARA_KEY), CARA_KEY);
        Registry.RegisterWork memory w =
            work("102-002", 102, 2, VARIATION, id("101-001"), BOB_KEY);
        expectRegisterRevert(w, BOB_KEY, Registry.FamilyMismatch.selector);
    }

    function test_RevertWhen_ForkIntoUsedFamily() public {
        seedFamily101();
        Registry.RegisterWork memory sameFamily =
            work("101-003", 101, 3, FORK, id("101-002"), CARA_KEY);
        expectRegisterRevert(sameFamily, CARA_KEY, Registry.FamilyTaken.selector);

        register(work("102-001", 102, 1, ORIGINAL, 0, DEV_KEY), DEV_KEY);
        Registry.RegisterWork memory otherUsed =
            work("102-001b", 102, 1, FORK, id("101-002"), CARA_KEY);
        expectRegisterRevert(otherUsed, CARA_KEY, Registry.FamilyTaken.selector);
    }

    function test_RevertWhen_ForkNotExpressionOne() public {
        seedFamily101();
        Registry.RegisterWork memory w = work("102-002", 102, 2, FORK, id("101-002"), CARA_KEY);
        expectRegisterRevert(w, CARA_KEY, Registry.InvalidExpression.selector);
    }

    function test_RevertWhen_UnregisteredParent() public {
        Registry.RegisterWork memory variation =
            work("101-002", 101, 2, VARIATION, id("101-001"), BOB_KEY);
        expectRegisterRevert(variation, BOB_KEY, Registry.ParentNotRegistered.selector);
        Registry.RegisterWork memory fork = work("102-001", 102, 1, FORK, id("101-001"), BOB_KEY);
        expectRegisterRevert(fork, BOB_KEY, Registry.ParentNotRegistered.selector);
        Registry.RegisterWork memory noParent = work("101-002", 101, 2, VARIATION, 0, BOB_KEY);
        expectRegisterRevert(noParent, BOB_KEY, Registry.ParentNotRegistered.selector);
    }

    function test_RevertWhen_DeadlinePassed() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        bytes memory sig = signWork(w, ALICE_KEY);
        vm.warp(w.deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(Registry.SignatureExpired.selector);
        reg.registerWork(w, sig);
    }

    function test_DeadlineIsInclusive() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        bytes memory sig = signWork(w, ALICE_KEY);
        vm.warp(w.deadline);
        vm.prank(relayer);
        reg.registerWork(w, sig);
        assertTrue(reg.isRegistered(w.workId), "registered at deadline");
    }

    function test_RevertWhen_SignatureFromAnotherChain() public {
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        uint256 home = block.chainid;
        vm.chainId(143);
        bytes memory sig = signWork(w, ALICE_KEY);
        vm.chainId(home);
        vm.prank(relayer);
        vm.expectRevert(Registry.InvalidSignature.selector);
        reg.registerWork(w, sig);
    }

    function test_RevertWhen_SignatureFromAnotherDeployment() public {
        Registry other = new Registry(admin, relayer);
        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        bytes memory sig = signDigest(ALICE_KEY, other.hashRegisterWork(w));
        vm.prank(relayer);
        vm.expectRevert(Registry.InvalidSignature.selector);
        reg.registerWork(w, sig);
        // The same signature is good on the deployment it was made for.
        vm.prank(relayer);
        other.registerWork(w, sig);
        assertTrue(other.isRegistered(w.workId), "registered on its own deployment");
    }

    function test_DomainSeparatorFollowsChainId() public {
        bytes32 home = reg.DOMAIN_SEPARATOR();
        uint256 homeChain = block.chainid;
        vm.chainId(143);
        assertTrue(reg.DOMAIN_SEPARATOR() != home, "changes with chain");
        vm.chainId(homeChain);
        assertEq(reg.DOMAIN_SEPARATOR(), home, "restored");
    }

    function test_RegistrationHasNoDepthLimit() public {
        register(work("w0", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        bytes32 parent = id("w0");
        for (uint32 i = 1; i <= 70; ++i) {
            string memory name = string(abi.encodePacked("w", vm_toString(i)));
            register(work(name, 101, i + 1, VARIATION, parent, BOB_KEY), BOB_KEY);
            parent = id(name);
        }
        assertTrue(reg.isRegistered(parent), "deep variation registered");
    }

    // --------------------------------------------------------------- back

    function test_BackOrdinals() public {
        seedFamily101();
        bytes32 workId = id("101-002");
        uint256[3] memory keys = [ALICE_KEY, CARA_KEY, DEV_KEY];
        for (uint256 i = 0; i < keys.length; ++i) {
            Registry.Back memory b = backMsg(workId, keys[i]);
            bytes memory sig = signDigest(keys[i], reg.hashBack(b));
            vm.expectEmit(true, true, true, true, address(reg));
            emit Backed(workId, b.backer, i + 1, 0);
            vm.prank(relayer);
            reg.back(b, sig);
            assertEq(reg.backOrdinal(workId, b.backer), i + 1, "ordinal");
        }
        assertEq(reg.backerCount(workId), 3, "count");
        assertEq(reg.weeklyBacks(vm.addr(CARA_KEY), 0), 1, "weekly");
    }

    function test_RevertWhen_FourthBackInAWeek() public {
        for (uint64 f = 101; f <= 104; ++f) {
            string memory name = vm_toString(f);
            register(work(name, f, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        }
        backWork(id("101"), BOB_KEY);
        backWork(id("102"), BOB_KEY);
        vm.warp(EPOCH + 7 days - 1); // last second of week 0
        backWork(id("103"), BOB_KEY);
        expectBackRevert(id("104"), BOB_KEY, Registry.WeeklyBackLimit.selector);
        assertEq(reg.weeklyBacks(vm.addr(BOB_KEY), 0), 3, "three this week");
    }

    function test_BackAllowedNextWeek() public {
        for (uint64 f = 101; f <= 104; ++f) {
            string memory name = vm_toString(f);
            register(work(name, f, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        }
        backWork(id("101"), BOB_KEY);
        backWork(id("102"), BOB_KEY);
        backWork(id("103"), BOB_KEY);
        vm.warp(EPOCH + 7 days); // first second of week 1
        assertEq(reg.currentWeek(), 1, "week 1");
        Registry.Back memory b = backMsg(id("104"), BOB_KEY);
        bytes memory sig = signDigest(BOB_KEY, reg.hashBack(b));
        vm.expectEmit(true, true, true, true, address(reg));
        emit Backed(id("104"), b.backer, 1, 1);
        vm.prank(relayer);
        reg.back(b, sig);
        assertEq(reg.weeklyBacks(vm.addr(BOB_KEY), 1), 1, "one in week 1");
    }

    function test_RevertWhen_DuplicateBack() public {
        seedFamily101();
        backWork(id("101-002"), CARA_KEY);
        expectBackRevert(id("101-002"), CARA_KEY, Registry.AlreadyBacked.selector);
        vm.warp(EPOCH + 7 days);
        expectBackRevert(id("101-002"), CARA_KEY, Registry.AlreadyBacked.selector);
    }

    function test_RevertWhen_SelfBack() public {
        seedFamily101();
        expectBackRevert(id("101-002"), BOB_KEY, Registry.SelfBack.selector);
    }

    function test_RevertWhen_BackUnregisteredWork() public {
        expectBackRevert(id("nothing"), BOB_KEY, Registry.WorkNotRegistered.selector);
    }

    function test_RevertWhen_BackWrongSigner() public {
        seedFamily101();
        Registry.Back memory b = backMsg(id("101-002"), CARA_KEY);
        bytes memory sig = signDigest(DEV_KEY, reg.hashBack(b));
        vm.prank(relayer);
        vm.expectRevert(Registry.InvalidSignature.selector);
        reg.back(b, sig);
    }

    function test_RevertWhen_BackExpired() public {
        seedFamily101();
        Registry.Back memory b = backMsg(id("101-002"), CARA_KEY);
        bytes memory sig = signDigest(CARA_KEY, reg.hashBack(b));
        vm.warp(b.deadline + 1);
        vm.prank(relayer);
        vm.expectRevert(Registry.SignatureExpired.selector);
        reg.back(b, sig);
    }

    function test_RevertWhen_BackNotRelayer() public {
        seedFamily101();
        Registry.Back memory b = backMsg(id("101-002"), CARA_KEY);
        bytes memory sig = signDigest(CARA_KEY, reg.hashBack(b));
        vm.prank(vm.addr(CARA_KEY));
        vm.expectRevert(Registry.NotRelayer.selector);
        reg.back(b, sig);
    }

    function test_RevertWhen_BackBeforeEpoch() public {
        seedFamily101();
        vm.warp(EPOCH - 1);
        expectBackRevert(id("101-002"), CARA_KEY, Registry.BeforeEpoch.selector);
    }

    // -------------------------------------------------------------- amend

    function test_AmendForkToOriginal() public {
        seedFamily101();
        register(work("102-001", 102, 1, FORK, id("101-002"), CARA_KEY), CARA_KEY);
        vm.expectEmit(true, true, true, true, address(reg));
        emit LineageAmended(id("102-001"), 0, ORIGINAL, id("reason"), 1);
        amend(id("102-001"), 0, ORIGINAL, 1);
        Registry.Work memory stored = reg.getWork(id("102-001"));
        assertEq(stored.kind, ORIGINAL, "kind");
        assertEq(stored.parentId, bytes32(0), "parent");
        assertEq(reg.amendmentCount(id("102-001")), 1, "count");
    }

    function test_AmendOriginalToFork() public {
        seedFamily101();
        register(work("102-001", 102, 1, ORIGINAL, 0, CARA_KEY), CARA_KEY);
        amend(id("102-001"), id("101-002"), FORK, 1);
        Registry.Work memory stored = reg.getWork(id("102-001"));
        assertEq(stored.kind, FORK, "kind");
        assertEq(stored.parentId, id("101-002"), "parent");
    }

    function test_AmendForkNewParent() public {
        seedFamily101();
        register(work("102-001", 102, 1, FORK, id("101-002"), CARA_KEY), CARA_KEY);
        amend(id("102-001"), id("101-001"), FORK, 1);
        assertEq(reg.getWork(id("102-001")).parentId, id("101-001"), "parent");
    }

    function test_AmendVariationNewParentInFamily() public {
        seedFamily101();
        register(work("101-003", 101, 3, VARIATION, id("101-001"), CARA_KEY), CARA_KEY);
        amend(id("101-003"), id("101-002"), VARIATION, 1);
        assertEq(reg.getWork(id("101-003")).parentId, id("101-002"), "parent");
    }

    function test_RevertWhen_AmendSequenceReplay() public {
        seedFamily101();
        register(work("102-001", 102, 1, FORK, id("101-002"), CARA_KEY), CARA_KEY);
        expectAmendRevert(id("102-001"), 0, ORIGINAL, 0, Registry.InvalidSequence.selector);
        expectAmendRevert(id("102-001"), 0, ORIGINAL, 2, Registry.InvalidSequence.selector);
        amend(id("102-001"), 0, ORIGINAL, 1);
        expectAmendRevert(id("102-001"), 0, ORIGINAL, 1, Registry.InvalidSequence.selector);
        amend(id("102-001"), id("101-001"), FORK, 2);
        assertEq(reg.amendmentCount(id("102-001")), 2, "count");
    }

    function test_RevertWhen_AmendCycle() public {
        register(work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        register(work("102-001", 102, 1, FORK, id("101-001"), BOB_KEY), BOB_KEY);
        register(work("103-001", 103, 1, FORK, id("102-001"), CARA_KEY), CARA_KEY);
        // 101-001 forking from its own descendant would close a loop.
        expectAmendRevert(id("101-001"), id("103-001"), FORK, 1, Registry.LineageCycle.selector);
        expectAmendRevert(id("101-001"), id("102-001"), FORK, 1, Registry.LineageCycle.selector);
    }

    function test_RevertWhen_AmendParentIsSelf() public {
        seedFamily101();
        expectAmendRevert(
            id("101-002"), id("101-002"), VARIATION, 1, Registry.LineageCycle.selector
        );
    }

    function test_RevertWhen_AmendUnregisteredWork() public {
        seedFamily101();
        expectAmendRevert(id("nothing"), 0, ORIGINAL, 1, Registry.WorkNotRegistered.selector);
    }

    function test_RevertWhen_AmendWalkExceeds64Hops() public {
        // Family 101: w0 (original) ← w1 ← … ← w64, each a variation of the previous.
        register(work("w0", 101, 1, ORIGINAL, 0, ALICE_KEY), ALICE_KEY);
        for (uint32 i = 1; i <= 64; ++i) {
            string memory name = string(abi.encodePacked("w", vm_toString(i)));
            string memory prev = string(abi.encodePacked("w", vm_toString(i - 1)));
            register(work(name, 101, i + 1, VARIATION, id(prev), BOB_KEY), BOB_KEY);
        }
        register(work("200-001", 200, 1, ORIGINAL, 0, CARA_KEY), CARA_KEY);
        // Forking from w64 puts 200-001 65 links below w0: refused.
        expectAmendRevert(id("200-001"), id("w64"), FORK, 1, Registry.LineageTooDeep.selector);
        // Forking from w63 is exactly 64 links: accepted.
        amend(id("200-001"), id("w63"), FORK, 1);
        assertEq(reg.getWork(id("200-001")).parentId, id("w63"), "parent");
    }

    function test_RevertWhen_AmendChangesVariationKind() public {
        seedFamily101();
        register(work("102-001", 102, 1, ORIGINAL, 0, CARA_KEY), CARA_KEY);
        expectAmendRevert(
            id("101-002"), id("102-001"), FORK, 1, Registry.KindChangeNotAllowed.selector
        );
        expectAmendRevert(id("101-002"), 0, ORIGINAL, 1, Registry.KindChangeNotAllowed.selector);
        expectAmendRevert(
            id("102-001"), id("101-001"), VARIATION, 1, Registry.KindChangeNotAllowed.selector
        );
        expectAmendRevert(id("102-001"), 0, 3, 1, Registry.InvalidKind.selector);
    }

    function test_RevertWhen_AmendBreaksParentRules() public {
        seedFamily101();
        register(work("102-001", 102, 1, FORK, id("101-002"), CARA_KEY), CARA_KEY);
        register(work("103-001", 103, 1, ORIGINAL, 0, DEV_KEY), DEV_KEY);
        // Original with a parent.
        expectAmendRevert(
            id("103-001"), id("101-001"), ORIGINAL, 1, Registry.ParentNotAllowed.selector
        );
        // Fork whose new parent is in its own family.
        register(work("102-002", 102, 2, VARIATION, id("102-001"), DEV_KEY), DEV_KEY);
        expectAmendRevert(id("102-001"), id("102-002"), FORK, 1, Registry.FamilyMismatch.selector);
        // Variation whose new parent is in another family.
        expectAmendRevert(
            id("101-002"), id("103-001"), VARIATION, 1, Registry.FamilyMismatch.selector
        );
        // Unregistered parent.
        expectAmendRevert(
            id("102-001"), id("nothing"), FORK, 1, Registry.ParentNotRegistered.selector
        );
    }

    function test_RevertWhen_AmendNotAdmin() public {
        seedFamily101();
        vm.prank(relayer);
        vm.expectRevert(Registry.NotAdmin.selector);
        reg.amendLineage(id("101-002"), id("101-001"), VARIATION, id("reason"), 1);
    }

    // ------------------------------------------------------------- config

    function test_RegisterEconomicConfigAppendOnly() public {
        bytes32 v1 = keccak256("config v1");
        vm.expectEmit(true, true, true, true, address(reg));
        emit EconomicConfigRegistered(1, v1);
        vm.prank(admin);
        reg.registerEconomicConfig(1, v1);
        assertEq(reg.economicConfigHash(1), v1, "v1 stored");
        assertEq(reg.latestEconomicConfigVersion(), 1, "latest");

        // A registered version can never be replaced.
        vm.prank(admin);
        vm.expectRevert(Registry.InvalidConfigVersion.selector);
        reg.registerEconomicConfig(1, keccak256("different"));
        // Versions cannot skip ahead.
        vm.prank(admin);
        vm.expectRevert(Registry.InvalidConfigVersion.selector);
        reg.registerEconomicConfig(3, keccak256("config v3"));
        vm.prank(admin);
        vm.expectRevert(Registry.InvalidConfigHash.selector);
        reg.registerEconomicConfig(2, bytes32(0));

        vm.prank(admin);
        reg.registerEconomicConfig(2, keccak256("config v2"));
        assertEq(reg.economicConfigHash(1), v1, "v1 unchanged");
        assertEq(reg.latestEconomicConfigVersion(), 2, "latest v2");
    }

    function test_RevertWhen_ConfigNotAdmin() public {
        vm.prank(relayer);
        vm.expectRevert(Registry.NotAdmin.selector);
        reg.registerEconomicConfig(1, keccak256("config v1"));
    }

    // -------------------------------------------------------------- roles

    function test_AdminManagesRelayers() public {
        address extra = vm.addr(EVE_KEY);
        vm.prank(relayer);
        vm.expectRevert(Registry.NotAdmin.selector);
        reg.addRelayer(extra);

        vm.prank(admin);
        reg.addRelayer(extra);
        assertTrue(reg.isRelayer(extra), "added");

        Registry.RegisterWork memory w = work("101-001", 101, 1, ORIGINAL, 0, ALICE_KEY);
        bytes memory sig = signWork(w, ALICE_KEY);
        vm.prank(admin);
        reg.removeRelayer(relayer);
        vm.prank(relayer);
        vm.expectRevert(Registry.NotRelayer.selector);
        reg.registerWork(w, sig);
        vm.prank(extra);
        reg.registerWork(w, sig);
        assertTrue(reg.isRegistered(w.workId), "registered by new relayer");
    }

    function test_AdminTransferIsTwoStep() public {
        address next = vm.addr(EVE_KEY);
        vm.prank(admin);
        reg.transferAdmin(next);
        assertEq(reg.admin(), admin, "unchanged until accepted");
        vm.prank(relayer);
        vm.expectRevert(Registry.NotPendingAdmin.selector);
        reg.acceptAdmin();
        vm.prank(next);
        reg.acceptAdmin();
        assertEq(reg.admin(), next, "transferred");
        assertEq(reg.pendingAdmin(), address(0), "cleared");
        vm.prank(admin);
        vm.expectRevert(Registry.NotAdmin.selector);
        reg.registerEconomicConfig(1, keccak256("config v1"));
    }

    function test_RevertWhen_ConstructedWithZeroAddress() public {
        vm.expectRevert(Registry.ZeroAddress.selector);
        new Registry(address(0), relayer);
        vm.expectRevert(Registry.ZeroAddress.selector);
        new Registry(admin, address(0));
    }

    // ------------------------------------------------------ shared vectors

    /// The same vectors are checked by tests/unit/eip712.test.ts against the TypeScript builders.
    function test_SharedEip712Vectors() public {
        string memory json = vm.readFile("test/fixtures/eip712-vectors.json");
        uint256 chainId = vm.parseJsonUint(json, ".domain.chainId");
        address verifying = vm.parseJsonAddress(json, ".domain.verifyingContract");

        vm.chainId(chainId);
        Registry deployed = new Registry(admin, relayer);
        vm.etch(verifying, address(deployed).code);
        Registry atVector = Registry(verifying);

        assertEq(atVector.DOMAIN_SEPARATOR(), vm.parseJsonBytes32(json, ".domainSeparator"), "ds");

        Registry.RegisterWork memory w = Registry.RegisterWork({
            workId: vm.parseJsonBytes32(json, ".registerWork.message.workId"),
            family: uint64(vm.parseJsonUint(json, ".registerWork.message.family")),
            expression: uint32(vm.parseJsonUint(json, ".registerWork.message.expression")),
            kind: uint8(vm.parseJsonUint(json, ".registerWork.message.kind")),
            parentId: vm.parseJsonBytes32(json, ".registerWork.message.parentId"),
            contentHash: vm.parseJsonBytes32(json, ".registerWork.message.contentHash"),
            uriHash: vm.parseJsonBytes32(json, ".registerWork.message.uriHash"),
            creator: vm.parseJsonAddress(json, ".registerWork.message.creator"),
            deadline: vm.parseJsonUint(json, ".registerWork.message.deadline")
        });
        bytes32 registerDigest = atVector.hashRegisterWork(w);
        assertEq(registerDigest, vm.parseJsonBytes32(json, ".registerWork.digest"), "rw digest");
        uint256 creatorKey = vm.parseJsonUint(json, ".registerWork.privateKey");
        assertEq(vm.addr(creatorKey), w.creator, "rw signer");
        assertEq(
            signDigest(creatorKey, registerDigest),
            vm.parseJsonBytes(json, ".registerWork.signature"),
            "rw signature"
        );

        Registry.Back memory b = Registry.Back({
            workId: vm.parseJsonBytes32(json, ".back.message.workId"),
            backer: vm.parseJsonAddress(json, ".back.message.backer"),
            deadline: vm.parseJsonUint(json, ".back.message.deadline")
        });
        bytes32 backDigest = atVector.hashBack(b);
        assertEq(backDigest, vm.parseJsonBytes32(json, ".back.digest"), "back digest");
        uint256 backerKey = vm.parseJsonUint(json, ".back.privateKey");
        assertEq(
            signDigest(backerKey, backDigest),
            vm.parseJsonBytes(json, ".back.signature"),
            "back signature"
        );

        vm.chainId(143);
        assertEq(
            atVector.hashRegisterWork(w),
            vm.parseJsonBytes32(json, ".registerWork.mainnetDigest"),
            "mainnet digest"
        );
    }

    // -------------------------------------------------------------- utils

    function vm_toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        for (uint256 v = value; v != 0; v /= 10) ++digits;
        bytes memory out = new bytes(digits);
        for (; value != 0; value /= 10) out[--digits] = bytes1(uint8(48 + (value % 10)));
        return string(out);
    }
}
