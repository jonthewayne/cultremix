# CultRemix registry

`CultRemixRegistry` is the onchain record of every published CultRemix: who made it, what it
remixes, and a hash of its print file. It also records Backs, lineage corrections, and the hash of
each economic config. It is non-upgradeable; each environment has its own deployment (dev and
staging on Monad testnet 10143, production on Monad mainnet 143). Addresses live in
`shared/config/chains.ts`.

## What the registry proves

A CultRemix-operated relayer submitted a record signed by the key of a CultRemix-custodied wallet
assigned to that account, at that time, with that lineage and content hash.

CultRemix holds the wallet keys for its members (Circle developer-controlled wallets), so a record
does not independently prove that the person behind the account agreed to it. The limit of three
Backs a week is per account; in V1 an account needs a verified email to Back, and that is the only
protection against one person running many accounts.

What anyone can check without trusting CultRemix's servers:

- The work's creator address is the address that signed it (EIP-712, recovered onchain).
- The lineage follows the structural rules below, and no correction ever made it a loop.
- The print file's SHA-256 (`contentHash`) and its page URL (`uriHash`, keccak-256 of the URL) were
  fixed at registration and never change.
- Each Back's position (`ordinal`) and registry week, as recorded at the time.
- The economic config of each version has the registered SHA-256 and can never be replaced.

## Rules

- **Roles.** One `admin` (adds and removes relayers, registers configs, amends lineage, two-step
  transfer) and a set of relayers. Only a relayer can submit works and Backs.
- **EIP-712 domain.** Name `CultRemixRegistry`, version `1`, chain ID, and this contract's
  address, so a signature from another chain or another deployment fails.
- **`registerWork(RegisterWork, sig)`.** The signed struct is
  `workId, family, expression, kind, parentId, contentHash, uriHash, creator, deadline`. The signer
  must be the creator, the deadline must not have passed, and the workId and the
  (family, expression) pair must be unused.
  - `original` (0): no parent, expression 1, family unused.
  - `variation` (1): parent registered, same family as the parent.
  - `fork` (2): parent registered, family unused, expression 1.
- **`back(Back, sig)`.** The signed struct is `workId, backer, deadline`. The signer must be the
  backer, the work must be registered, and the backer must not be its creator or have Backed it
  before. A backer gets three Backs per registry week, where
  `week = (block.timestamp - EPOCH) / 1 weeks` and `EPOCH = 1790553600` (Monday
  2026-09-28 00:00:00 UTC). The ordinal is the work's backer count after this Back.
- **`amendLineage(workId, newParentId, newKind, reasonHash, sequence)`.** Admin only. `sequence`
  must be the work's amendment count plus one. Kind may change only between original and fork. An
  original has no parent; a fork's new parent is registered and in another family; a variation's
  new parent is registered and in its own family. The contract walks the new parent's ancestors up
  to 64 hops and refuses an amendment that would make a loop or that needs more hops. Registration
  has no depth limit.
- **`registerEconomicConfig(version, configHash)`.** Admin only. Versions start at 1 and go up by
  one; a registered version is never replaced.

Signatures must be 65 bytes with a low `s` value and `v` of 27 or 28.

## Build and test

Foundry 1.8.4. The project has no dependencies: tests use a small cheatcode interface in
`test/utils/`.

```bash
cd contracts
forge build
forge test
```

`test/fixtures/eip712-vectors.json` holds EIP-712 vectors that both the forge suite and
`tests/unit/eip712.test.ts` check, so the contract and the TypeScript signing code cannot drift
apart. Regenerate them with `bun run scripts/chain/eip712-vectors.ts`.

The ABI the app uses is committed at `convex/lib/chain/abi.ts`. After changing the contract, run
`forge build` and then `bun run scripts/chain/export-abi.ts`.

## Deploy

The deploy script reads the deployer key from the environment, never from an argument.

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=... REGISTRY_ADMIN=0x... REGISTRY_RELAYER=0x... \
  forge script script/Deploy.s.sol --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

`REGISTRY_ADMIN` and `REGISTRY_RELAYER` default to the deployer. The app's chain-write engine
signs every kind of write with the relayer key, including amendments and config registration, so
an environment's admin is its relayer address until a separate admin key exists. After a deploy,
put the address in `shared/config/chains.ts` for that environment.

`scripts/chain/deploy-testnet.ts` does the same deploy from TypeScript and reads the dev relayer
key from `~/.config/cultremix/chain.env` without printing it.

A dev reset (`devReset`) starts CR numbers again at 101, and the registry would refuse those
numbers because they are already taken there, so a reset needs a fresh dev registry.

The mainnet registry should be deployed from the bytecode verified on staging.

## Note for this machine

Foundry's binaries on the Intel dev box link libusb, which Homebrew could not install here. libusb
1.0.29 was built into `~/.foundry/libusb`, and each binary in `~/.foundry/bin` was repointed with
`install_name_tool` and re-signed with `codesign -s - -f`. Running `foundryup` replaces the
binaries, so that patch then has to be applied again.
