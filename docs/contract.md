---
sidebar_position: 5
---

# Smart Contract Reference

Jaccard Swap's settlement logic no longer lives in a standalone contract—it's one facet of a **diamond proxy** (EIP-2535). All facets share one address and one storage layout, so "the contract" in practice means "the diamond," and every facet below is really just a differently-shaped view into the same state.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          JaccardDiamond (single address)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Shared AppStorage: minHashes, usedBids/usedAuctions, ERC20/ERC1155/badge  │
│  balances - every facet below reads and writes the same storage slots.     │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │  JaccardSwapFacet  │  │JaccardERC1155Facet│  │   EssenceFacet    │       │
│  │                    │  │                    │  │                   │       │
│  │ • consumeAuction() │  │ • NFT + MinHash    │  │ • Full ERC20Permit│       │
│  │ • countMatches()   │  │ • permit transfers │  │   ("Essence")     │       │
│  │ • EIP-712 verify   │  │ • polymerase()     │  │ • mint/burn, only │       │
│  │                    │  │ • upgradeTrait()   │  │   callable by the │       │
│  │                    │  │   (Forge)          │  │   diamond's owner │       │
│  └───────────────────┘  └───────────────────┘  └───────────────────┘       │
│                                                                             │
│  ┌───────────────────┐  ┌───────────────────┐                              │
│  │  CollectionFacet   │  │    BadgesFacet     │   + rocketh's standard     │
│  │                    │  │                    │   DiamondLoupeFacet /       │
│  │ • completeCupboard │  │ • badgeCount()     │   OwnershipFacet /          │
│  │   (burns 7 NFTs,   │  │ • ownerOf()        │   DiamondCutFacet for       │
│  │   mints a badge)   │  │ • locked() (5192)  │   introspection/upgrades   │
│  │                    │  │ • cupboardOf()     │                             │
│  └───────────────────┘  └───────────────────┘                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why a diamond, not separate contracts?** Two reasons that matter in practice: every facet needs to read the *same* MinHash and balance data (a separate `JaccardERC1155.sol` calling back into a separate `JaccardSwap.sol` is exactly the cross-contract-call overhead a diamond avoids), and new game systems (Forge's `upgradeTrait`, Museum's `completeCupboard`/badges) could be added as new facets without redeploying or migrating anything that already existed. Facets that mutate another facet's conceptual domain—like `CollectionFacet` burning ERC1155 balances and minting a badge—do it by writing directly into the shared `AppStorage` struct rather than calling into `JaccardERC1155Facet`/`BadgesFacet` (facets don't share Solidity-level internal functions across the proxy boundary, only storage), the same pattern `JaccardERC1155Facet` itself already uses to mint/burn Essence without calling `EssenceFacet`.

## Core Structs

All three structs below are copied directly from `libraries/LibAppStorage.sol`—the authoritative definitions, not simplified examples.

### Bid

A bidder's intent to buy NFTs matching a similarity threshold:

```solidity
struct Bid {
    bytes4 salt;
    uint256 deadline;
    bytes8[20] targetMinHash;
    uint8 minMatches;
    ERC20PermitData permit;
}
```

| Field | Type | Description |
|-------|------|-------------|
| `salt` | `bytes4` | Random bytes for uniqueness |
| `deadline` | `uint256` | Unix timestamp after which bid is invalid |
| `targetMinHash` | `bytes8[20]` | MinHash of desired traits (20 bands, 8 bytes each) |
| `minMatches` | `uint8` | Minimum bands that must match (2-20) |
| `permit` | `ERC20PermitData` | Nested payment data |

`bytes8[20]` tight-packs into exactly **5 storage slots** with zero padding (4 elements per slot)—the same number of slots the earlier `bytes32[5]` layout used for only 5 hash functions. Going from 5 to 20 bands was, storage-wise, free.

### ERC20PermitData

Payment authorization embedded in bids:

```solidity
struct ERC20PermitData {
    address owner;    // Bidder address
    address spender;  // The diamond's own address
    uint256 value;    // Bid amount in tokens
    uint256 deadline; // Permit expiration
    uint8 v;          // Signature component
    bytes32 r;        // Signature component
    bytes32 s;        // Signature component
}
```

### Auction

Auctioneer's NFT listing with nested permits and bids:

```solidity
struct Auction {
    bytes4 salt;
    uint256 deadline;
    address nft;                    // The diamond's own address (NFT and swap logic share it)
    address token;                  // Payment token address
    uint256 reservePrice;           // Minimum bid amount
    JaccardERC1155Permit nftPermit; // NFT transfer permit
    bytes nftPermitSignature;       // Auctioneer's NFT permit signature
    Bid[] bids;                     // Array of bids, must be pre-sorted highest → lowest
    bytes[] bidSignatures;          // Corresponding bid signatures
}
```

## Core Functions (`JaccardSwapFacet`)

### consumeAuction

Settles an auction by finding the first valid, high-enough, similar-enough bid:

```solidity
function consumeAuction(
    Auction calldata auction,
    bytes calldata auctionSignature
) external
```

**Flow**:

1. Verify auction hasn't expired, its signer is the NFT permit's owner, and it hasn't already been settled
2. Require `bids.length == bidSignatures.length` and that bids are pre-sorted strictly highest → lowest
3. Read the NFT's MinHash directly out of shared diamond storage (`s.minHashes[tokenId]`—no external call needed, `JaccardERC1155Facet`'s data lives in the same storage this facet reads)
4. Loop through bids in order:
   - Skip if below reserve price, expired, or `minMatches` outside `[2, 20]`
   - Count matching bands with `countMatches()`; skip if below `minMatches`
   - Verify bid signature matches permit owner
   - Try ERC20 permit + transfer; on success, transfer the NFT and emit `AuctionSettled`
5. If no bid succeeded: `revert NoValidBids(topBidRejectReason)` — a `BidRejectReason` enum (`BelowReserve`, `BidExpired`, `PermitExpired`, `BadMinMatchesRange`, `InsufficientMatches`, `BadBidSignature`, `WrongPermitSpender`, `AlreadyUsed`, `PaymentDeclined`) captured from the *highest* bid only, since a lower bid failing is expected once a higher one wins—the top bid's rejection reason is the one actually worth debugging.

**Example**:

```typescript
// Settle auction with highest valid bid
await diamond.write.consumeAuction([fullAuction, auctionSig])
```

### countMatches

Count matching MinHash bands:

```solidity
function countMatches(
    bytes8[20] memory targetMinHash,
    bytes8[20] memory nftMinHash
) public pure returns (uint8 matches) {
    for (uint8 i = 0; i < 20; i++) {
        if (targetMinHash[i] == nftMinHash[i]) {
            matches++;
        }
    }
}
```

**Gas**: roughly ~2,000 gas (constant regardless of trait count—dominated by the 20-iteration loop, not by how many traits the underlying NFT actually has).

### Verification Functions

```solidity
// Verify bid signature, return signer
function verifyBid(Bid calldata bid, bytes calldata signature)
    public view returns (address)

// Hash bid for signing (includes EIP-712 domain)
function hashBid(Bid calldata bid)
    public view returns (bytes32)

// Hash auction for signing
function hashAuction(Auction calldata auction)
    public view returns (bytes32)
```

## Other Facets

### JaccardERC1155Facet

The NFT itself, plus two of the game's core mechanics—both live here rather than in their own facets, since both are just different ways of mutating an NFT's own MinHash/traits:

- `polymerase(...)` — Polymerase fusion: burns a "consumed" artifact, levels up the target's matching traits, mints Essence for the rest
- `upgradeTrait(...)` — Forge: direct Essence spend to level up a single trait, no second artifact
- `getMinHashByTokenId(uint256) → bytes8[20]` — the same read `JaccardSwapFacet.consumeAuction` does internally, exposed externally for anyone who wants to query without settling anything
- `transferFromWithPermit(...)` — gasless NFT transfer via EIP-712 permit
- Standard ERC1155 reads (`balanceOf`, `isApprovedForAll`, `uri`, `supportsInterface`)

### EssenceFacet

A complete `ERC20Permit` implementation for Essence, living as a facet rather than a separate token contract—`name`/`symbol`/`decimals`/`totalSupply`/`balanceOf`/`allowance`/`permit`/`nonces`/`DOMAIN_SEPARATOR`, plus owner-gated `mint`/`burn`. Its own EIP-712 domain is `"Essence"` (see [Type Hashes](#type-hashes) below)—the one facet with a domain that isn't `JaccardDiamond`, alongside `Scrip` (a fully separate ERC20 contract, not a facet).

### CollectionFacet / BadgesFacet — the Museum

`CollectionFacet.completeCupboard(...)` is the one function: given 7 tokenIds and a `cupboardKey` (see [Relic Safari](./relic-safari#6-museum)), it verifies ownership of all 7, burns them (writing directly into `AppStorage`'s ERC1155 balances and re-emitting `TransferBatch`, rather than calling `JaccardERC1155Facet`), and mints a badge by writing directly into badge storage and emitting `Transfer(0x0, owner, badgeId)` plus an EIP-5192 `Locked(badgeId)` event.

`BadgesFacet` is the read-only (and permanently-locked) surface over that badge storage: `badgeCount(address)`, `ownerOf(uint256)`, `locked(uint256)` (always `true`—this is what makes it soulbound), `cupboardOf(uint256)`, `tokenURI(uint256)`. Its transfer functions exist only to satisfy the ERC-721 interface and unconditionally revert.

## Type Hashes

EIP-712 type hashes for structured data signing (from `hashBid`/`hashAuction` above):

```solidity
bytes32 public constant ERC20_PERMIT_TYPEHASH = keccak256(
    "ERC20PermitData(address owner,address spender,uint256 value,uint256 deadline)"
);

bytes32 public constant BID_TYPEHASH = keccak256(
    "Bid(bytes4 salt,uint256 deadline,bytes8[20] targetMinHash,uint8 minMatches,ERC20PermitData permit)ERC20PermitData(address owner,address spender,uint256 value,uint256 deadline)"
);

bytes32 public constant AUCTION_TYPEHASH = keccak256(
    "Auction(bytes4 salt,uint256 deadline,address nft,address token,uint256 reservePrice,JaccardERC1155Permit nftPermit,bytes nftPermitSignature)JaccardERC1155Permit(address owner,address spender,uint256 tokenId,uint256 amount,uint256 deadline,bytes4 salt)"
);
```

EIP-712 domains, from `EIP712_DOMAINS` in `@shared/constants` (the source of truth every service imports rather than hardcoding):

```typescript
export const EIP712_DOMAINS = {
  JACCARD_SWAP: 'JaccardDiamond',   // JaccardSwapFacet + JaccardERC1155Facet
  JACCARD_ERC1155: 'JaccardDiamond', // unified - one domain, whichever facet you're signing for
  SCRIP: 'Scrip', // Scrip is a separate ERC20Permit contract, not a facet - its domain must match its own constructor arg exactly
} as const
```

A mismatched domain here doesn't fail loudly—the signature is still well-formed, it just recovers to an unrelated address, so `permit()` silently reverts downstream instead of erroring at sign time.

## Events

### AuctionSettled

Emitted when an auction is successfully settled:

```solidity
event AuctionSettled(
    address indexed nft,           // NFT contract (the diamond itself)
    address indexed token,         // Payment token
    uint256 indexed nftId,         // Token ID transferred
    uint256 amount,                // Payment amount
    address auctioneer,            // Seller
    address winner,                // Buyer
    uint8 similarityMatches        // How many of 20 bands matched
);
```

## State

```solidity
mapping(bytes32 => bool) public usedBids;     // Prevent bid replay
mapping(bytes32 => bool) public usedAuctions; // Prevent auction replay
mapping(uint256 => bytes8[20]) minHashes;     // Per-tokenId MinHash signature
```

## Security Model

### Signature Binding

Every signed message cryptographically binds:
- **Auction**: salt, deadline, NFT address, reserve price, NFT permit
- **Bid**: salt, deadline, targetMinHash, minMatches, ERC20 permit

Modifying any field invalidates the signature.

### Replay Protection

1. **Salt**: Random bytes make each signature unique
2. **Deadline**: Time-limited validity
3. **usedBids/usedAuctions**: On-chain tracking of consumed signatures
4. **ERC20 nonces**: Permit nonces prevent double-spending

### Graceful Degradation

If a bid's permit fails (insufficient balance, expired, revoked), `consumeAuction` automatically moves on to the next-highest valid bid in the same loop rather than reverting the whole settlement—see the `consumeAuction` flow above.

## Gas Costs

| Operation | Approximate Gas |
|-----------|-----------------|
| `countMatches` (20 bands) | ~2,000 |
| `verifyBid` | ~5,000 |
| `consumeAuction` (1 bid, success) | ~150,000 |
| `consumeAuction` (5 bids, last wins) | ~200,000 |

## Usage Examples

### Signing a Bid (TypeScript)

```typescript
import { BidTypes, EIP712_DOMAINS, computeMinHash } from '@shared/constants'

const bidMessage = {
  salt: randomSalt(),
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  targetMinHash: computeMinHash({ rarity: 'legendary', material: 'gold' }),
  minMatches: 8,
  permit: {
    owner: bidderAddress,
    spender: diamondAddr,
    value: parseEther('100'),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  },
}

const bidSig = await wallet.signTypedData({
  domain: {
    name: EIP712_DOMAINS.JACCARD_SWAP, // 'JaccardDiamond'
    version: '1',
    chainId,
    verifyingContract: diamondAddr,
  },
  types: BidTypes,
  primaryType: 'Bid',
  message: bidMessage,
})
```

### Settling an Auction (TypeScript)

```typescript
// Construct full auction with bids
const fullAuction = {
  salt: auctionSalt,
  deadline: auctionDeadline,
  nft: diamondAddr,       // same address as the diamond itself
  token: paymentTokenAddr,
  reservePrice: parseEther('50'),
  nftPermit: nftPermitData,
  nftPermitSignature: nftPermitSig,
  bids: [bid1, bid2, bid3],  // Sorted highest to lowest
  bidSignatures: [sig1, sig2, sig3],
}

// Anyone can settle
await diamond.write.consumeAuction([fullAuction, auctionSig])
```

## JaccardERC1155 Interface

```solidity
interface IJaccardERC1155 {
    // Transfer NFT using permit (gasless for owner)
    function transferFromWithPermit(
        JaccardERC1155Permit calldata permit,
        address to,
        bytes memory signature
    ) external;

    // Retrieve stored MinHash for similarity matching
    function getMinHashByTokenId(uint256 tokenId)
        external view returns (bytes8[20] memory);
}
```

## Deployment

**Network**: Ethereum Sepolia (chainId: 11155111), plus a local Anvil/Hardhat network (chainId: 31337) for development.

```bash
cd hardhat
npx hardhat deploy --network sepolia
```

Deployment is managed by [rocketh](https://github.com/wighawag/rocketh)'s `diamond()` helper (`hardhat/deploy/00_deploy_diamond.ts`), which cuts all facets onto the diamond in one deploy step and writes ABIs to `shared/contracts/<chainId>/` for the API and frontend to import directly.

## Next Steps

- [Relic Safari](./relic-safari) — see the contract in action
- [Deep Dive](./deep-dive) — advanced topics
