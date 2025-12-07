import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  emoji: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'MinHash Fingerprints',
    emoji: '🔬',
    description: (
      <>
        Compress NFT metadata into compactable signatures stored onchain.
        Like a fuzzy fingerprint—you can't reconstruct the data, but you can compare similarity.
      </>
    ),
  },
  {
    title: 'Jaccard Similarity Onchain',
    emoji: '📐',
    description: (
      <>
        <code>J(A,B) = |A ∩ B| / |A ∪ B|</code> — estimate set overlap between 0 and 1.
        Two pocket monsters sharing year + type = higher similarity than monster vs art.
      </>
    ),
  },
  {
    title: 'Semi-Fungible Bids',
    emoji: '🎯',
    description: (
      <>
        Place orders for "NFTs similar to this one" with a tolerance threshold.
        Auctioneers can pull matching bids into their rooms automatically.
      </>
    ),
  },
];

function Feature({title, emoji, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center" style={{fontSize: '3rem', marginBottom: '1rem'}}>
        {emoji}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={clsx(styles.features, 'homepage-features')}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
