---
sidebar_position: 1
---

# Jaccard Swap

**Onchain similarity matching for semi-fungible markets.**

## The Problem: Liquidity Fragmentation

NFT markets suffer from a fundamental liquidity problem. Each token is unique, requiring exact matching between buyers and sellers. A buyer searching for "any legendary fire creature" must manually browse thousands of listings. A seller with a rare artifact waits indefinitely for the one buyer who wants *exactly* that token.

Traditional solutions involve centralized matching services or AI-powered recommendations—but these require trust. We want **trustless similarity matching** directly in smart contracts.

## The Solution: MinHash Intent Matching

Jaccard Swap introduces **similarity-based intents** to onchain trading:

```
Instead of: "I want to buy token #12345"
You say:    "I want to buy any NFT with ≥60% similarity to this trait set"
```

This is achieved through **[MinHash](./minhash)**—a locality-sensitive hashing technique that compresses arbitrary metadata into a compact `bytes8[20]` signature while preserving similarity relationships. (See [How MinHash Works](./minhash) for the algorithm details—and for how much of that math you actually need to care about—or [Deep Dive](./deep-dive) for dimensionality considerations.)

### The Breakthrough

The key innovation is embedding similarity checks inside EIP-712 signed intents:

```solidity
struct Bid {
    bytes4 salt;
    uint256 deadline;
    bytes8[20] targetMinHash; // Desired traits as MinHash
    uint8 minMatches;         // Similarity threshold (2-20 bands)
    ERC20PermitData permit;   // Payment authorization
}
```

A bid becomes a **standing order** that matches any NFT meeting the similarity threshold. One signature can fulfill many auctions.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        JACCARD SWAP                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   BIDDER                           AUCTIONEER                   │
│   ┌─────────────────┐              ┌─────────────────┐          │
│   │ Desired Traits  │              │  NFT Metadata   │          │
│   │ rarity:legendary│              │ rarity:legendary│          │
│   │ material:gold   │              │ material:gold   │          │
│   │ age:antediluvian│              │ form:tablet     │          │
│   └────────┬────────┘              └────────┬────────┘          │
│            │                                │                   │
│            ▼                                ▼                   │
│   ┌─────────────────┐              ┌─────────────────┐          │
│   │ computeMinHash()│              │ computeMinHash()│          │
│   └────────┬────────┘              └────────┬────────┘          │
│            │                                │                   │
│            ▼                                ▼                   │
│   ┌─────────────────┐              ┌─────────────────┐          │
│   │ targetMinHash   │              │   nftMinHash    │          │
│   │ [0x3a2...][20]  │              │ [0x3a2...][20]  │          │
│   │ minMatches: 8   │              │                 │          │
│   └────────┬────────┘              └────────┬────────┘          │
│            │                                │                   │
│            └────────────┬───────────────────┘                   │
│                         │                                       │
│                         ▼                                       │
│              ┌─────────────────────┐                            │
│              │   ONCHAIN MATCH     │                            │
│              │                     │                            │
│              │ countMatches() ≥ 8? │                            │
│              │      ✓ SETTLE       │                            │
│              └─────────────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

1. **Bidder** specifies desired traits, computes MinHash, signs a bid with tolerance
2. **Auctioneer** lists an NFT with its MinHash stored onchain
3. **Contract** compares MinHashes band-by-band, settles if threshold met

## Key Properties

| Property | Description |
|----------|-------------|
| **Gasless Bids** | EIP-712 signatures + ERC20 Permit—no approval transactions |
| **Standing Orders** | One bid can match multiple auctions |
| **Trustless Matching** | Similarity computed entirely onchain |
| **Graceful Degradation** | Falls back to next-highest bid on permit failure |
| **Configurable Tolerance** | 2/20 to 20/20 similarity thresholds |

:::note Design philosophy
20 bands wasn't chosen by solving for a target statistical confidence—it's a
gas/UX tradeoff that happened to also feel right when watching real matches
happen. See [How MinHash Works](./minhash) for more on that distinction; the
math is there for the curious, but it isn't the thing the system was tuned
against.
:::

## Example Application: Relic Safari

Jaccard Swap powers **Relic Safari**—a collectible trading game built around one loop: earn Leaderboard points by assembling matched sets of artifacts and freezing them into soulbound badges.

- **Excavate** artifacts with random traits (rarity, quality, inscription, age, material, form, site)
- **Trade** in the Bazaar using similarity-based bids ("I want any legendary orichalcum artifact"), or swap currencies directly in the Exchange
- **Upgrade** two ways: fuse two similar artifacts via Polymerase (free trait levels on match, Essence from the rest), or spend Essence directly via Forge for a guaranteed single-trait upgrade
- **Collect** in the Museum: assemble one fully-upgraded artifact for every Form sharing a Site+Age+Material, then freeze the set into a permanent badge for Leaderboard points

The game demonstrates the power of semi-fungible trading: players express preferences as trait combinations, and the market matches them automatically—while the Museum gives the whole loop a destination beyond "keep digging."

## Documentation

- [How MinHash Works](./minhash) — the algorithm behind similarity estimation
- [The Breakthrough](./breakthrough) — onchain similarity in signed intents
- [Smart Contract](./contract) — the JaccardDiamond reference
- [Relic Safari](./relic-safari) — the example application
- [Deep Dive](./deep-dive) — dimensionality, protocolization, and advanced topics
