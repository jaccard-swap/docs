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

This is achieved through **[MinHash](/docs/minhash)**—a locality-sensitive hashing technique that compresses arbitrary metadata into a compact `bytes32[5]` signature while preserving similarity relationships. (See [How MinHash Works](/docs/minhash) for the algorithm details, or [Deep Dive](/docs/deep-dive) for dimensionality considerations.)

### The Breakthrough

The key innovation is embedding similarity checks inside EIP-712 signed intents:

```solidity
struct Bid {
    bytes4 salt;
    uint256 deadline;
    bytes32[5] targetMinHash;  // Desired traits as MinHash
    uint8 minMatches;          // Similarity threshold (2-5 bands)
    ERC20PermitData permit;    // Payment authorization
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
│   │ age:ancient     │              │ form:tablet     │          │
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
│   │ [0x3a2...][5]   │              │ [0x3a2...][5]   │          │
│   │ minMatches: 3   │              │                 │          │
│   └────────┬────────┘              └────────┬────────┘          │
│            │                                │                   │
│            └────────────┬───────────────────┘                   │
│                         │                                       │
│                         ▼                                       │
│              ┌─────────────────────┐                            │
│              │   ONCHAIN MATCH     │                            │
│              │                     │                            │
│              │ countMatches() ≥ 3? │                            │
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
| **Configurable Tolerance** | 2/5 to 5/5 similarity thresholds |

## Example Application: Relic Safari

Jaccard Swap powers **Relic Safari**—a collectible trading game where players excavate, trade, and upgrade ancient artifacts.

- **Excavate** artifacts with random traits (rarity, material, age, form, site, inscription)
- **Trade** using similarity-based bids ("I want any legendary orichalcum artifact")
- **Upgrade** via polymerization—fuse two similar artifacts to level up traits

The game demonstrates the power of semi-fungible trading: players express preferences as trait combinations, and the market matches them automatically.

## Documentation

- [How MinHash Works](/docs/minhash) — the algorithm behind similarity estimation
- [The Breakthrough](/docs/breakthrough) — onchain similarity in signed intents
- [Smart Contract](/docs/contract) — JaccardSwap.sol reference
- [Relic Safari](/docs/relic-safari) — the example application
- [Deep Dive](/docs/deep-dive) — dimensionality, protocolization, and advanced topics
