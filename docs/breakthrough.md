---
sidebar_position: 3
---

# The Breakthrough

The key innovation in Jaccard Swap is **embedding similarity checks inside EIP-712 signed intents**. This enables trustless, gasless, similarity-based trading without any off-chain matching infrastructure.

## The Problem with Traditional NFT Orders

Traditional NFT orders require exact matching:

```solidity
// Traditional orderbook
struct Order {
    address nft;
    uint256 tokenId;    // ← Must match exactly
    uint256 price;
    // ...
}
```

If you want to buy "any legendary gold artifact," you must:
1. Query all available NFTs off-chain
2. Filter by desired traits
3. Create individual orders for each matching token

This is slow, expensive, and requires trust in the filtering service.

## The Solution: Similarity in Intents

Jaccard Swap replaces exact `tokenId` with a **similarity constraint**:

```solidity
struct Bid {
    bytes4 salt;
    uint256 deadline;
    bytes8[20] targetMinHash; // ← Desired traits as MinHash
    // e.g. ["rarity:rare", "material:gold", "form:idol"]
    //   → hash(trait, seed₀), hash(trait, seed₁), ... hash(trait, seed₁₉)
    //   → [0x7f3a2b9c..., 0x2b8c1d4e..., ... 18 more bands]
    uint8 minMatches;         // ← Similarity threshold (2-20)
    ERC20PermitData permit;
}
```

One signature expresses: *"I'll pay this amount for any NFT with ≥N/20 similarity to these traits."*

## Onchain Similarity Verification

The magic happens in the diamond's `JaccardSwapFacet`, in `consumeAuction`:

```solidity
function countMatches(
    bytes8[20] memory targetMinHash,
    bytes8[20] memory nftMinHash
) public pure returns (uint8 matches) {
    matches = 0;
    for (uint8 i = 0; i < 20; i++) {
        if (targetMinHash[i] == nftMinHash[i]) {
            matches++;
        }
    }
}
```

This is **O(20)** regardless of how many traits the NFTs have—comparing just 160 bytes per NFT. As NFTs gain more traits, the compression benefit grows (100 traits still compresses to 20 comparisons). For higher precision, increase k: accuracy improves as $1/\sqrt{k}$.

The settlement logic:

```solidity
function consumeAuction(FullAuction calldata auction, bytes calldata auctionSig)
    external nonReentrant
{
    // 1. Verify auction signature
    _verifyAuctionSignature(auction, auctionSig);

    // 2. Get NFT's MinHash from the diamond's own ERC1155 facet
    bytes8[20] memory nftMinHash = IJaccardERC1155(auction.nft)
        .getMinHashByTokenId(auction.nftPermit.tokenId);

    // 3. Find best matching bid
    for (uint256 i = 0; i < auction.bids.length; i++) {
        Bid calldata bid = auction.bids[i];

        // Count similarity bands
        uint8 matches = countMatches(bid.targetMinHash, nftMinHash);

        // Check threshold
        if (matches >= bid.minMatches && /* other validity checks */) {
            // Execute trade
            _settle(auction, bid);
            return;
        }
    }

    revert("No valid bids");
}
```

## The EIP-712 Signature Scheme

Security comes from carefully structured typed data signing:

```typescript
// Bid type definition (must match the contract exactly - shared/constants
// is the single source of truth both sides import from)
const BidTypes = {
  Bid: [
    { name: 'salt', type: 'bytes4' },
    { name: 'deadline', type: 'uint256' },
    { name: 'targetMinHash', type: 'bytes8[20]' },
    { name: 'minMatches', type: 'uint8' },
    { name: 'permit', type: 'ERC20PermitData' },
  ],
  ERC20PermitData: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}
```

When a bidder signs:

```typescript
const bidSig = await wallet.signTypedData({
  domain: {
    name: 'JaccardDiamond', // unified EIP-712 domain for every facet
    version: '1',
    chainId,
    verifyingContract: diamondAddr,
  },
  types: BidTypes,
  primaryType: 'Bid',
  message: {
    salt: randomSalt(),
    deadline,
    targetMinHash: computeMinHash({ rarity: 'legendary', material: 'gold' }),
    minMatches: 8, // require at least 8/20 bands - a "medium resonance" style threshold
    permit: {
      owner: bidderAddress,
      spender: diamondAddr,
      value: bidAmount,
      deadline,
    },
  },
})
```

The signature commits to:
- **What they want**: `targetMinHash` + `minMatches`
- **What they'll pay**: `permit.value`
- **When it expires**: `deadline`
- **Uniqueness**: `salt` (prevents replay attacks)

## Gasless Execution Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         GASLESS SIMILARITY TRADE                             │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  BIDDER (offline)                                                            │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Choose traits: { rarity: legendary, material: gold }                │  │
│  │ 2. computeMinHash() → targetMinHash                                    │  │
│  │ 3. Sign bid (EIP-712) with a minMatches threshold                      │  │
│  │ 4. Sign ERC20 permit for payment                                       │  │
│  │ 5. Submit signatures to API (no gas!)                                  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  AUCTIONEER (offline)                                                        │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. NFT already has MinHash stored onchain                              │  │
│  │ 2. Sign NFT permit (EIP-712)                                           │  │
│  │ 3. Sign auction (EIP-712)                                              │  │
│  │ 4. Submit signatures to API (no gas!)                                  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  SETTLER (anyone, pays gas)                                                  │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. Collect auction + matching bids from API                            │  │
│  │ 2. Call consumeAuction() with all signatures                           │  │
│  │    → Contract verifies signatures                                      │  │
│  │    → Contract checks similarity: countMatches() ≥ minMatches           │  │
│  │    → Contract executes ERC20 permit for payment                        │  │
│  │    → Contract executes NFT permit for transfer                         │  │
│  │    → Trade settles atomically                                          │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Security Properties

### Signature Binding

The bid signature cryptographically binds:
- The exact `targetMinHash` (bidder can't change desired traits)
- The exact `minMatches` threshold (bidder can't lower standards post-hoc)
- The exact payment amount (no bait-and-switch)

Any modification invalidates the signature.

### Permit Integration

ERC20 permits are signed separately but included in the bid struct:

```solidity
struct ERC20PermitData {
    address owner;     // Bidder
    address spender;   // JaccardSwapFacet (the diamond itself)
    uint256 value;     // Bid amount
    uint256 deadline;  // Must match bid deadline
}
```

The permit is only executable if the bid signature is valid AND similarity threshold is met.

### Replay Protection

1. **Salt**: Random 4 bytes ensure unique signatures
2. **Deadline**: Time-limited validity
3. **Nonce**: ERC20 permit nonces prevent double-spending

### Graceful Degradation

If the highest bid's permit fails (insufficient balance, expired, etc.), the contract automatically tries the next-highest valid bid:

```solidity
for (uint256 i = 0; i < auction.bids.length; i++) {
    // Try each bid in order (pre-sorted by amount)
    try this._tryPermitAndTransfer(bid, auction) {
        emit AuctionSettled(..., matches);
        return;
    } catch {
        continue;  // Try next bid
    }
}
```

## Standing Orders: One Signature, Many Matches

The breakthrough enables **standing buy orders**:

```typescript
// Bidder signs once
const standingBid = {
  targetMinHash: computeMinHash({ rarity: 'legendary', material: 'gold' }),
  minMatches: 8,
  amount: parseEther('100'),
  deadline: oneWeekFromNow, // standing bids in Relic Safari's UI default to a 7-day window
}

// This single signature can match:
// - "Legendary Gold Idol" (18/20 match) ✓
// - "Legendary Gold Tablet" (16/20 match) ✓
// - "Epic Gold Amulet" (11/20 match) ✗ below threshold
```

When any matching NFT is auctioned, the standing bid automatically applies.

## Gas Efficiency

| Operation | Gas Cost |
|-----------|----------|
| `countMatches` (20 bands) | ~2,000 gas |
| `consumeAuction` (1 bid) | ~150k gas |
| `consumeAuction` (5 bids) | ~180k gas |

The similarity check adds negligible overhead compared to token transfers—going from 5 to 20 bands is a few thousand extra gas, not a meaningful cost increase relative to the ERC20 permit + NFT transfer that dominates each settlement.

## Comparison with Alternatives

| Approach | Trust | Gas | Expressiveness |
|----------|-------|-----|----------------|
| Exact token orders | Trustless | High (per order) | Low |
| Centralized matching | Trusted server | Low | High |
| AI embeddings | Trusted model | Low | High |
| **Jaccard Swap** | **Trustless** | **Low** | **Medium** |

Jaccard Swap achieves trustless matching with reasonable expressiveness at low cost.

## Next Steps

- [Smart Contract](./contract) — full API reference
- [Deep Dive](./deep-dive) — advanced topics and future extensions
