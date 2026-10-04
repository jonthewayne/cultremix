// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title CultRemix provenance registry
/// @notice Records every published CultRemix work, every Back, every lineage correction, and
/// every economic config. Records arrive through a CultRemix relayer and carry an EIP-712
/// signature from the wallet assigned to the creator or backer.
/// @dev Non-upgradeable. What a record proves: a CultRemix-operated relayer submitted a record
/// signed by the key of a CultRemix-custodied wallet assigned to that account, at that time,
/// with that lineage and content hash. Custody is developer-controlled, so a record does not by
/// itself prove human consent. The Back limit is per account.
contract CultRemixRegistry {
    // ---------------------------------------------------------------- types

    uint8 public constant KIND_ORIGINAL = 0;
    uint8 public constant KIND_VARIATION = 1;
    uint8 public constant KIND_FORK = 2;

    /// Signed by the creator's wallet.
    struct RegisterWork {
        bytes32 workId;
        uint64 family;
        uint32 expression;
        uint8 kind;
        bytes32 parentId;
        bytes32 contentHash;
        bytes32 uriHash;
        address creator;
        uint256 deadline;
    }

    /// Signed by the backer's wallet.
    struct Back {
        bytes32 workId;
        address backer;
        uint256 deadline;
    }

    /// Stored record. `kind` and `parentId` are the effective lineage (amendments update them);
    /// the registration values stay in the WorkRegistered event.
    struct Work {
        address creator;
        uint64 family;
        uint32 expression;
        uint8 kind;
        uint64 registeredAt;
        bytes32 parentId;
        bytes32 contentHash;
        bytes32 uriHash;
    }

    // ------------------------------------------------------------ constants

    /// Registry weeks start Monday 2026-09-28T00:00:00Z.
    uint256 public constant EPOCH = 1790553600;
    uint256 public constant MAX_BACKS_PER_WEEK = 3;
    /// Bound on the parent walk that keeps amendments from creating cycles.
    uint256 public constant MAX_AMEND_HOPS = 64;

    bytes32 public constant REGISTER_WORK_TYPEHASH = keccak256(
        "RegisterWork(bytes32 workId,uint64 family,uint32 expression,uint8 kind,bytes32 parentId,bytes32 contentHash,bytes32 uriHash,address creator,uint256 deadline)"
    );
    bytes32 public constant BACK_TYPEHASH =
        keccak256("Back(bytes32 workId,address backer,uint256 deadline)");

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("CultRemixRegistry");
    bytes32 private constant VERSION_HASH = keccak256("1");
    /// secp256k1n / 2; signatures with a higher s are malleable copies.
    uint256 private constant MAX_S =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    uint256 private immutable _cachedChainId;
    address private immutable _cachedThis;
    bytes32 private immutable _cachedDomainSeparator;

    // ---------------------------------------------------------------- state

    address public admin;
    address public pendingAdmin;
    mapping(address => bool) public isRelayer;

    mapping(bytes32 => Work) private _works;
    /// (family, expression) → workId.
    mapping(uint64 => mapping(uint32 => bytes32)) public workIdAt;
    mapping(uint64 => bool) public familyUsed;

    /// Number of Backs a work has received; the next Back's ordinal is this plus one.
    mapping(bytes32 => uint256) public backerCount;
    /// (work, backer) → ordinal; zero means not backed.
    mapping(bytes32 => mapping(address => uint256)) public backOrdinal;
    /// (backer, registry week) → Backs placed that week.
    mapping(address => mapping(uint256 => uint256)) public weeklyBacks;

    mapping(bytes32 => uint256) public amendmentCount;

    /// version → SHA-256 of the canonical config JSON.
    mapping(uint256 => bytes32) public economicConfigHash;
    uint256 public latestEconomicConfigVersion;

    // --------------------------------------------------------------- events

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
    event RelayerAdded(address indexed relayer);
    event RelayerRemoved(address indexed relayer);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    // --------------------------------------------------------------- errors

    error NotAdmin();
    error NotPendingAdmin();
    error NotRelayer();
    error ZeroAddress();
    error SignatureExpired();
    error InvalidSignature();
    error InvalidWorkId();
    error InvalidKind();
    error WorkAlreadyRegistered();
    error ExpressionTaken();
    error FamilyTaken();
    error ParentNotAllowed();
    error InvalidExpression();
    error ParentNotRegistered();
    error FamilyMismatch();
    error WorkNotRegistered();
    error SelfBack();
    error AlreadyBacked();
    error WeeklyBackLimit();
    error BeforeEpoch();
    error InvalidSequence();
    error KindChangeNotAllowed();
    error LineageCycle();
    error LineageTooDeep();
    error InvalidConfigVersion();
    error InvalidConfigHash();

    // ------------------------------------------------------------ modifiers

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyRelayer() {
        if (!isRelayer[msg.sender]) revert NotRelayer();
        _;
    }

    // ---------------------------------------------------------- constructor

    constructor(address admin_, address relayer_) {
        if (admin_ == address(0) || relayer_ == address(0)) revert ZeroAddress();
        admin = admin_;
        emit AdminTransferred(address(0), admin_);
        isRelayer[relayer_] = true;
        emit RelayerAdded(relayer_);
        _cachedChainId = block.chainid;
        _cachedThis = address(this);
        _cachedDomainSeparator = _buildDomainSeparator();
    }

    // -------------------------------------------------------------- records

    function registerWork(RegisterWork calldata w, bytes calldata sig) external onlyRelayer {
        if (block.timestamp > w.deadline) revert SignatureExpired();
        _requireSigner(hashRegisterWork(w), sig, w.creator);
        if (w.workId == bytes32(0)) revert InvalidWorkId();
        if (_works[w.workId].creator != address(0)) revert WorkAlreadyRegistered();

        // Originals and forks open a new family at expression 1; variations join their
        // parent's family. A family is used once any work is registered in it.
        if (w.kind == KIND_ORIGINAL) {
            if (w.parentId != bytes32(0)) revert ParentNotAllowed();
            if (w.expression != 1) revert InvalidExpression();
            if (familyUsed[w.family]) revert FamilyTaken();
        } else if (w.kind == KIND_VARIATION) {
            Work storage parent = _works[w.parentId];
            if (parent.creator == address(0)) revert ParentNotRegistered();
            if (parent.family != w.family) revert FamilyMismatch();
        } else if (w.kind == KIND_FORK) {
            if (_works[w.parentId].creator == address(0)) revert ParentNotRegistered();
            if (familyUsed[w.family]) revert FamilyTaken();
            if (w.expression != 1) revert InvalidExpression();
        } else {
            revert InvalidKind();
        }
        if (workIdAt[w.family][w.expression] != bytes32(0)) revert ExpressionTaken();

        _works[w.workId] = Work({
            creator: w.creator,
            family: w.family,
            expression: w.expression,
            kind: w.kind,
            registeredAt: uint64(block.timestamp),
            parentId: w.parentId,
            contentHash: w.contentHash,
            uriHash: w.uriHash
        });
        workIdAt[w.family][w.expression] = w.workId;
        familyUsed[w.family] = true;

        emit WorkRegistered(
            w.workId, w.creator, w.parentId, w.family, w.expression, w.kind, w.contentHash, w.uriHash
        );
    }

    function back(Back calldata b, bytes calldata sig) external onlyRelayer {
        if (block.timestamp > b.deadline) revert SignatureExpired();
        _requireSigner(hashBack(b), sig, b.backer);
        address creator = _works[b.workId].creator;
        if (creator == address(0)) revert WorkNotRegistered();
        if (b.backer == creator) revert SelfBack();
        if (backOrdinal[b.workId][b.backer] != 0) revert AlreadyBacked();
        uint256 week = currentWeek();
        if (weeklyBacks[b.backer][week] >= MAX_BACKS_PER_WEEK) revert WeeklyBackLimit();

        uint256 ordinal = ++backerCount[b.workId];
        backOrdinal[b.workId][b.backer] = ordinal;
        weeklyBacks[b.backer][week] += 1;

        emit Backed(b.workId, b.backer, ordinal, week);
    }

    function amendLineage(
        bytes32 workId,
        bytes32 newParentId,
        uint8 newKind,
        bytes32 reasonHash,
        uint256 sequence
    ) external onlyAdmin {
        Work storage work = _works[workId];
        if (work.creator == address(0)) revert WorkNotRegistered();
        if (sequence != amendmentCount[workId] + 1) revert InvalidSequence();
        if (newKind > KIND_FORK) revert InvalidKind();

        // Kind changes only between original and fork.
        if (newKind != work.kind) {
            bool originalForkSwap = (work.kind == KIND_ORIGINAL && newKind == KIND_FORK)
                || (work.kind == KIND_FORK && newKind == KIND_ORIGINAL);
            if (!originalForkSwap) revert KindChangeNotAllowed();
        }

        if (newKind == KIND_ORIGINAL) {
            if (newParentId != bytes32(0)) revert ParentNotAllowed();
        } else {
            if (newParentId == workId) revert LineageCycle();
            Work storage parent = _works[newParentId];
            if (parent.creator == address(0)) revert ParentNotRegistered();
            if (newKind == KIND_FORK) {
                if (parent.family == work.family) revert FamilyMismatch();
            } else if (parent.family != work.family) {
                revert FamilyMismatch();
            }
            _requireNoCycle(workId, newParentId);
        }

        amendmentCount[workId] = sequence;
        work.kind = newKind;
        work.parentId = newParentId;

        emit LineageAmended(workId, newParentId, newKind, reasonHash, sequence);
    }

    /// Append-only: versions go 1, 2, 3… and a registered version never changes.
    function registerEconomicConfig(uint256 version, bytes32 configHash) external onlyAdmin {
        if (version != latestEconomicConfigVersion + 1) revert InvalidConfigVersion();
        if (configHash == bytes32(0)) revert InvalidConfigHash();
        economicConfigHash[version] = configHash;
        latestEconomicConfigVersion = version;
        emit EconomicConfigRegistered(version, configHash);
    }

    // ---------------------------------------------------------------- roles

    function addRelayer(address relayer) external onlyAdmin {
        if (relayer == address(0)) revert ZeroAddress();
        if (!isRelayer[relayer]) {
            isRelayer[relayer] = true;
            emit RelayerAdded(relayer);
        }
    }

    function removeRelayer(address relayer) external onlyAdmin {
        if (isRelayer[relayer]) {
            isRelayer[relayer] = false;
            emit RelayerRemoved(relayer);
        }
    }

    /// Two-step admin handover so a typo cannot lock the registry.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(admin, newAdmin);
    }

    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert NotPendingAdmin();
        emit AdminTransferred(admin, msg.sender);
        admin = msg.sender;
        pendingAdmin = address(0);
    }

    // ---------------------------------------------------------------- views

    function getWork(bytes32 workId) external view returns (Work memory) {
        return _works[workId];
    }

    function isRegistered(bytes32 workId) external view returns (bool) {
        return _works[workId].creator != address(0);
    }

    function currentWeek() public view returns (uint256) {
        if (block.timestamp < EPOCH) revert BeforeEpoch();
        return (block.timestamp - EPOCH) / 1 weeks;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _cachedChainId && address(this) == _cachedThis) {
            return _cachedDomainSeparator;
        }
        return _buildDomainSeparator();
    }

    /// EIP-5267 domain description, for wallets and explorers.
    function eip712Domain()
        external
        view
        returns (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        )
    {
        return (
            hex"0f",
            "CultRemixRegistry",
            "1",
            block.chainid,
            address(this),
            bytes32(0),
            new uint256[](0)
        );
    }

    /// EIP-712 digest the creator's wallet signs.
    function hashRegisterWork(RegisterWork calldata w) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                REGISTER_WORK_TYPEHASH,
                w.workId,
                w.family,
                w.expression,
                w.kind,
                w.parentId,
                w.contentHash,
                w.uriHash,
                w.creator,
                w.deadline
            )
        );
        return _digest(structHash);
    }

    /// EIP-712 digest the backer's wallet signs.
    function hashBack(Back calldata b) public view returns (bytes32) {
        return _digest(keccak256(abi.encode(BACK_TYPEHASH, b.workId, b.backer, b.deadline)));
    }

    // ------------------------------------------------------------- internal

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _requireSigner(bytes32 digest, bytes calldata sig, address expected) private pure {
        if (expected == address(0) || sig.length != 65) revert InvalidSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > MAX_S || (v != 27 && v != 28)) revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != expected) revert InvalidSignature();
    }

    /// Walks effective parents from the proposed parent. The amended work may sit at most
    /// MAX_AMEND_HOPS links below its new root, and the walk must never reach the work itself.
    function _requireNoCycle(bytes32 workId, bytes32 newParentId) private view {
        bytes32 cursor = newParentId;
        for (uint256 visited = 0; cursor != bytes32(0); ++visited) {
            if (visited == MAX_AMEND_HOPS) revert LineageTooDeep();
            if (cursor == workId) revert LineageCycle();
            cursor = _works[cursor].parentId;
        }
    }
}
