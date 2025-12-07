---
sidebar_position: 7
---

# Deep Dive

Advanced topics on MinHash dimensionality, protocolization, and optimization strategies.

## Dimensionality Considerations

### The k × s Tradeoff

MinHash signatures are defined by two parameters:

- **k** = number of bands (hashes)
- **s** = bits per hash (bytes32 = 256 bits)

**Current Implementation**: k=5, s=256

```
Storage per NFT: 5 × 32 bytes = 160 bytes
```

### Finding Optimal k

The number of bands affects both **accuracy** and **discriminating power**:

$$
\text{Estimation Error} = \sqrt{\frac{J(1-J)}{k}}
$$

| k | Storage | Error (J=0.5) | Use Case |
|---|---------|---------------|----------|
| 1 | 32B | 50% | Coarse filtering |
| 5 | 160B | 22% | General trading |
| 10 | 320B | 16% | High-value items |
| 25 | 800B | 10% | Analytics |
| 100 | 3.2KB | 5% | Off-chain only |

For onchain use, k=5 balances gas costs with acceptable accuracy.

### Unique Mapping

An interesting property emerges with sufficient k: MinHashes become **unique identifiers**.

Given $n$ NFTs with distinct trait sets, there exists a minimum $k^*$ such that all MinHashes are unique:

$$
k^* = \min \{ k : \forall i \neq j, \text{MinHash}_k(F_i) \neq \text{MinHash}_k(F_j) \}
$$

**Empirical Approach**:

```typescript
function findMinimumK(collection: NFTMetadata[]): number {
  for (let k = 1; k <= 256; k++) {
    const hashes = new Set<string>()
    let collision = false
    
    for (const nft of collection) {
      const hash = computeMinHash(nft, k).join('')
      if (hashes.has(hash)) {
        collision = true
        break
      }
      hashes.add(hash)
    }
    
    if (!collision) return k
  }
  throw new Error('Collection has duplicate metadata')
}
```

### O(1) Lookup

With unique MinHashes, build an onchain index:

```solidity
// MinHash signature → tokenId
mapping(bytes32 => uint256) public minHashIndex;

function mint(..., bytes32[5] calldata minHash) public {
    bytes32 key = keccak256(abi.encodePacked(minHash));
    require(minHashIndex[key] == 0, "MinHash collision");
    minHashIndex[key] = id;
    // ...
}

function getTokenByMinHash(bytes32[5] calldata minHash) 
    public view returns (uint256) 
{
    bytes32 key = keccak256(abi.encodePacked(minHash));
    return minHashIndex[key];
}
```

Now: compute MinHash from metadata off-chain → query token directly (O(1)).

### Dual Signatures

Use two MinHashes per token:

```solidity
struct TokenData {
    bytes32[5] similarityHash;  // For Jaccard matching (k=5)
    bytes32 uniqueHash;         // For O(1) lookup (compressed larger k)
}
```

## Protocolization

### The Standard Schema Problem

For cross-collection trading, collections must agree on:

1. **Feature schema**: How traits map to `key:value` pairs
2. **Hash parameters**: Seeds, k value, hash function
3. **Extraction rules**: Which metadata fields to include

**Without standardization**, two collections describing the same concept differently will have zero similarity:

```
Collection A: { type: 'fire' }
Collection B: { element: 'fire' }
// Different keys → different hashes → no similarity
```

### Schema Registry

On-chain registry for interoperable schemas:

```solidity
contract SchemaRegistry {
    struct Schema {
        string name;           // "gaming-nft-v1"
        string[] requiredKeys; // ["rarity", "element"]
        bytes32[] seeds;       // MINHASH_SEEDS
        uint8 numHashes;       // 5
        string hashFunction;   // "keccak256"
    }
    
    mapping(bytes32 => Schema) public schemas;
    mapping(address => bytes32) public collectionSchema;
    
    function registerSchema(Schema calldata schema) 
        external returns (bytes32 schemaId);
    
    function declareCompliance(bytes32 schemaId) external;
}
```

Collections declare which schema they follow. Traders filter by schema compatibility.

### Minimal Complexity Algorithm

Find the **simplest** MinHash configuration that uniquely identifies all NFTs:

```typescript
interface MinHashConfig {
  seeds: string[]
  numHashes: number
  requiredKeys: string[]
}

function findMinimalConfig(collection: NFTMetadata[]): MinHashConfig {
  const allKeys = new Set<string>()
  for (const nft of collection) {
    for (const key of Object.keys(nft)) {
      allKeys.add(key)
    }
  }
  
  // Start with minimum configuration
  for (let numHashes = 1; numHashes <= 20; numHashes++) {
    for (const keySubset of powerSet([...allKeys])) {
      if (keySubset.length === 0) continue
      
      const config = {
        seeds: MINHASH_SEEDS.slice(0, numHashes),
        numHashes,
        requiredKeys: keySubset,
      }
      
      if (allUnique(collection, config)) {
        return config
      }
    }
  }
  
  throw new Error('Cannot find unique configuration')
}
```

This finds the minimal k and key subset needed for unique identification.

### Compression Strategies

For large k values, compress before storage:

```typescript
// Full MinHash (k=100)
const fullHash = computeMinHash(nft, 100)  // 3.2KB

// Compress: hash the full signature
const compressed = keccak256(abi.encodePacked(fullHash))  // 32 bytes

// Store both
{
  similarityHash: fullHash.slice(0, 5),  // First 5 for trading
  uniqueHash: compressed,                 // Compressed for lookup
}
```

## Seed Selection

### Requirements

Good seeds must:
1. Be deterministic (reproducible across all participants)
2. Produce independent hash functions
3. Be publicly known

### Current Seeds

```typescript
export const MINHASH_SEEDS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000000000000000000000000000004',
  '0x0000000000000000000000000000000000000000000000000000000000000005',
]
```

Simple incrementing seeds work because keccak256 provides sufficient mixing.

### Alternative: Hash-Based Seeds

Generate seeds from a known value:

```typescript
function generateSeeds(domain: string, count: number): string[] {
  const seeds: string[] = []
  for (let i = 0; i < count; i++) {
    seeds.push(keccak256(toHex(`${domain}:seed:${i}`)))
  }
  return seeds
}

// Per-schema seeds
const gamingSeeds = generateSeeds('gaming-nft-v1', 5)
const artSeeds = generateSeeds('art-nft-v1', 5)
```

This allows schema-specific seeds without collision.

## Performance Optimization

### Batch Similarity

Compare one NFT against many bids:

```solidity
function batchCheckSimilarity(
    bytes32[5] memory nftMinHash,
    bytes32[5][] calldata bidMinHashes,
    uint8[] calldata minMatches
) external pure returns (bool[] memory matches) {
    matches = new bool[](bidMinHashes.length);
    for (uint256 i = 0; i < bidMinHashes.length; i++) {
        uint8 count = countMatches(bidMinHashes[i], nftMinHash);
        matches[i] = count >= minMatches[i];
    }
}
```

### Precomputed Lookups

For high-volume collections, precompute similarity buckets:

```typescript
// Off-chain indexing
const buckets: Map<string, Set<string>> = new Map()

for (const nft of collection) {
  const minHash = computeMinHash(nft)
  // Index by each band
  for (let i = 0; i < 5; i++) {
    const key = `band${i}:${minHash[i]}`
    if (!buckets.has(key)) buckets.set(key, new Set())
    buckets.get(key)!.add(nft.id)
  }
}

// Fast similarity search
function findSimilar(targetMinHash: string[], minMatches: number): string[] {
  const candidates = new Map<string, number>()  // id → match count
  
  for (let i = 0; i < 5; i++) {
    const key = `band${i}:${targetMinHash[i]}`
    for (const id of buckets.get(key) || []) {
      candidates.set(id, (candidates.get(id) || 0) + 1)
    }
  }
  
  return [...candidates.entries()]
    .filter(([_, count]) => count >= minMatches)
    .map(([id]) => id)
}
```

This is **O(k × avg bucket size)** instead of **O(n)** for collection-wide search.

## Error Analysis

### False Positive Rate

Probability of $k/5$ matches with true Jaccard $J$:

$$
P(\text{matches} \geq k | J) = \sum_{i=k}^{5} \binom{5}{i} J^i (1-J)^{5-i}
$$

| True J | P(≥2/5) | P(≥3/5) | P(≥4/5) | P(≥5/5) |
|--------|---------|---------|---------|---------|
| 0.1 | 8% | 1% | 0% | 0% |
| 0.2 | 26% | 6% | 1% | 0% |
| 0.3 | 47% | 16% | 3% | 0% |
| 0.4 | 66% | 32% | 9% | 1% |
| 0.5 | 81% | 50% | 19% | 3% |
| 0.6 | 91% | 68% | 34% | 8% |
| 0.7 | 97% | 84% | 53% | 17% |
| 0.8 | 99% | 94% | 74% | 33% |
| 0.9 | 100% | 99% | 92% | 59% |

**Interpretation**: A 3/5 threshold has 16% false positive rate at J=0.3 (acceptable for trading).

### Confidence Intervals

For observed matches $m$ out of $k=5$:

$$
\hat{J} = \frac{m}{5} \pm z_{\alpha/2} \sqrt{\frac{\hat{J}(1-\hat{J})}{5}}
$$

Example: 3/5 matches → Ĵ = 0.6 ± 0.43 (95% CI)

The wide interval reflects k=5's limited precision. Threshold-based matching is more robust than point estimates.

## Future Directions

### Adaptive k

Dynamically adjust k based on collection size:

```typescript
const k = Math.ceil(Math.log2(collectionSize) + 2)
```

Larger collections need more bands to avoid collisions.

### Multi-Schema Matching

Define similarity mappings between schemas:

```
Schema A: { type: 'fire' }
Schema B: { element: 'fire' }

Mapping: A.type ↔ B.element
```

Allow cross-schema trading with schema-aware similarity.

### Proof of Compliance

ZK proofs that NFT metadata matches its MinHash:

```
Prove: computeMinHash(metadata) == stored_minhash
Without revealing: metadata
```

Enables private trading with verified similarity.

### Layer 2 Optimization

Batch similarity checks off-chain, submit only winning bid:

```
1. Compute matches for 1000 bids off-chain
2. Submit only the best matching bid to L1
3. Contract verifies single bid
```

Reduces gas from O(n) to O(1).

### Typed MinHash Protocol

An **EIP-712-inspired protocol** for MinHashing arbitrary Solidity datatypes:

```solidity
// Like EIP-712's typeHash, but for MinHash feature extraction
bytes32 constant PLAYER_STATS_TYPEHASH = keccak256(
    "PlayerStats(uint8 attack_tier,uint8 defense_tier,uint8 speed_tier,string class,string faction)"
);

struct PlayerStats {
    uint8 attack_tier;    // 0-4 (bucketized from raw stats)
    uint8 defense_tier;
    uint8 speed_tier;
    string class;         // "warrior", "mage", "rogue"
    string faction;       // "alliance", "horde"
}
```

**Key ideas**:

1. **Type-safe bucketization**: Define bucket thresholds in the type schema
   ```solidity
   // attack_tier mapping: 0-20→0, 21-40→1, 41-60→2, 61-80→3, 81-100→4
   uint8 attack_tier = uint8(rawAttack / 20);
   ```

2. **Deterministic feature extraction**: Like EIP-712's `encodeData`, define how each field becomes a feature string
   ```
   "attack_tier:3" || "defense_tier:2" || "class:warrior" || "faction:alliance"
   ```

3. **Schema registry**: On-chain registry of type schemas (see [Protocol](./protocol))
   ```solidity
   mapping(bytes32 => TypeSchema) public schemas;
   ```

4. **Ordinal handling**: Schema can declare fields as `ordinal` with explicit bucket boundaries
   ```solidity
   struct FieldSchema {
       string name;
       FieldType fieldType;  // STRING, UINT_BUCKETED, ENUM
       uint256[] buckets;    // For UINT_BUCKETED: [20, 40, 60, 80, 100]
   }
   ```

**Benefits**:
- Numeric values become categorical (solving the ordinal trap)
- Cross-contract interoperability via shared schemas
- Verifiable feature extraction (anyone can recompute)
- Gas-efficient: bucketization happens off-chain, only tiers stored on-chain

**Open questions**:
- How to handle nested structs?
- Dynamic arrays of traits?
- Schema versioning and migration?

This is future work—current Jaccard Swap uses string-based categorical traits.

### Compact MinHash

Current implementation uses `bytes32[5]` (160 bytes) for MinHash signatures. But do we need full `bytes32` per band?

**The key insight**: We check **exact matches per band independently**—we never compare across bands. This means:

1. **Collision resistance is unimportant** — we only need uniform distribution
2. **False positive rate compounds favorably** — even if one band has a collision, it's unlikely all 5 would
3. **Fingerprinting works** — taking the first N bytes of each hash loses nothing meaningful

For 5 independent hashes, the probability that a collision affects the similarity estimate requires collisions in *multiple* bands simultaneously. With `bytes8` fingerprints:

```
P(collision in 1 band) ≈ N²/2^64  (negligible for N < 1M)
P(collision in 3+ bands) ≈ (N²/2^64)³  (astronomically small)
```

**Fingerprinting approach**:

| Fingerprint | Storage | Packed Format | Notes |
|-------------|---------|---------------|-------|
| `bytes8[5]` | 40 bytes | `bytes40` | 5× 8-byte fingerprints |
| `bytes6[5]` | 30 bytes | `bytes30` | Fits in single slot + 1 |
| `bytes4[5]` | 20 bytes | `bytes20` | Fits in single slot |

**Byte concatenation** avoids Solidity struct overhead:

```solidity
// Instead of bytes32[5] (5 slots, 160 bytes)
// Use packed bytes40 (2 slots, 40 bytes)
bytes40 public packedMinHash;

// Or ultra-compact bytes20 (1 slot!)
bytes20 public compactMinHash;

function unpackBand(bytes20 packed, uint8 band) pure returns (bytes4) {
    return bytes4(packed << (band * 32));
}
```

:::caution EVM Precompile Limitations
The EVM only has precompiles for **keccak256**, **RIPEMD-160**, and **SHA-256**—all returning ≥20 bytes. Truncating still requires computing the full hash first, so **no gas savings on computation**, only on storage.
:::

**Practical optimization** (fingerprinting + packing):

```solidity
// Compute full hash, take fingerprint, pack into single slot
function computePackedMinHash(string[] memory features) pure returns (bytes20) {
    bytes20 packed;
    for (uint8 i = 0; i < 5; i++) {
        bytes4 fingerprint = bytes4(keccak256(abi.encodePacked(features[i], SEEDS[i])));
        packed |= bytes20(fingerprint) >> (i * 32);
    }
    return packed;  // 5× 4-byte fingerprints in 20 bytes (1 storage slot!)
}
```

**Summary**: Fingerprinting `bytes32 → bytes4` per band and concatenating into `bytes20` gives **8× storage reduction** (160 → 20 bytes) without meaningful loss of generality for collections under ~100K items.

:::note Example Implementation
For Jaccard Swap, we keep it simple with `bytes32[5]`. The fingerprinting optimization is future work for production deployments where storage costs matter.
:::

## References

- [Broder (1997)](https://en.wikipedia.org/wiki/MinHash) — Original MinHash paper
- [LSH Forest](https://en.wikipedia.org/wiki/Locality-sensitive_hashing) — Advanced LSH techniques
- [EIP-712](https://eips.ethereum.org/EIPS/eip-712) — Typed structured data hashing
- [EIP-2612](https://eips.ethereum.org/EIPS/eip-2612) — ERC20 Permit

## Next Steps

- [Protocol](./protocol) — cross-collection standardization
- [Introduction](./intro) — back to basics

