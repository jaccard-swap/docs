import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Jaccard Swap Documentation Structure
 * 
 * 1. Introduction - Overview and key concepts
 * 2. MinHash - The algorithm behind similarity
 * 3. Breakthrough - Onchain similarity in signed intents
 * 4. Contract - Smart contract reference
 * 5. Relic Safari - Example application
 * 6. Deep Dive - Advanced topics
 * 7. Protocol - Cross-collection standardization
 */
const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Core Concepts',
      items: [
        'minhash',
        'breakthrough',
      ],
    },
    {
      type: 'category',
      label: 'Implementation',
      items: [
        'contract',
        'relic-safari',
      ],
    },
    {
      type: 'category',
      label: 'Advanced',
      items: [
        'deep-dive',
        'protocol',
      ],
    },
  ],
};

export default sidebars;
