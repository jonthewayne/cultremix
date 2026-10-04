// An in-memory Monad for chain-write tests: blocks with a finality lag, a mempool keyed by
// (sender, nonce) with the replacement rule, reorgs, and CultRemixRegistry's rules for the four
// writes and the reads the engine makes. No network.
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  toHex,
  type Address,
  type Hex,
  type Log,
} from "viem";
import { registryAbi } from "../../convex/lib/chain/abi";
import type { RegistryErrorName } from "../../convex/lib/chain/calldata";
import {
  backTypedData,
  isCanonicalSignature,
  recoverTypedDataSigner,
  registerWorkTypedData,
  registryDomain,
} from "../../convex/lib/chain/eip712";
import { REGISTRY_EPOCH_SECONDS } from "../../convex/lib/chain/writes";
import type {
  BlockRef,
  BlockTag,
  CallRequest,
  CallResult,
  ChainBlock,
  ChainReceipt,
  ChainRpc,
  FeeEstimate,
  GasEstimate,
} from "../../convex/lib/chain/rpc";

export const FAKE_REGISTRY = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const ZERO_ADDRESS = `0x${"0".repeat(40)}` as Address;
const WEEK_SECONDS = 7n * 24n * 60n * 60n;
const GWEI = 1_000_000_000n;

type Work = {
  creator: Address;
  family: bigint;
  expression: number;
  kind: number;
  registeredAt: bigint;
  parentId: Hex;
  contentHash: Hex;
  uriHash: Hex;
};

type Registry = {
  works: Map<string, Work>;
  workIdAt: Map<string, Hex>;
  familyUsed: Set<string>;
  backOrdinal: Map<string, bigint>;
  backerCount: Map<string, bigint>;
  weeklyBacks: Map<string, bigint>;
  amendmentCount: Map<string, bigint>;
  configHash: Map<string, Hex>;
  latestConfig: bigint;
  relayers: Set<string>;
  admin: string;
};

type World = { registry: Registry; nonces: Map<string, number> };

type PendingTx = {
  hash: Hex;
  raw: Hex;
  from: Address;
  nonce: number;
  to: Address | null;
  data: Hex;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

type Block = { number: bigint; hash: Hex; timestamp: bigint; world: World; receipts: Array<ChainReceipt> };

type Emitted = { eventName: string; args: Record<string, unknown> };
type Exec = { ok: true; events: Array<Emitted> } | { ok: false; error: RegistryErrorName };

class Revert extends Error {
  constructor(readonly error: RegistryErrorName) {
    super(error);
  }
}

const low = (value: string) => value.toLowerCase();

function emptyWorld(relayers: Array<Address>, admin: Address): World {
  return {
    registry: {
      works: new Map(),
      workIdAt: new Map(),
      familyUsed: new Set(),
      backOrdinal: new Map(),
      backerCount: new Map(),
      weeklyBacks: new Map(),
      amendmentCount: new Map(),
      configHash: new Map(),
      latestConfig: 0n,
      relayers: new Set(relayers.map(low)),
      admin: low(admin),
    },
    nonces: new Map(),
  };
}

export type FakeChainOptions = {
  chainId?: number;
  relayer: Address;
  // Defaults to the relayer (as in dev).
  admin?: Address;
  // Accounts the registry lists as relayers. Defaults to [relayer].
  relayers?: Array<Address>;
  finalityLag?: number;
};

export class FakeChain implements ChainRpc {
  readonly chainId: number;
  readonly registry = FAKE_REGISTRY;
  finalityLag: number;
  fees: FeeEstimate = { maxFeePerGas: 100n * GWEI, maxPriorityFeePerGas: 2n * GWEI };
  // Transactions tipping less than this stay in the mempool.
  minPriorityFee = 0n;
  // Sends that fail as if the RPC were unreachable (the transaction never reaches the node).
  failSends = 0;
  // Serve receipts from blocks that were reorged away, like a lagging RPC node.
  staleReceipts = false;
  readonly balances = new Map<string, bigint>();
  readonly sent: Array<Hex> = [];
  private blocks: Array<Block>;
  private mempool = new Map<string, PendingTx>();
  private orphanReceipts = new Map<string, ChainReceipt>();
  private salt = 0;

  constructor(options: FakeChainOptions) {
    this.chainId = options.chainId ?? 10143;
    this.finalityLag = options.finalityLag ?? 2;
    const world = emptyWorld(options.relayers ?? [options.relayer], options.admin ?? options.relayer);
    this.blocks = [{ number: 0n, hash: this.blockHash(0n), timestamp: this.now(), world, receipts: [] }];
  }

  // ---------------------------------------------------------------- test controls

  get head() {
    return this.blocks[this.blocks.length - 1];
  }

  get mempoolTxs() {
    return [...this.mempool.values()];
  }

  /** The registry's state at the head, for assertions. */
  get state() {
    return this.head.world.registry;
  }

  work(workId: Hex) {
    return this.state.works.get(low(workId)) ?? null;
  }

  setBalance(address: Address, wei: bigint) {
    this.balances.set(low(address), wei);
  }

  /** Mines n blocks. Each includes, per sender, the next consecutive nonces that pay enough. */
  async mine(n = 1) {
    for (let i = 0; i < n; i += 1) await this.mineOne();
  }

  /**
   * Drops the newest `depth` blocks. Their transactions go back to the mempool unless dropTxs;
   * their receipts are kept for staleReceipts mode.
   */
  reorg(depth: number, options: { dropTxs?: boolean } = {}) {
    this.salt += 1;
    for (let i = 0; i < depth && this.blocks.length > 1; i += 1) {
      const block = this.blocks.pop()!;
      for (const receipt of block.receipts) {
        this.orphanReceipts.set(low(receipt.transactionHash), receipt);
        const tx = this.minedTxs.get(low(receipt.transactionHash));
        this.minedTxs.delete(low(receipt.transactionHash));
        if (tx && !options.dropTxs) this.mempool.set(this.slot(tx.from, tx.nonce), tx);
      }
    }
  }

  dropMempool() {
    this.mempool.clear();
  }

  // ---------------------------------------------------------------- ChainRpc

  async getChainId() {
    return this.chainId;
  }

  async getBlock(ref: BlockRef): Promise<ChainBlock> {
    const block = this.blockAt(ref);
    return { number: block.number, hash: block.hash, timestamp: block.timestamp };
  }

  async getTransactionReceipt(hash: Hex) {
    const key = low(hash);
    for (const block of this.blocks) {
      const receipt = block.receipts.find((r) => low(r.transactionHash) === key);
      if (receipt) return receipt;
    }
    return this.staleReceipts ? (this.orphanReceipts.get(key) ?? null) : null;
  }

  async getTransactionCount(address: Address, tag: BlockTag) {
    return this.blockAt(tag).world.nonces.get(low(address)) ?? 0;
  }

  async estimateGas(request: CallRequest): Promise<GasEstimate> {
    const result = await this.simulate(request, this.head, BigInt(Math.max(Number(this.head.timestamp), Number(this.now()))));
    return result.ok ? { ok: true, gas: 150_000n } : result;
  }

  async call(request: CallRequest, at: BlockRef): Promise<CallResult> {
    const block = this.blockAt(at);
    return await this.simulate(request, block, block.timestamp);
  }

  async estimateFees() {
    return { ...this.fees };
  }

  async getBalance(address: Address) {
    return this.balances.get(low(address)) ?? 10n ** 21n;
  }

  async sendRawTransaction(raw: Hex): Promise<Hex> {
    if (this.failSends > 0) {
      this.failSends -= 1;
      throw new Error("fetch failed");
    }
    const parsed = parseTransaction(raw);
    if (parsed.chainId !== this.chainId) throw new Error("invalid chain id for signer");
    const from = await recoverTransactionAddress({ serializedTransaction: raw as never });
    const hash = keccak256(raw);
    const nonce = parsed.nonce ?? 0;
    const tx: PendingTx = {
      hash,
      raw,
      from,
      nonce,
      to: parsed.to ?? null,
      data: parsed.data ?? "0x",
      maxFeePerGas: parsed.maxFeePerGas ?? 0n,
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas ?? 0n,
    };
    if (this.minedTxs.has(low(hash)) || [...this.mempool.values()].some((p) => p.hash === hash)) throw new Error("already known");
    if (nonce < (this.head.world.nonces.get(low(from)) ?? 0)) throw new Error("nonce too low");
    const existing = this.mempool.get(this.slot(from, nonce));
    if (existing) {
      const enough = (next: bigint, prev: bigint) => next * 10n >= prev * 11n;
      if (!enough(tx.maxFeePerGas, existing.maxFeePerGas) || !enough(tx.maxPriorityFeePerGas, existing.maxPriorityFeePerGas)) {
        throw new Error("replacement transaction underpriced");
      }
    }
    this.mempool.set(this.slot(from, nonce), tx);
    this.sent.push(hash);
    return hash;
  }

  // ---------------------------------------------------------------- internals

  private minedTxs = new Map<string, PendingTx>();

  private now() {
    return BigInt(Math.floor(Date.now() / 1000));
  }

  private blockHash(number: bigint) {
    return keccak256(toHex(`block:${number}:${this.salt}`));
  }

  private slot(from: string, nonce: number) {
    return `${low(from)}:${nonce}`;
  }

  private blockAt(ref: BlockRef): Block {
    if (ref === "latest") return this.head;
    if (ref === "finalized") return this.blocks[Math.max(0, this.blocks.length - 1 - this.finalityLag)];
    const block = this.blocks[Number(ref)];
    if (!block) throw new Error(`block ${ref} not found`);
    return block;
  }

  private async mineOne() {
    const parent = this.head;
    const number = parent.number + 1n;
    const timestamp = this.now() > parent.timestamp ? this.now() : parent.timestamp + 1n;
    const world = structuredClone(parent.world);
    const block: Block = { number, hash: this.blockHash(number), timestamp, world, receipts: [] };
    let included = true;
    while (included) {
      included = false;
      for (const tx of [...this.mempool.values()].sort((a, b) => a.nonce - b.nonce)) {
        const expected = world.nonces.get(low(tx.from)) ?? 0;
        if (tx.nonce !== expected || tx.maxPriorityFeePerGas < this.minPriorityFee) continue;
        this.mempool.delete(this.slot(tx.from, tx.nonce));
        world.nonces.set(low(tx.from), expected + 1);
        await this.include(block, tx);
        included = true;
      }
    }
    // Anything left at a used nonce can never land.
    for (const [key, tx] of this.mempool) if (tx.nonce < (world.nonces.get(low(tx.from)) ?? 0)) this.mempool.delete(key);
    this.blocks.push(block);
  }

  private async include(block: Block, tx: PendingTx) {
    let status: ChainReceipt["status"] = "success";
    let events: Array<Emitted> = [];
    if (tx.to && low(tx.to) === low(this.registry)) {
      const scratch = structuredClone(block.world.registry);
      const result = await this.execute(scratch, tx.from, tx.data, block.timestamp);
      if (result.ok) {
        block.world.registry = scratch;
        events = result.events;
      } else {
        status = "reverted";
      }
    }
    const logs = events.map((event, index) => this.log(event, block, tx.hash, index));
    block.receipts.push({ transactionHash: tx.hash, status, blockNumber: block.number, blockHash: block.hash, logs });
    this.minedTxs.set(low(tx.hash), tx);
  }

  private log(event: Emitted, block: Block, transactionHash: Hex, logIndex: number): Log {
    const abiEvent = registryAbi.find((item) => item.type === "event" && item.name === event.eventName) as {
      inputs: ReadonlyArray<{ name: string; type: string; indexed?: boolean }>;
    };
    const topics = encodeEventTopics({ abi: registryAbi, eventName: event.eventName, args: event.args } as never) as Array<Hex>;
    const plain = abiEvent.inputs.filter((input) => !input.indexed);
    const data = encodeAbiParameters(plain, plain.map((input) => event.args[input.name]));
    return {
      address: this.registry,
      topics: topics as [Hex, ...Array<Hex>],
      data,
      blockHash: block.hash,
      blockNumber: block.number,
      logIndex,
      transactionHash,
      transactionIndex: 0,
      removed: false,
    };
  }

  private async simulate(request: CallRequest, block: Block, timestamp: bigint): Promise<CallResult> {
    if (low(request.to) !== low(this.registry)) return { ok: true, data: "0x" };
    const view = this.view(block.world.registry, request.data, timestamp);
    if (view) return { ok: true, data: view };
    const result = await this.execute(structuredClone(block.world.registry), request.from, request.data, timestamp);
    if (result.ok) return { ok: true, data: "0x" };
    return { ok: false, revertData: encodeErrorResult({ abi: registryAbi, errorName: result.error }), message: `execution reverted: ${result.error}` };
  }

  private view(registry: Registry, data: Hex, timestamp: bigint): Hex | null {
    const { functionName, args = [] } = decodeFunctionData({ abi: registryAbi, data });
    const a = args as ReadonlyArray<unknown>;
    const result = (value: unknown) => encodeFunctionResult({ abi: registryAbi, functionName, result: value } as never);
    switch (functionName) {
      case "isRelayer":
        return result(registry.relayers.has(low(a[0] as string)));
      case "admin":
        return result(registry.admin);
      case "getWork": {
        const work = registry.works.get(low(a[0] as string));
        return result(
          work ?? { creator: ZERO_ADDRESS, family: 0n, expression: 0, kind: 0, registeredAt: 0n, parentId: ZERO32, contentHash: ZERO32, uriHash: ZERO32 },
        );
      }
      case "isRegistered":
        return result(registry.works.has(low(a[0] as string)));
      case "backOrdinal":
        return result(registry.backOrdinal.get(`${low(a[0] as string)}:${low(a[1] as string)}`) ?? 0n);
      case "backerCount":
        return result(registry.backerCount.get(low(a[0] as string)) ?? 0n);
      case "amendmentCount":
        return result(registry.amendmentCount.get(low(a[0] as string)) ?? 0n);
      case "economicConfigHash":
        return result(registry.configHash.get(String(a[0])) ?? ZERO32);
      case "latestEconomicConfigVersion":
        return result(registry.latestConfig);
      case "currentWeek":
        return result((timestamp - BigInt(REGISTRY_EPOCH_SECONDS)) / WEEK_SECONDS);
      default:
        return null;
    }
  }

  /** The registry's write functions, mutating `registry` (the caller discards it on revert). */
  private async execute(registry: Registry, sender: Address, data: Hex, timestamp: bigint): Promise<Exec> {
    try {
      const { functionName, args = [] } = decodeFunctionData({ abi: registryAbi, data });
      const a = args as ReadonlyArray<unknown>;
      const domain = registryDomain(this.chainId, this.registry);
      const onlyRelayer = () => {
        if (!registry.relayers.has(low(sender))) throw new Revert("NotRelayer");
      };
      const onlyAdmin = () => {
        if (registry.admin !== low(sender)) throw new Revert("NotAdmin");
      };
      const checkSigner = async (typedData: Parameters<typeof recoverTypedDataSigner>[0], signature: Hex, expected: Address) => {
        if (!isCanonicalSignature(signature)) throw new Revert("InvalidSignature");
        const signer = await recoverTypedDataSigner(typedData, signature).catch(() => ZERO_ADDRESS);
        if (low(signer) !== low(expected)) throw new Revert("InvalidSignature");
      };
      switch (functionName) {
        case "registerWork": {
          onlyRelayer();
          const w = a[0] as Omit<Work, "registeredAt"> & { workId: Hex; deadline: bigint };
          if (timestamp > w.deadline) throw new Revert("SignatureExpired");
          await checkSigner(registerWorkTypedData(domain, w), a[1] as Hex, w.creator);
          const id = low(w.workId);
          if (id === ZERO32) throw new Revert("InvalidWorkId");
          if (registry.works.has(id)) throw new Revert("WorkAlreadyRegistered");
          const family = w.family.toString();
          if (w.kind === 0) {
            if (low(w.parentId) !== ZERO32) throw new Revert("ParentNotAllowed");
            if (w.expression !== 1) throw new Revert("InvalidExpression");
            if (registry.familyUsed.has(family)) throw new Revert("FamilyTaken");
          } else if (w.kind === 1) {
            const parent = registry.works.get(low(w.parentId));
            if (!parent) throw new Revert("ParentNotRegistered");
            if (parent.family !== w.family) throw new Revert("FamilyMismatch");
          } else if (w.kind === 2) {
            if (!registry.works.has(low(w.parentId))) throw new Revert("ParentNotRegistered");
            if (registry.familyUsed.has(family)) throw new Revert("FamilyTaken");
            if (w.expression !== 1) throw new Revert("InvalidExpression");
          } else {
            throw new Revert("InvalidKind");
          }
          const slot = `${family}:${w.expression}`;
          if (registry.workIdAt.has(slot)) throw new Revert("ExpressionTaken");
          registry.works.set(id, {
            creator: w.creator,
            family: w.family,
            expression: w.expression,
            kind: w.kind,
            registeredAt: timestamp,
            parentId: w.parentId,
            contentHash: w.contentHash,
            uriHash: w.uriHash,
          });
          registry.workIdAt.set(slot, w.workId);
          registry.familyUsed.add(family);
          return {
            ok: true,
            events: [
              {
                eventName: "WorkRegistered",
                args: {
                  workId: w.workId,
                  creator: w.creator,
                  parentId: w.parentId,
                  family: w.family,
                  expression: w.expression,
                  kind: w.kind,
                  contentHash: w.contentHash,
                  uriHash: w.uriHash,
                },
              },
            ],
          };
        }
        case "back": {
          onlyRelayer();
          const b = a[0] as { workId: Hex; backer: Address; deadline: bigint };
          if (timestamp > b.deadline) throw new Revert("SignatureExpired");
          await checkSigner(backTypedData(domain, b), a[1] as Hex, b.backer);
          const work = registry.works.get(low(b.workId));
          if (!work) throw new Revert("WorkNotRegistered");
          if (low(work.creator) === low(b.backer)) throw new Revert("SelfBack");
          const key = `${low(b.workId)}:${low(b.backer)}`;
          if (registry.backOrdinal.has(key)) throw new Revert("AlreadyBacked");
          if (timestamp < BigInt(REGISTRY_EPOCH_SECONDS)) throw new Revert("BeforeEpoch");
          const week = (timestamp - BigInt(REGISTRY_EPOCH_SECONDS)) / WEEK_SECONDS;
          const weekKey = `${low(b.backer)}:${week}`;
          const used = registry.weeklyBacks.get(weekKey) ?? 0n;
          if (used >= 3n) throw new Revert("WeeklyBackLimit");
          registry.weeklyBacks.set(weekKey, used + 1n);
          const ordinal = (registry.backerCount.get(low(b.workId)) ?? 0n) + 1n;
          registry.backerCount.set(low(b.workId), ordinal);
          registry.backOrdinal.set(key, ordinal);
          return { ok: true, events: [{ eventName: "Backed", args: { workId: b.workId, backer: b.backer, ordinal, week } }] };
        }
        case "amendLineage": {
          onlyAdmin();
          const [workId, newParentId, newKind, reasonHash, sequence] = a as [Hex, Hex, number, Hex, bigint];
          const work = registry.works.get(low(workId));
          if (!work) throw new Revert("WorkNotRegistered");
          const count = registry.amendmentCount.get(low(workId)) ?? 0n;
          if (sequence !== count + 1n) throw new Revert("InvalidSequence");
          if (newKind > 2) throw new Revert("InvalidKind");
          if (newKind !== work.kind && !((work.kind === 0 && newKind === 2) || (work.kind === 2 && newKind === 0))) {
            throw new Revert("KindChangeNotAllowed");
          }
          if (newKind === 0) {
            if (low(newParentId) !== ZERO32) throw new Revert("ParentNotAllowed");
          } else {
            if (low(newParentId) === low(workId)) throw new Revert("LineageCycle");
            const parent = registry.works.get(low(newParentId));
            if (!parent) throw new Revert("ParentNotRegistered");
            if (newKind === 2 ? parent.family === work.family : parent.family !== work.family) throw new Revert("FamilyMismatch");
            let cursor = parent.parentId;
            for (let hops = 0; low(cursor) !== ZERO32; hops += 1) {
              if (hops >= 64) throw new Revert("LineageTooDeep");
              if (low(cursor) === low(workId)) throw new Revert("LineageCycle");
              cursor = registry.works.get(low(cursor))?.parentId ?? ZERO32;
            }
          }
          registry.amendmentCount.set(low(workId), sequence);
          work.kind = newKind;
          work.parentId = newParentId;
          return { ok: true, events: [{ eventName: "LineageAmended", args: { workId, newParentId, newKind, reasonHash, sequence } }] };
        }
        case "registerEconomicConfig": {
          onlyAdmin();
          const [version, configHash] = a as [bigint, Hex];
          if (version !== registry.latestConfig + 1n) throw new Revert("InvalidConfigVersion");
          if (low(configHash) === ZERO32) throw new Revert("InvalidConfigHash");
          registry.configHash.set(version.toString(), configHash);
          registry.latestConfig = version;
          return { ok: true, events: [{ eventName: "EconomicConfigRegistered", args: { version, configHash } }] };
        }
        default:
          throw new Error(`The fake registry has no ${functionName}.`);
      }
    } catch (error) {
      if (error instanceof Revert) return { ok: false, error: error.error };
      throw error;
    }
  }
}
