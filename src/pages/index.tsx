import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p className="hero__description">
          Trade NFTs by <em>similarity</em>, not exact match. Place bids like 
          "any fire-type pocket monster from 2025" and let the protocol match you.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/intro">
            Learn How It Works →
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="Semi-Fungible Trading Onchain"
      description="Jaccard Swap enables onchain similarity search using MinHash and locality-sensitive hashing. Trade NFTs by similarity, not exact match.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
