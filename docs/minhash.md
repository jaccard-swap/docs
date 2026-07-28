---
sidebar_position: 2
---

# How MinHash Works

MinHash is the cryptographic primitive that makes Jaccard Swap possible. Here's what it actually needs to do: turn a pile of trait strings into a short, fixed-size fingerprint such that two fingerprints that share more values came from two artifacts that share more traits. That's it. Everything below is either implementation detail or "here's why that works," in roughly that order of importance.

## The feel, before the formula

Every artifact gets a signature made of 20 short values—**bands**. Two artifacts that share more traits end up with more matching bands. An artifact standing bid says "match anything with at least N of my 20 bands"—turn the dial up for a tight, near-exact match, or down for a loose "something in this neighborhood" search.

That's the entire mental model a player needs. You don't need to know *why* shared traits produce shared bands to use it correctly—you just need to believe that "more bands match" reliably means "more similar," and it does. If you're the kind of person who wants to know why, the rest of this page is for you. If you're not, [The Breakthrough](./breakthrough) picks up from here and shows how this gets used in a signed bid.

:::note An honest note on precision
The 20-band choice was made for gas cost and UX feel—not by solving for a
target statistical guarantee. The math below explains *why* more bands
means better resolution, and gives you a way to reason about it, but treat
it as illustrative rather than a spec the game was tuned against. Nothing
in Relic Safari's design depends on the confidence intervals below being
exactly right; it depends on players feeling like matches make sense, which
so far, they do.
:::

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

Relic Safari uses $k = 20$.

## Implementation

From `@shared/constants` (the actual current source, not a simplified example):

```typescript
export const MINHASH_BANDS = 20

// Length is derived from MINHASH_BANDS so the two can never silently drift
// apart - a prior version hardcoded the band count separately from
// seeds.length, which made every band past the seed array's end a
// duplicate, non-independent hash instead of adding real accuracy.
export const MINHASH_SEEDS: readonly `0x${string}`[] = Array.from(
  { length: MINHASH_BANDS },
  (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}` as `0x${string}`
)

function truncateToBytes8(hash: `0x${string}`): `0x${string}` {
  return ('0x' + hash.slice(-16)) as `0x${string}`
}

export function computeMinHash(traits: Record<string, string | number>): `0x${string}`[] {
  const features = Object.entries(traits)
    .filter(([key]) => key !== 'name' && key !== 'image' && key !== 'description')
    .map(([key, value]) => `${key}:${value}`)

  const hashedFeatures = features.map(f => keccak256(toHex(f)))
  const signature: `0x${string}`[] = []

  for (let i = 0; i < MINHASH_BANDS; i++) {
    // Full bytes32 width for the running min-comparison (more entropy for a
    // fair minimum); only the winning value gets truncated below.
    let minHash = ('0x' + 'f'.repeat(64)) as `0x${string}`

    for (const featureHash of hashedFeatures) {
      const h = keccak256(toHex(featureHash + MINHASH_SEEDS[i]))
      if (BigInt(h) < BigInt(minHash)) minHash = h
    }

    signature.push(truncateToBytes8(minHash))
  }

  return signature
}
```

Two things worth noticing versus a textbook implementation: the running minimum is computed at full 256-bit width (so the "which one is smaller" comparison has plenty of entropy to work with) and only the *winner* gets truncated down to its low 8 bytes before being stored. That truncation is what keeps 20 bands affordable—see [Why 20 Bands](#why-20-bands) below.

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
│  STEP 3: For Each Seed, Find Minimum (× 20 bands, not 4 shown)              │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ SEED[0]:  hash each feature with seed → take min → band[0]      │        │
│  │ SEED[1]:  hash each feature with seed → take min → band[1]      │        │
│  │ SEED[2]:  hash each feature with seed → take min → band[2]      │        │
│  │   ...                                                            │        │
│  │ SEED[19]: hash each feature with seed → take min → band[19]     │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                     │                                                       │
│                     ▼                                                       │
│  OUTPUT: MinHash Signature (bytes8[20], 160 bytes total)                    │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │ [0x3a2f1e..., 0x8c7b3d..., 0x1f9e2a..., ... 17 more bands]       │        │
│  └─────────────────────────────────────────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Comparing Signatures

```typescript
export function countMinHashMatches(a: string[], b: string[]): number {
  if (a.length !== MINHASH_BANDS || b.length !== MINHASH_BANDS) return 0
  let matches = 0
  for (let i = 0; i < MINHASH_BANDS; i++) {
    if (a[i].toLowerCase() === b[i].toLowerCase()) matches++
  }
  return matches
}
```

This is **O(k)**—extremely efficient for onchain execution, whether k is 5 or 20.

## Why 20 Bands

The number of hash functions (bands) is a tradeoff between resolution and storage. Relic Safari actually shipped two different band counts over its life: an earlier version used `bytes32[5]` (5 bands at 32 bytes each), and the current version uses `bytes8[20]` (20 bands at 8 bytes each). Because `bytes8[20]` tight-packs 4 elements per EVM storage slot with zero padding, it fits in exactly **5 storage slots**—the same number of slots the old `bytes32[5]` layout used for only 5 hash functions. Truncating each band's hash down to its low 8 bytes is what paid for 4x the resolution at the same onchain storage cost—see the [Compact MinHash](./deep-dive#compact-minhash) section in the Deep Dive for why that truncation doesn't meaningfully weaken the fingerprint.

| Bands (k) | Storage | Illustrative 95% CI width* | Use Case |
|-----------|---------|-----------------------------|----------|
| 1 | 8 bytes | ±100% | Rough filtering |
| 5 | 40 bytes | ±45% | Earlier version |
| **20** | **160 bytes** | **±22%** | **Current** |
| 100 | 800 bytes | ±10% | Off-chain analytics |

*How to derive this yourself*: standard error $\sigma = \sqrt{\frac{J(1-J)}{k}}$, worst case at $J=0.5$. The 95% CI is approximately $\pm 2\sigma$, so for $k=20$: $2 \times \sqrt{\frac{0.25}{20}} \approx 0.224 = 22\%$.

Treat that column as "roughly how noisy a single estimate is," not a promise. In practice, players don't experience "22% noise"—they experience "artifacts that share a lot of traits usually clear my threshold, artifacts that share none usually don't," which is the thing that actually matters.

## The LSH Property

MinHash is **locality-sensitive**: similar inputs produce similar outputs with high probability.

```
NFT A: { rarity: legendary, material: gold, age: antediluvian }
NFT B: { rarity: legendary, material: gold, age: bronze age }
NFT C: { rarity: common, material: clay, form: vessel }

MinHash(A) vs MinHash(B): most bands match (share 2/3 traits)
MinHash(A) vs MinHash(C): few or no bands match (no shared traits)
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

Relic Safari uses **categorical trait pools** by design—the current 7 traits, exactly as defined in `@shared/constants`'s `TRAIT_POOLS`:

| Trait | Values | Type |
|-------|--------|------|
| rarity | common, uncommon, rare, epic, legendary | Ordinal ⚠️ (upgradeable) |
| quality | fragmented, worn, intact, pristine, immaculate | Ordinal ⚠️ (upgradeable) |
| inscription | unmarked, faded, partial, legible, glowing | Ordinal ⚠️ (upgradeable) |
| material | clay, bone, bronze, iron, silver, jade, obsidian, gold, orichalcum | Nominal |
| age | neolithic, bronze age, iron age, classical era, medieval era, antediluvian | Nominal |
| form | tablet, idol, vessel, amulet, blade, scepter, mask | Nominal |
| site | sunken-temple, desert-tomb, mountain-shrine, forest-barrow, volcanic-forge, frozen-vault, coastal-ruins | Nominal |

:::caution The Ordinal Trap
For the three **ordinal, upgradeable traits** (rarity, quality, inscription), MinHash only knows if values match or not:

- `"common" ≠ "uncommon"` ✓ MinHash knows they're different
- `"common" ≠ "legendary"` ✓ MinHash knows they're different
- **But**: MinHash does NOT know that `"uncommon"` is *closer to* `"common"` than `"legendary"` is

To MinHash, the "distance" between any two different values is identical:

```
distance(common, uncommon)  = 1  (different strings)
distance(common, legendary) = 1  (different strings)  ← Same!
```

**What this means for bidders**: a standing bid for `rarity:rare` will match `rare` artifacts exactly, but will NOT "partially match" `epic` or `uncommon` artifacts. They're equally non-matching.

**For nominal traits** (material, age, form, site), this is a non-issue—there's no inherent ordering between "gold" and "bronze" anyway.
:::

Two "legendary gold idols" share exact strings and produce high similarity. But a "rare" artifact is no more similar to an "epic" artifact than to a "common" one—MinHash sees only "same" or "different".

:::note Future Work
For domains requiring raw numeric values, see [Typed MinHash Protocol](./deep-dive#typed-minhash-protocol)—an EIP-712-inspired approach to bucketizing Solidity datatypes.
:::

## Mathematical Foundation

This section is exactly what the note at the top warned you about—here for completeness, not because Relic Safari's thresholds were derived from it.

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

With $k=20$ and $J=0.6$:
- $\sigma \approx 0.11$
- 95% CI: $[0.38, 0.82]$

That interval is wide enough that nobody should read a single match count as a precise similarity score—which is exactly why Jaccard Swap only ever uses MinHash for **threshold matching** ("at least $N$ bands"), never for ranking or precise scoring. Threshold-based matching is far more robust to this variance than point estimates would be.

## Next Steps

- [The Breakthrough](./breakthrough) — using MinHash in signed intents
- [Deep Dive](./deep-dive) — advanced topics and future extensions
