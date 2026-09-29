# ADR 0001: Onchain provenance is relayer-submitted, wallet-signed, and finalized-only

Status: Accepted, 2026-09-27
Plan: `docs/plans/2026-09-27-feat-cultremix-v1-core-loop.md` (KTD-7, KTD-14, "Registry contract", "Chain write outcomes")

## Context

CultRemix records authorship, lineage, lineage corrections, Backs, and economic-config hashes on Monad. Users never hold MON, see a seed phrase, or connect a wallet; each account gets a developer-controlled Circle wallet. The hackathon rubric and the product thesis both depend on these records being correct and independently verifiable.

## Decision

- One non-upgradeable `CultRemixRegistry` per network. A CultRemix relayer EOA submits every write and pays gas; each work registration and Back carries an EIP-712 signature from the actor's Circle wallet, and the contract records the recovered signer. Lineage amendments are admin-only with a strict sequence number.
- A write counts as confirmed only when its successful receipt sits in a finalized, canonical block; every reconciliation read uses the `finalized` block tag.
- Dev and staging deployments talk only to Monad testnet (10143) and production only to mainnet (143); each environment has its own registry deployment, and a single consistency check covers network, RPC, registry address, Circle environment, and wallet set. The mainnet registry is deployed from the staging-verified bytecode.
- Withdrawal hides a work and its product but never stops or reverses its provenance.
- Later needs (settlement) use separate contracts; a registry v2 would be a new deployment with v1 records still valid.

## Invariants (each has a test in the plan)

- INV-7: registry creator/backer equals the EIP-712 signer; relayer-only submission; structural lineage rules.
- INV-8: at most 3 Backs per account per registry week, one per work, no self-Back.
- INV-13: a deployment refuses mixed or wrong-environment configuration.
- INV-19: every user eventually has a ready wallet (reconciliation retries).
- INV-22: external effects happen exactly once through stable identities and reconciliation.
- INV-30: chain-derived effects use only finalized receipts and finalized-tag reads.

## What the registry proves

A CultRemix-operated relayer submitted a record signed by the key of a CultRemix-custodied wallet assigned to that account, at that time, with that lineage and content hash. Because custody is developer-controlled, it does not independently prove human consent, and the Back limit is per account. Product copy, the README, and the pitch must say this plainly.

## Consequences of ignoring this

Treating unfinalized receipts as final can activate amendments or freeze economic recipients on records that later disappear. Letting withdrawal pause provenance strands registered children. Overstating custody undermines the trust claim that the onchain layer exists to support.

## File references

`contracts/src/CultRemixRegistry.sol`, `convex/chain.ts`, `convex/lib/relayer.ts`, `convex/lib/circle.ts`, `convex/lib/eip712.ts`, `convex/lib/deployment.ts`, `shared/config/chains.ts`
