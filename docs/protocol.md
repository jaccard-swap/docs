---
sidebar_position: 8
---

# Protocol Standardization

This document covers cross-collection interoperability and the standards required for Jaccard Swap to work across different NFT ecosystems.

## The Interoperability Challenge

For similarity-based trading to work across collections, all participants must agree on:

1. **Feature extraction**: How metadata becomes `key:value` pairs
2. **Hash parameters**: Seeds, k value, hash function
3. **Schema compliance**: Which keys are required/optional

Without standardization, collections describing the same concept differently have zero similarity.

## Schema Definition

A schema specifies how to extract features from metadata:

```typescript
interface Schema {
  name: string              // "gaming-nft-v1"
  version: string           // "1.0.0"
  requiredKeys: string[]    // ["rarity", "element"]
  optionalKeys: string[]    // ["faction", "season"]
  hashFunction: string      // "keccak256"
  numHashes: number         // 5
  seeds: string[]           // MINHASH_SEEDS
}
```

### Example Schemas

**Gaming NFTs**:
```typescript
{
  name: "gaming-nft-v1",
  requiredKeys: ["rarity", "element", "class"],
  optionalKeys: ["faction", "season", "generation"],
  numHashes: 5,
}
```

**Art NFTs**:
```typescript
{
  name: "art-nft-v1", 
  requiredKeys: ["artist", "medium", "year"],
  optionalKeys: ["style", "collection", "edition"],
  numHashes: 5,
}
```

**Relic Safari** (this implementation):
```typescript
{
  name: "relic-safari-v1",
  requiredKeys: [],  // All optional
  optionalKeys: ["rarity", "quality", "inscription", "age", "material", "form", "site"],
  numHashes: 5,
}
```

## Feature Extraction Rules

### Key Normalization

All keys are lowercase, no spaces:

```typescript
// ✗ BAD
{ "Rarity Level": "Legendary" }

// ✓ GOOD
{ rarity: "legendary" }
```

### Value Normalization

Values are lowercase strings:

```typescript
// ✗ BAD
{ attack: 100 }           // Numeric
{ rarity: "LEGENDARY" }   // Uppercase

// ✓ GOOD
{ attack: "100" }         // String
{ rarity: "legendary" }   // Lowercase
```

### Array Handling

Arrays become multiple features:

```typescript
// Input
{ elements: ["fire", "water"] }

// Extracted features
"elements:fire"
"elements:water"
```

### Nested Objects

Flatten with dot notation:

```typescript
// Input
{ stats: { attack: 100, defense: 50 } }

// Extracted features
"stats.attack:100"
"stats.defense:50"
```

## On-Chain Registry

### Contract Interface

```solidity
contract SchemaRegistry {
    struct Schema {
        string name;
        string[] requiredKeys;
        string[] optionalKeys;
        bytes32[] seeds;
        uint8 numHashes;
        address creator;
        bool active;
    }
    
    // Schema ID → Schema
    mapping(bytes32 => Schema) public schemas;
    
    // Collection → Schema ID
    mapping(address => bytes32) public collectionSchema;
    
    event SchemaRegistered(bytes32 indexed schemaId, string name, address creator);
    event SchemaCompliance(address indexed collection, bytes32 indexed schemaId);
    
    function registerSchema(Schema calldata schema) 
        external returns (bytes32 schemaId) 
    {
        schemaId = keccak256(abi.encode(schema.name, schema.requiredKeys, schema.seeds));
        schemas[schemaId] = schema;
        emit SchemaRegistered(schemaId, schema.name, msg.sender);
    }
    
    function declareCompliance(bytes32 schemaId) external {
        require(schemas[schemaId].active, "Schema not active");
        collectionSchema[msg.sender] = schemaId;
        emit SchemaCompliance(msg.sender, schemaId);
    }
}
```

### Usage

```typescript
// Register a schema
const schemaId = await schemaRegistry.registerSchema({
  name: "gaming-nft-v1",
  requiredKeys: ["rarity", "element"],
  optionalKeys: ["faction"],
  seeds: MINHASH_SEEDS,
  numHashes: 5,
})

// Collection declares compliance
await myNftCollection.declareCompliance(schemaId)

// Traders query schema before bidding
const schema = await schemaRegistry.schemas(collectionSchema(nftAddress))
```

## Cross-Collection Trading

### Same Schema

Collections using the same schema are directly interoperable:

```
Collection A (gaming-nft-v1): { rarity: "legendary", element: "fire" }
Collection B (gaming-nft-v1): { rarity: "legendary", element: "fire" }

Similarity: 5/5 (both use same keys, same seeds)
```

### Different Schemas

Collections with different schemas need mapping:

```typescript
interface SchemaMapping {
  source: bytes32       // Source schema ID
  target: bytes32       // Target schema ID
  keyMappings: {
    sourceKey: string
    targetKey: string
  }[]
}

// Example: Map gaming → art
{
  source: gamingSchemaId,
  target: artSchemaId,
  keyMappings: [
    { sourceKey: "rarity", targetKey: "edition" },
    { sourceKey: "element", targetKey: "style" },
  ]
}
```

This is an advanced feature for future development.

## Verification

### Client-Side

Before bidding, verify the collection follows its declared schema:

```typescript
async function verifyCompliance(
  nftAddress: string,
  tokenId: bigint,
  metadata: Record<string, any>
): Promise<boolean> {
  // Get declared schema
  const schemaId = await schemaRegistry.collectionSchema(nftAddress)
  const schema = await schemaRegistry.schemas(schemaId)
  
  // Check required keys present
  for (const key of schema.requiredKeys) {
    if (!(key in metadata)) return false
  }
  
  // Recompute MinHash
  const computed = computeMinHash(metadata, schema)
  const stored = await nftContract.getMinHashByTokenId(tokenId)
  
  return computed.every((h, i) => h === stored[i])
}
```

### On-Chain (Future)

ZK proof of schema compliance:

```
Prove:
  1. metadata contains all required keys
  2. computeMinHash(metadata) == stored_minhash
Without revealing:
  metadata contents
```

## Migration

### Schema Upgrades

When upgrading schemas:

1. Register new schema (v2)
2. Maintain backward compatibility
3. Collections can migrate incrementally

```typescript
// v1 schema
{ requiredKeys: ["rarity"] }

// v2 schema (adds element, keeps rarity)
{ requiredKeys: ["rarity", "element"] }

// Existing v1 NFTs remain valid
// New mints follow v2
```

### MinHash Reminting

If schema changes require new MinHashes:

```solidity
function remint(uint256 tokenId, bytes32[5] calldata newMinHash) external {
    require(msg.sender == ownerOf(tokenId), "Not owner");
    minHashes[tokenId] = newMinHash;
    emit MinHashUpdated(tokenId, newMinHash);
}
```

## Best Practices

### For Collection Creators

1. **Choose established schemas** when possible
2. **Document deviations** from standard schemas
3. **Compute MinHash at mint** (not later)
4. **Test interoperability** before launch

### For Traders

1. **Verify schema compliance** before large bids
2. **Understand schema limitations** (what traits matter)
3. **Use standing bids wisely** (they match ANY compliant NFT)

### For Protocol Developers

1. **Minimize required keys** (more flexibility)
2. **Version schemas** (backward compatibility)
3. **Publish seeds publicly** (reproducibility)

## Governance

Schema governance determines:

1. **Who can register schemas**: Open vs permissioned
2. **Schema modification**: Immutable vs upgradeable
3. **Dispute resolution**: What if schema is violated?

Current implementation: Open registration, immutable schemas, no on-chain dispute resolution.

## Future Work

1. **Schema marketplace**: Discover and compare schemas
2. **Compliance proofs**: ZK verification of schema adherence
3. **Cross-chain schemas**: Same schemas across L1/L2
4. **Schema reputation**: Track which schemas have wide adoption

## Next Steps

- [Deep Dive](/docs/deep-dive) — dimensionality and optimization
- [Introduction](/docs/intro) — back to basics
