---
sidebar_position: 6
---

# Relic Safari

**Relic Safari** is the example application demonstrating Jaccard Swap. Players excavate, trade, and upgrade ancient artifacts in a market powered by onchain similarity matching—all in service of one goal.

## Objective

Become the greatest relic hunter. Leaderboard points come from exactly one place: freezing a completed Museum collection into a soulbound badge. Everything else in the game—digging, trading, fusing, forging—exists to get you artifacts good enough to fill one.

## Learning Goals

Through gameplay, users experience:

1. **Expressing preferences as traits** — "I want legendary gold artifacts"
2. **Understanding similarity** — Why some artifacts match your bid and others don't
3. **Trading on similarity** — Place standing orders that match multiple items
4. **MinHash in action** — See how trait combinations produce MinHash signatures
5. **Working toward a goal, not just accumulating** — The Museum turns "I have a pile of artifacts" into "I have a *finished collection*"

## Game Mechanics

### 1. Excavation (Quarry)

Players dig for artifacts with random traits:

```typescript
// Trait count distribution follows a Gaussian-ish curve
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

Digging is rate-limited to **5 digs per rolling 24 hours**.

**Trait Pools** (7 traits, straight from `TRAIT_POOLS` in `@shared/constants`):

| Trait | Values | Upgradeable |
|-------|--------|-------------|
| **rarity** | common → uncommon → rare → epic → legendary | ✓ |
| **quality** | fragmented → worn → intact → pristine → immaculate | ✓ |
| **inscription** | unmarked → faded → partial → legible → glowing | ✓ |
| **age** | neolithic, bronze age, iron age, classical era, medieval era, antediluvian | ✗ |
| **material** | clay, bone, bronze, iron, silver, jade, obsidian, gold, orichalcum | ✗ |
| **form** | tablet, idol, vessel, amulet, blade, scepter, mask | ✗ |
| **site** | sunken-temple, desert-tomb, mountain-shrine, forest-barrow, volcanic-forge, frozen-vault, coastal-ruins | ✗ |

Each artifact gets a random subset of traits, producing a unique MinHash. **Site + Age + Material** together identify a Museum cupboard; **Form** is the 7 pedestal slots inside it—see [Museum](#6-museum) below.

### 2. Explorer's Stipend

A free SCRIP faucet, gating how fast anyone can bootstrap into the economy:

- Claim exactly **5.236067977499789696 SCRIP** per claim
- **12-hour cooldown** per address (skipped entirely on the local dev network)

### 3. Trading (Bazaar)

#### Active Auctions

Players list artifacts for auction with a fixed-duration preset—**1 hour, 6 hours, 24 hours, 3 days, or 7 days**—entirely by signature, no gas spent until the auction actually sells:

```
┌────────────────────────────────────────────────────────────┐
│ 🏪 Active Auctions                           [+ Auction]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Antediluvian Orichalcum Scepter #A3F2               │   │
│  │ rarity: legendary | material: orichalcum            │   │
│  │ age: antediluvian | form: scepter                   │   │
│  │                                                     │   │
│  │ MinHash: [0x3a2...][0x8c7...][0x1f9...][...17 more]│   │
│  │ Reserve: 500 SCRIP                                  │   │
│  │ Bids: 3 standing orders match                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

A new bid must strictly exceed the current highest—there's no escrow and no explicit refund needed for a losing bid, since nothing ever moves until settlement picks a winner.

#### Standing Buy Orders

Players create similarity-based bids, good for **7 days** or until cancelled:

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
│  [████] [████] [████] [████] [████] ... (20 bands total)  │
│                                                            │
│  Similarity: 8/20 bands must match (40%)                   │
│  Amount: 200 SCRIP                                         │
│                                                            │
│  [Create Buy Order]                                        │
│                                                            │
│  Your Standing Orders:                                     │
│  • legendary gold (8/20) - 200 SCRIP - Active               │
│  • rare orichalcum (12/20) - 150 SCRIP - Matched             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 4. Upgrading

Two different ways to spend Essence on an artifact, deliberately priced apart:

#### Polymerase — fuse two artifacts

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
│  │ material: gold  │     │ age: bronze     │ → + Essence   │
│  └─────────────────┘     └─────────────────┘               │
│                                                            │
│  Band Matches: 9/20 ✓ (requires 4/20)                       │
│                                                            │
│  Result:                                                   │
│  • Matching upgradeable traits level up on the target       │
│  • Everything else (plus the catalyst itself) → Essence    │
│                                                            │
│  ✨ Essence Balance: 47                                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

The catalyst artifact is always burned—even a failed-to-match trait or a maxed-out matching trait converts to Essence rather than being wasted. Essence yield scales with how strongly the two artifacts resonate:

| Matches (of 20) | Tier | Essence multiplier |
|------------------|------|---------------------|
| 0-3 | Insufficient — fusion blocked | — |
| 4-7 | Low | ×1 |
| 8-11 | Medium | ×1.5 |
| 12-15 | High | ×2 |
| 16-20 | Super | ×2.5 |

Every fusion yields at least **150 Essence** before that multiplier applies, so consuming an artifact is never a total loss.

#### Forge — spend Essence directly

```
┌────────────────────────────────────────────────────────────┐
│ 🔨 Forge                                        [Upgrade]  │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  quality: worn → intact                                     │
│  Cost: 600 Essence (4× the 150 Essence Polymerase would      │
│  grant for the same jump - Forge is the convenience premium) │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

No second artifact, no similarity threshold, no chance of failure—just pay **4× the trait's raw fusion value** in Essence and the trait levels up. Once every upgradeable trait on an artifact is maxed, further Essence can still go into **Overflow**, an uncapped prestige sink costing `200 + 50 × currentLevel` per level with no further trait effect.

### 5. Exchange

A live Uniswap V2 pool trading SCRIP directly against Essence, both directions—the one page in the game that's a real signed transaction rather than a gasless signature, because you're trading against the pool itself, not the game's backend. Quotes come straight from the pool's `getAmountsOut`, with the standard 0.3% pool fee plus a 2% client-side slippage buffer built into every swap.

### 6. Museum

The destination for the whole loop. Drill down **Site → Age → Material** to reach a **cupboard**: 7 pedestal slots, one per **Form**. A slot only accepts a fully-maxed artifact (every upgradeable trait at its highest level) matching that exact Site+Age+Material+Form combination.

Fill all 7 and **Freeze Collection** burns them and mints a permanent, soulbound badge (EIP-5192-style—`locked()` always returns `true`, transfers always revert). Each cupboard can only ever be completed once per owner.

Points are the *inverse* of a cupboard's rarity—rarer Site+Age+Material combinations (the ones with lower combined trait weight) are worth more:

```typescript
points = Math.round(5000 / (siteWeight * ageWeight * materialWeight))
```

Form doesn't factor into the weight—every cupboard needs all 7 forms equally, so it never differentiates one cupboard's rarity from another's.

### 7. Leaderboard

Ranked purely by the sum of points from every badge a wallet has frozen. Nothing else counts toward it—not Essence balance, not artifact count, not Bazaar activity. Badge count is shown alongside as a quick secondary signal.

### 8. Economy

**SCRIP**: ERC20 token for bidding and Forge/Exchange
- Claim ~5.24 from the Explorer's Stipend every 12 hours
- Earn by selling artifacts in the Bazaar
- Spend on bids, or swap for Essence in the Exchange

**Essence**: ERC20 token earned from Polymerase and spent in Forge
- Polymerase converts consumed artifacts into Essence (see the resonance table above)
- Forge spends it to guarantee trait upgrades
- Swappable for SCRIP in the Exchange when you have more than you need

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
│  │  age: bronze age                                     │   │
│  │  form: idol                                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  Activity Feed:                                            │
│  • 🎯 Standing bid matched (9/20 bands) - 150 SCRIP        │
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
3. **Set threshold** (2-20 bands)
4. **Set amount** in SCRIP
5. **Sign** EIP-712 bid (gasless)
6. **Wait** for matching auctions (good for 7 days)

When an auction is created with a matching NFT:
- Standing bids are automatically attached
- Auctioneer sees matched bids immediately
- Settlement picks the highest valid bid

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RELIC SAFARI STACK                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       FRONTEND (web, React Router)                  │    │
│  │                                                                     │    │
│  │  /vault      /excavation    /forge      /exchange   /museum         │    │
│  │  /bazaar     /leaderboard   /help                                   │    │
│  │  • Stipend + Quarry + Polymerase  • Direct trait upgrades            │    │
│  │  • Active auctions + standing bids • Uniswap-pool swap               │    │
│  │  • Site→Age→Material→Form drill-down + badge freeze                 │    │
│  │                                                                     │    │
│  └────────────────────────────────────┬────────────────────────────────┘    │
│                                       │                                     │
│                                       ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           API (Fastify)                             │    │
│  │                                                                     │    │
│  │  /auction     /bids        /faucet       /museum                    │    │
│  │  • CRUD + WS  • Standing   • dig/stipend • progress +               │    │
│  │    room       •  bid match •  /polymerase•  complete-cupboard       │    │
│  │  • Settlement                • /upgrade                             │    │
│  │                                (Forge)                               │    │
│  └────────────────────────────────────┬────────────────────────────────┘    │
│                                       │                                     │
│                                       ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │              BLOCKCHAIN (Ethereum Sepolia + local Anvil)             │    │
│  │                                                                     │    │
│  │  JaccardDiamond (one address, five custom facets)   Scrip.sol       │    │
│  │  • JaccardSwapFacet    • EssenceFacet                • ERC20Permit  │    │
│  │  • JaccardERC1155Facet • CollectionFacet / BadgesFacet• faucet()    │    │
│  │                                          (Museum)                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Running Locally

```bash
# Start all services (blockchain + API + web + deploy)
docker compose -f docker-compose.dev.yaml up

# Or individually:
cd hardhat && npx hardhat node   # Local blockchain
cd api && npm run dev            # API server
cd web && npm run dev            # Frontend
```

Visit `http://localhost:5173` in a browser.

## Gameplay Tips

1. **Start broad**: Create standing bids with an 8/20 threshold to see more matches, tighten from there
2. **Learn trait values**: Track which traits command premiums
3. **Fuse strategically**: Polymerase is cheaper per trait than Forge, but Forge is the sure thing when you need one specific trait *now*
4. **Watch the feed**: Standing bids auto-attach, don't miss good deals
5. **Plan a cupboard, not just a pile**: Before digging blindly, pick a Site+Age+Material to chase—every artifact that doesn't fit one of your active cupboards is a candidate to sell or fuse away, not hoard

## Future Features

- **Guilds**: Pool standing bids for collective purchasing power
- **Crafting**: Spend Essence on special items beyond Forge upgrades
- **Badge galleries**: A dedicated profile page showing a player's frozen collections (Museum and Leaderboard already ship the underlying data—`cupboard_completions.points`—this is purely a presentation layer away)

## Next Steps

- [Deep Dive](./deep-dive) — advanced MinHash topics
- [Protocol](./protocol) — cross-collection standardization
