---
sidebar_position: 5
---

# Smart Contract Reference

This document covers the `JaccardSwap.sol` contract—the core settlement engine for similarity-based NFT trading.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONTRACT ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐         ┌─────────────────────┐                    │
│  │   JaccardERC1155    │         │      MockERC20      │                    │
│  │  (NFT + MinHash)    │         │  (Payment Token)    │                    │
│  │                     │         │                     │                    │
│  │ • minHashes[id]     │         │ • ERC20Permit       │                    │
│  │ • permit support    │         │ • faucet()          │                    │
│  └──────────┬──────────┘         └──────────┬──────────┘                    │
│             │                               │                               │
│             └───────────────┬───────────────┘                               │
│                             │                                               │
│                             ▼                                               │
│              ┌──────────────────────────────┐                               │
│              │        JaccardSwap           │                               │
│              │                              │                               │
│              │ • consumeAuction()           │                               │
│              │ • countMatches()             │                               │
│              │ • EIP-712 verification       │                               │
│              │ • Permit execution           │                               │
│              └──────────────────────────────┘                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Structs

### Bid

A bidder's intent to buy NFTs matching a similarity threshold:

```solidity
struct Bid {
    bytes4 salt;               // Unique identifier
    uint256 deadline;          // Expiration timestamp
    bytes32[5] targetMinHash;  // Desired traits as 5-band MinHash
    uint8 minMatches;          // Similarity threshold (2-5 bands)
    ERC20PermitData permit;    // Payment authorization
}
```

| Field | Type | Description |
|-------|------|-------------|
| `salt` | `bytes4` | Random bytes for uniqueness |
| `deadline` | `uint256` | Unix timestamp after which bid is invalid |
| `targetMinHash` | `bytes32[5]` | MinHash of desired traits |
| `minMatches` | `uint8` | Minimum bands that must match (2-5) |
| `permit` | `ERC20PermitData` | Nested payment data |

### ERC20PermitData

Payment authorization embedded in bids:

```solidity
struct ERC20PermitData {
    address owner;    // Bidder address
    address spender;  // JaccardSwap contract
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
    address nft;                    // JaccardERC1155 address
    address token;                  // Payment token address
    uint256 reservePrice;           // Minimum bid amount
    JaccardERC1155Permit nftPermit; // NFT transfer permit
    bytes nftPermitSignature;       // Auctioneer's NFT permit signature
    Bid[] bids;                     // Array of bids (highest first)
    bytes[] bidSignatures;          // Corresponding bid signatures
}
```

## Core Functions

### consumeAuction

Settles an auction by finding the first valid, high-enough, similar-enough bid:

```solidity
function consumeAuction(
    Auction calldata auction,
    bytes calldata auctionSignature
) external
```

**Flow**:

1. Verify auction signature matches NFT permit owner
2. Check auction hasn't expired or been used
3. Fetch NFT's MinHash from JaccardERC1155
4. Loop through bids (must be pre-sorted highest → lowest):
   - Skip if below reserve price
   - Skip if expired
   - Skip if `minMatches` outside [2,5]
   - Count matching bands with `countMatches()`
   - Skip if matches < minMatches
   - Verify bid signature matches permit owner
   - Try ERC20 permit + transfer
   - If successful: transfer NFT, emit event, return
5. If no bid succeeded: revert

**Example**:

```typescript
// Settle auction with highest valid bid
await jaccardSwap.write.consumeAuction([fullAuction, auctionSig])
```

### countMatches

Count matching MinHash bands:

```solidity
function countMatches(
    bytes32[5] calldata targetMinHash,
    bytes32[5] memory nftMinHash
) public pure returns (uint8 matches)
```

**Implementation**:

```solidity
function countMatches(
    bytes32[5] calldata targetMinHash,
    bytes32[5] memory nftMinHash
) public pure returns (uint8 matches) {
    for (uint8 i = 0; i < 5; i++) {
        if (targetMinHash[i] == nftMinHash[i]) {
            matches++;
        }
    }
}
```

**Gas**: ~500 gas (constant regardless of trait count)

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

## Type Hashes

EIP-712 type hashes for structured data signing:

```solidity
bytes32 public constant ERC20_PERMIT_TYPEHASH = keccak256(
    "ERC20PermitData(address owner,address spender,uint256 value,uint256 deadline)"
);

bytes32 public constant BID_TYPEHASH = keccak256(
    "Bid(bytes4 salt,uint256 deadline,bytes32[5] targetMinHash,uint8 minMatches,ERC20PermitData permit)ERC20PermitData(address owner,address spender,uint256 value,uint256 deadline)"
);

bytes32 public constant AUCTION_TYPEHASH = keccak256(
    "Auction(bytes4 salt,uint256 deadline,address nft,address token,uint256 reservePrice,JaccardERC1155Permit nftPermit,bytes nftPermitSignature)JaccardERC1155Permit(address owner,address spender,uint256 tokenId,uint256 amount,uint256 deadline,bytes4 salt)"
);
```

## Events

### AuctionSettled

Emitted when an auction is successfully settled:

```solidity
event AuctionSettled(
    address indexed nft,           // NFT contract
    address indexed token,         // Payment token
    uint256 indexed nftId,         // Token ID transferred
    uint256 amount,                // Payment amount
    address auctioneer,            // Seller
    address winner,                // Buyer
    uint8 similarityMatches        // How many bands matched (2-5)
);
```

## State

```solidity
mapping(bytes32 => bool) public usedBids;     // Prevent bid replay
mapping(bytes32 => bool) public usedAuctions; // Prevent auction replay
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

If a bid's permit fails (insufficient balance, expired, revoked):

```solidity
if (_tryPermitAndTransfer(auction.token, auction.bids[i].permit, auctioneer)) {
    // Success - settle
    return;
}
// Failure - try next bid
```

The contract automatically falls back to the next-highest valid bid.

## Gas Costs

| Operation | Approximate Gas |
|-----------|-----------------|
| `countMatches` | ~500 |
| `verifyBid` | ~5,000 |
| `consumeAuction` (1 bid, success) | ~150,000 |
| `consumeAuction` (5 bids, last wins) | ~200,000 |

## Usage Examples

### Signing a Bid (TypeScript)

```typescript
import { BidTypes } from '@shared/constants'

const bidMessage = {
  salt: randomSalt(),
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  targetMinHash: computeMinHash({ rarity: 'legendary', material: 'gold' }),
  minMatches: 3,
  permit: {
    owner: bidderAddress,
    spender: jaccardSwapAddr,
    value: parseEther('100'),
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  },
}

const bidSig = await wallet.signTypedData({
  domain: {
    name: 'JaccardSwap',
    version: '1',
    chainId,
    verifyingContract: jaccardSwapAddr,
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
  nft: jaccardNftAddr,
  token: paymentTokenAddr,
  reservePrice: parseEther('50'),
  nftPermit: nftPermitData,
  nftPermitSignature: nftPermitSig,
  bids: [bid1, bid2, bid3],  // Sorted highest to lowest
  bidSignatures: [sig1, sig2, sig3],
}

// Anyone can settle
await jaccardSwap.write.consumeAuction([fullAuction, auctionSig])
```

## JaccardERC1155 Interface

The NFT contract must implement:

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
        external view returns (bytes32[5] memory);
}
```

## Deployment

**Network**: Base Sepolia (chainId: 84532)

```bash
cd hardhat
npx hardhat run scripts/deploy.ts --network base-sepolia
```

## Next Steps

- [Relic Safari](./relic-safari) — see the contract in action
- [Deep Dive](./deep-dive) — advanced topics
