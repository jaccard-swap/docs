---
sidebar_position: 6
---

# Relic Safari

**Relic Safari** is the example application demonstrating Jaccard Swap. Players excavate, trade, and upgrade ancient artifacts in a market powered by onchain similarity matching.

## Objective

Collect, trade, and upgrade artifacts to solve the mystery of the ancient ruins.

## Learning Goals

Through gameplay, users experience:

1. **Expressing preferences as traits** — "I want legendary gold artifacts"
2. **Understanding similarity** — Why some artifacts match your bid and others don't
3. **Trading on similarity** — Place standing orders that match multiple items
4. **MinHash in action** — See how trait combinations produce MinHash signatures

## Game Mechanics

### 1. Excavation (Quarry)

Players dig for artifacts with random traits:

```typescript
// Trait distribution follows Gaussian-ish curve
const traitWeights = [
  { count: 1, weight: 1 },   // ~2% chance of 1 trait
  { count: 2, weight: 3 },   // ~6%
  { count: 3, weight: 7 },   // ~14%
  { count: 4, weight: 12 },  // ~24% - most common
  { count: 5, weight: 12 },  // ~24%
  { count: 6, weight: 7 },   // ~14%
  { count: 7, weight: 5 },   // ~10%
  { count: 8, weight: 3 },   // ~6%
]
```

**Trait Pools**:

| Trait | Values | Upgradeable |
|-------|--------|-------------|
| **rarity** | common → uncommon → rare → epic → legendary | ✓ |
| **quality** | fragmented → worn → intact → pristine → immaculate | ✓ |
| **inscription** | unmarked → faded → partial → legible → glowing | ✓ |
| **age** | neolithic, bronze age, iron age, classical, medieval, antediluvian | ✗ |
| **material** | clay, bone, bronze, iron, silver, jade, obsidian, gold, orichalcum | ✗ |
| **form** | tablet, idol, vessel, amulet, blade, scepter, mask | ✗ |
| **site** | sunken-temple, desert-tomb, mountain-shrine, forest-barrow, etc. | ✗ |

Each artifact gets a random subset of traits, producing a unique MinHash.

### 2. Trading (Bazaar)

#### Active Auctions

Players list artifacts for auction:

```
┌────────────────────────────────────────────────────────────┐
│ 🏛️ Active Auctions                           [+ Auction]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Antediluvian Orichalcum Scepter #A3F2               │   │
│  │ rarity: legendary | material: orichalcum            │   │
│  │ age: antediluvian | form: scepter                   │   │
│  │                                                     │   │
│  │ MinHash: [0x3a2...][0x8c7...][0x1f9...][...]       │   │
│  │ Reserve: 500 SCRIP                                  │   │
│  │ Bids: 3 standing orders match                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

#### Standing Buy Orders

Players create similarity-based bids:

```
┌────────────────────────────────────────────────────────────┐
│ 📋 Standing Buy Orders                                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Desired Traits:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ rarity:legendary ✕ │ material:gold ✕ │              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  MinHash Preview:                                          │
│  [████] [████] [████] [████] [████]                        │
│                                                            │
│  Similarity: 3/5 bands must match (60%)                    │
│  Amount: 200 SCRIP                                         │
│                                                            │
│  [Create Buy Order]                                        │
│                                                            │
│  Your Standing Orders:                                     │
│  • legendary gold (3/5) - 200 SCRIP - Active               │
│  • rare orichalcum (4/5) - 150 SCRIP - Matched             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3. Upgrading (Polymerase)

Fuse two similar artifacts to upgrade traits:

```
┌────────────────────────────────────────────────────────────┐
│ ⚗️ Polymerase Workbench                           [Fuse]   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────┐     ┌─────────────────┐               │
│  │ TARGET (keeps)  │     │ CONSUMED (lost) │               │
│  │                 │     │                 │               │
│  │ rarity: rare    │ ──▶ │ rarity: rare    │ → ⬆ EPIC     │
│  │ quality: worn   │     │ quality: worn   │ → ⬆ INTACT   │
│  │ material: gold  │     │ age: bronze     │ → +5 Essence  │
│  └─────────────────┘     └─────────────────┘               │
│                                                            │
│  Band Matches: 3/5 ✓ (requires 2/5)                        │
│                                                            │
│  Result:                                                   │
│  • Matching upgradeable traits level up                    │
│  • Non-matching traits convert to Essence                  │
│                                                            │
│  ✨ Essence Balance: 47                                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Fusion Rules**:

| Scenario | Outcome |
|----------|---------|
| Matching upgradeable trait | Target trait levels up |
| Matching non-upgradeable trait | Converts to Essence |
| Non-matching trait from B | Converts to Essence |
| Target keeps all its traits | (B traits don't transfer) |

### 4. Economy

**SCRIP**: ERC20 token for bidding
- Claim 10,000 daily from Explorer's Stipend
- Earn by selling artifacts
- Spend on bids

**Essence**: Points from polymerization
- Track total fusions
- Future: Craft special items

## UI Walkthrough

### Auction Room

When entering an auction:

```
┌────────────────────────────────────────────────────────────┐
│ Auction: Bronze Age Gold Idol #7E2F                        │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    [Artifact Image]                 │   │
│  │                                                     │   │
│  │  rarity: uncommon                                   │   │
│  │  material: gold                                     │   │
│  │  age: bronze age                                    │   │
│  │  form: idol                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  Activity Feed:                                            │
│  • 🎯 Standing bid matched (3/5 bands) - 150 SCRIP        │
│  • 💬 Explorer says: "Nice find!"                         │
│  • 💰 Direct bid placed - 175 SCRIP                       │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Your Bid: [    200    ] SCRIP         [Place Bid]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  [Settle Auction]                        Ends in: 23:45:12 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Standing Bid Flow

1. **Select traits** using autocomplete
2. **Preview MinHash** visualization
3. **Set threshold** (2-5 bands)
4. **Set amount** in SCRIP
5. **Sign** EIP-712 bid (gasless)
6. **Wait** for matching auctions

When an auction is created with a matching NFT:
- Standing bids are automatically attached
- Auctioneer sees matched bids immediately
- Settlement picks highest valid bid

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RELIC SAFARI STACK                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         FRONTEND (Farcaster)                        │    │
│  │                                                                     │    │
│  │  /Excavation      /Bazaar           /Auction/:id                    │    │
│  │  • Stipend claim  • Active auctions • Real-time chat                │    │
│  │  • Quarry dig     • Standing bids   • Bid placement                 │    │
│  │  • Polymerase     • Trait selector  • Settlement                    │    │
│  │                                                                     │    │
│  │  Hooks: useAuctionSignature, useStandingBid, usePolymerase          │    │
│  └────────────────────────────────────┬────────────────────────────────┘    │
│                                       │                                     │
│                                       ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           API (Fastify)                             │    │
│  │                                                                     │    │
│  │  /api/auction     /api/bids         /api/faucet                     │    │
│  │  • CRUD auctions  • Standing bids   • NFT mint                      │    │
│  │  • WebSocket room • Matching logic  • Polymerase                    │    │
│  │  • Settlement     • Attach to auction                               │    │
│  │                                                                     │    │
│  │  Lib: Auction/standingBids.ts, Auction/db.ts                        │    │
│  └────────────────────────────────────┬────────────────────────────────┘    │
│                                       │                                     │
│                                       ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         BLOCKCHAIN (Base)                           │    │
│  │                                                                     │    │
│  │  JaccardSwap.sol         JaccardERC1155.sol       MockERC20.sol     │    │
│  │  • consumeAuction()      • mint + MinHash         • ERC20Permit     │    │
│  │  • countMatches()        • permit transfers       • faucet()        │    │
│  │  • EIP-712 verify        • polymerase()                             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Running Locally

```bash
# Start all services
docker compose -f docker-compose.dev.yaml up

# Or individually:
cd hardhat && npx hardhat node        # Local blockchain
cd api && npm run dev                 # API server
cd farcaster && npm run dev           # Frontend
```

Visit `http://localhost:5173` in Warpcast or browser.

## Gameplay Tips

1. **Start broad**: Create standing bids with 3/5 threshold to see more matches
2. **Learn trait values**: Track which traits command premiums
3. **Fuse strategically**: Match upgradeables, harvest non-upgradeables for Essence
4. **Watch the feed**: Standing bids auto-attach, don't miss good deals

## Future Features

- **Quests**: Collect specific trait combinations
- **Leaderboards**: Track best traders, most Essence, rarest artifacts
- **Guilds**: Pool standing bids for collective purchasing power
- **Crafting**: Spend Essence on special items

## Next Steps

- [Deep Dive](./deep-dive) — advanced MinHash topics
- [Protocol](./protocol) — cross-collection standardization

