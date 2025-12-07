---
sidebar_position: 2
---

# How MinHash Works

MinHash is a **locality-sensitive hashing** (LSH) technique for estimating set similarity. It's the cryptographic primitive that makes Jaccard Swap possible.

## The Jaccard Index

The **Jaccard similarity** between two sets $A$ and $B$ measures their overlap:

$$
J(A,B) = \frac{|A \cap B|}{|A \cup B|}
$$

| Relationship | Jaccard |
|--------------|---------|
| Identical sets | 1.0 |
| 50% overlap | 0.5 |
| Completely different | 0.0 |

**Problem**: Computing this directly onchain requires storing and comparing full metadata sets—prohibitively expensive.

## MinHash: Compact Fingerprints

MinHash approximates Jaccard similarity using compact signatures. The key insight:

> **If you hash all elements of two sets with the same hash function, the probability that both sets have the same minimum hash equals their Jaccard similarity.**

$$
P(\min(h(A)) = \min(h(B))) = J(A,B)
$$

By using $k$ different hash functions, we get $k$ independent estimates:

$$
\hat{J}(A,B) = \frac{\text{matching minimums}}{k}
$$

## Implementation

From `@shared/constants`:

```typescript
export const MINHASH_SEEDS = [
  '0x0000000000000000000000000000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000000000000000000000000000002',
  '0x0000000000000000000000000000000000000000000000000000000000000003',
  '0x0000000000000000000000000000000000000000000000000000000000000004',
  '0x0000000000000000000000000000000000000000000000000000000000000005',
] as const

export function computeMinHash(traits: Record<string, string | number>): `0x${string}`[] {
  const features: string[] = []
  
  // Extract key:value features
  for (const [key, value] of Object.entries(traits)) {
    features.push(`${key}:${value}`)
  }
  
  // Hash each feature
  const hashedFeatures = features.map(f => keccak256(toHex(f)))
  
  const signature: `0x${string}`[] = []
  
  // For each seed (band), find minimum hash
  for (let i = 0; i < 5; i++) {
    let minHash = ('0x' + 'f'.repeat(64)) as `0x${string}`  // Start with max
    
    for (const featureHash of hashedFeatures) {
      const h = keccak256(toHex(featureHash + MINHASH_SEEDS[i]))
      if (BigInt(h) < BigInt(minHash)) {
        minHash = h
      }
    }
    
    signature.push(minHash)
  }
  
  return signature
}
```

## Visual Walkthrough

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MINHASH COMPUTATION                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  INPUT: NFT Metadata                                                        │
│  ┌─────────────────────────────────────────┐                                │
│  │ { rarity: 'legendary',                  │                                │
│  │   material: 'gold',                     │                                │
│  │   age: 'antediluvian',                  │                                │
│  │   form: 'idol' }                        │                                │
│  └─────────────────────────────────────────┘                                │
│                     │                                                       │
│                     ▼                                                       │
│  STEP 1: Extract Features (key:value pairs)                                 │
│  ┌─────────────────────────────────────────┐                                │
│  │ "rarity:legendary"                      │                                │
│  │ "material:gold"                         │                                │
│  │ "age:antediluvian"                      │                                │
│  │ "form:idol"                             │                                │
│  └─────────────────────────────────────────┘                                │
│                     │                                                       │
│                     ▼                                                       │
│  STEP 2: Hash Each Feature                                                  │
│  ┌─────────────────────────────────────────┐                                │
│  │ keccak256("rarity:legendary") → 0xa3f...│                                │
│  │ keccak256("material:gold")    → 0x7e1...│                                │
│  │ keccak256("age:antediluvian") → 0x2bc...│                                │
│  │ keccak256("form:idol")        → 0x9d4...│                                │
│  └─────────────────────────────────────────┘                                │
│                     │                                                       │
│                     ▼                                                       │
│  STEP 3: For Each Seed, Find Minimum                                        │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ SEED[0]: hash each feature with seed → take min → band[0]       │        │
│  │ SEED[1]: hash each feature with seed → take min → band[1]       │        │
│  │ SEED[2]: hash each feature with seed → take min → band[2]       │        │
│  │ SEED[3]: hash each feature with seed → take min → band[3]       │        │
│  │ SEED[4]: hash each feature with seed → take min → band[4]       │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                     │                                                       │
│                     ▼                                                       │
│  OUTPUT: MinHash Signature (bytes32[5])                                     │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ [0x3a2f1e..., 0x8c7b3d..., 0x1f9e2a..., 0x5d4c6b..., 0x9a8f7e...]│        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Comparing Signatures

```typescript
export function countMinHashMatches(a: string[], b: string[]): number {
  let matches = 0
  for (let i = 0; i < 5; i++) {
    if (a[i].toLowerCase() === b[i].toLowerCase()) matches++
  }
  return matches
}
```

This is **O(k)**—extremely efficient for onchain execution.

## Why 5 Bands?

The number of hash functions (bands) is a tradeoff:

| Bands | Storage | 95% CI Width | Use Case |
|-------|---------|--------------|----------|
| 1 | 32 bytes | ±100% | Rough filtering |
| **5** | **160 bytes** | **±45%** | **Practical onchain** |
| 10 | 320 bytes | ±32% | High-value matching |
| 100 | 3.2 KB | ±10% | Off-chain analytics |

**How to verify**: Standard error $\sigma = \sqrt{\frac{J(1-J)}{k}}$. At worst-case $J=0.5$:

$$
\sigma = \sqrt{\frac{0.25}{k}} = \frac{0.5}{\sqrt{k}}
$$

The 95% CI is approximately $\pm 2\sigma$, so for $k=5$: $2 \times \frac{0.5}{\sqrt{5}} \approx 0.45 = 45\%$

Five bands provide reasonable accuracy while keeping gas costs manageable.

## The LSH Property

MinHash is **locality-sensitive**: similar inputs produce similar outputs with high probability.

```
NFT A: { rarity: legendary, material: gold, age: antediluvian }
NFT B: { rarity: legendary, material: gold, age: bronze age }
NFT C: { rarity: common, material: clay, form: vessel }

MinHash(A) vs MinHash(B): ~3-4 bands match (share 2/3 traits)
MinHash(A) vs MinHash(C): ~0-1 bands match (no shared traits)
```

Unlike cryptographic hashes (where any change produces completely different output), MinHash preserves the similarity relationship.

## Feature Design Matters

:::warning No Numeric Magnitude
MinHash compares **exact strings**. There is no concept of "closeness" for numbers—`"19"` and `"20"` are as different as `"19"` and `"9999"`.
:::

### The Problem with Raw Numbers

```typescript
// ✗ BAD: Numbers are compared as strings
{ attack: 100, defense: 95, hp: 200 }

// Feature strings become:
// "attack:100", "defense:95", "hp:200"

// NFT A: attack:100  vs  NFT B: attack:101
// These are COMPLETELY DIFFERENT strings → 0 similarity contribution
// Even though 100 and 101 are "close" numerically!
```

MinHash treats each `key:value` as an opaque string. The hash of `"attack:100"` has no relationship to `"attack:101"`:

```
keccak256("attack:100") → 0x7a3f...  (some hash)
keccak256("attack:101") → 0x2bc9...  (completely different hash)
keccak256("attack:999") → 0x8e1d...  (equally different!)
```

### The Solution: Categorical Buckets

```typescript
// ✓ GOOD: Bin numbers into meaningful categories
{ attack_tier: 'high', defense_tier: 'high', hp_tier: 'high' }

// Now NFTs with attack 95-105 all share "attack_tier:high"
// → Same string → Same hash → Contributes to similarity!
```

### Why Jaccard Swap Uses Trait Pools

Relic Safari uses **categorical trait pools** by design:

| Trait | Values | Type |
|-------|--------|------|
| rarity | common, uncommon, rare, epic, legendary | Ordinal ⚠️ |
| quality | fragmented, worn, intact, pristine, immaculate | Ordinal ⚠️ |
| inscription | unmarked, faded, partial, legible, glowing | Ordinal ⚠️ |
| material | clay, bone, bronze, iron, silver, gold, orichalcum | Nominal |
| age | neolithic, bronze age, iron age, classical, medieval | Nominal |
| site | sunken-temple, desert-tomb, mountain-shrine | Nominal |
| form | tablet, idol, vessel, amulet, blade, scepter, mask | Nominal |

:::caution The Ordinal Trap
For **ordinal traits** (rarity, quality, inscription), MinHash only knows if values match or not:

- `"common" ≠ "uncommon"` ✓ MinHash knows they're different
- `"common" ≠ "legendary"` ✓ MinHash knows they're different
- **But**: MinHash does NOT know that `"uncommon"` is *closer to* `"common"` than `"legendary"` is

To MinHash, the "distance" between any two different values is identical:

```
distance(common, uncommon)  = 1  (different strings)
distance(common, legendary) = 1  (different strings)  ← Same!
```

**What this means for bidders**: A standing bid for `rarity:rare` will match `rare` artifacts exactly, but will NOT "partially match" `epic` or `uncommon` artifacts. They're equally non-matching.

**For nominal traits** (material, site, form), this is fine—there's no inherent ordering between "gold" and "bronze" anyway.
:::

Two "legendary gold idols" share exact strings and produce high similarity. But a "rare" artifact is no more similar to an "epic" artifact than to a "common" one—MinHash sees only "same" or "different".

:::note Future Work
For domains requiring raw numeric values, see [Typed MinHash Protocol](./deep-dive#typed-minhash-protocol)—an EIP-712-inspired approach to bucketizing Solidity datatypes.
:::

## Mathematical Foundation

### Why Does This Work?

Consider two sets $A$ and $B$ with Jaccard similarity $J(A,B)$.

When we apply a random hash function $h$ and look at the minimum:
- If the minimum comes from $A \cap B$ (shared elements): both sets have the same min
- If the minimum comes from $A \setminus B$ or $B \setminus A$ (unique elements): different mins

$$
P(\text{same minimum}) = \frac{|A \cap B|}{|A \cup B|} = J(A,B)
$$

### Error Bounds

For $k$ hash functions and true Jaccard $J$:

$$
\hat{J} \sim \frac{\text{Binomial}(k, J)}{k}
$$

Standard error: $\sigma = \sqrt{\frac{J(1-J)}{k}}$

With $k=5$ and $J=0.6$:
- $\sigma \approx 0.22$
- 95% CI: $[0.16, 1.0]$

This variance is acceptable for threshold-based matching (e.g., "≥3/5 bands").

## Next Steps

- [The Breakthrough](./breakthrough) — using MinHash in signed intents
- [Deep Dive](./deep-dive) — advanced topics and future extensions
