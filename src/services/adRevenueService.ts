import axios from 'axios';
import { google } from 'googleapis';

// ─── AdMob Reporting API Client ────────────────────────────────────────────
// Docs: https://developers.google.com/admob/api/v1/reference/rest
//
// Setup steps:
// 1. Go to console.cloud.google.com
// 2. Enable "AdMob API"
// 3. Create OAuth2 credentials (Service Account)
// 4. In AdMob dashboard → Settings → link your Google Cloud project
// 5. Set env vars below

const ADMOB_ACCOUNT_ID = process.env.ADMOB_PUBLISHER_ID!;  // format: pub-XXXXXXXXXXXXXXXX

// ── Auth ───────────────────────────────────────────────────────────────────
async function getAdMobAuthToken(): Promise<string> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
      private_key:  process.env.GOOGLE_SERVICE_ACCOUNT_KEY!.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/admob.report'],
  });
  const client = await auth.getClient();
  const token  = await client.getAccessToken();
  return token.token!;
}

// ── Fetch eCPM per ad unit per country ─────────────────────────────────────
export interface AdUnitMetrics {
  adUnitId:     string;
  country:      string;
  impressions:  number;
  estimatedEarningsUSD: number;
  eCPM:         number;   // USD per 1000 impressions
}

export async function fetchAdMobEcpm(daysBack = 7): Promise<AdUnitMetrics[]> {
  const token = await getAdMobAuthToken();

  const today     = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - daysBack);

  const fmt = (d: Date) => ({
    year:  d.getFullYear(),
    month: d.getMonth() + 1,
    day:   d.getDate(),
  });

  const body = {
    reportSpec: {
      dateRange: { startDate: fmt(startDate), endDate: fmt(today) },
      dimensions: ['AD_UNIT', 'COUNTRY'],
      metrics: ['IMPRESSIONS', 'ESTIMATED_EARNINGS'],
      dimensionFilters: [],
      sortConditions: [{ dimension: 'AD_UNIT', order: 'DESCENDING' }],
      localizationSettings: { currencyCode: 'USD' },
    },
  };

  const { data } = await axios.post(
    `https://admob.googleapis.com/v1/accounts/${ADMOB_ACCOUNT_ID}/networkReport:generate`,
    body,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  // Parse streaming response rows
  const metrics: AdUnitMetrics[] = [];
  for (const row of data) {
    if (!row.row) continue;
    const adUnitId    = row.row.dimensionValues?.AD_UNIT?.value ?? 'unknown';
    const country     = row.row.dimensionValues?.COUNTRY?.value ?? 'unknown';
    const impressions = parseInt(row.row.metricValues?.IMPRESSIONS?.integerValue ?? '0');
    const earningsMicros = parseInt(row.row.metricValues?.ESTIMATED_EARNINGS?.microsValue ?? '0');
    const earningsUSD = earningsMicros / 1_000_000;
    const eCPM = impressions > 0 ? (earningsUSD / impressions) * 1000 : 0;
    metrics.push({ adUnitId, country, impressions, estimatedEarningsUSD: earningsUSD, eCPM });
  }

  return metrics;
}

// ─── Dynamic Coin Reward Calculator ────────────────────────────────────────
//
// The idea: instead of a hardcoded 30 coins per ad,
// calculate a fair reward based on your actual eCPM.
//
// Formula:
//   yourNetPerAd = (eCPM / 1000) * ADMOB_REVENUE_SHARE
//   coinReward   = floor(yourNetPerAd / COIN_VALUE_USD * REWARD_MULTIPLIER)
//
// REWARD_MULTIPLIER controls generosity:
//   1.0 = break even on ad revenue
//   0.5 = keep 50% of ad revenue as profit, give rest as coins
//   2.0 = give users 2× the ad value (loss-leader for retention)

const ADMOB_REVENUE_SHARE  = 0.68;  // Google keeps 32%, you get 68%
const COIN_VALUE_USD       = 0.001; // 1 coin = $0.001 (1000 coins = $1)
const REWARD_MULTIPLIER    = 1.5;   // give users 1.5× ad value — good for retention
const MIN_COINS_PER_AD     = 5;     // floor — never give less than this
const MAX_COINS_PER_AD     = 50;    // ceiling — never give more than this
const DEFAULT_ECPM_USD     = 2.0;   // fallback if no data yet (conservative for Nigeria)

export interface CoinRewardConfig {
  country:         string;
  eCPM:            number;
  yourNetPerAdUSD: number;
  coinsPerAd:      number;
  lastUpdated:     string;
}

// In-memory cache — updated nightly via cron
let rewardCache: Record<string, CoinRewardConfig> = {};
let cacheUpdatedAt: Date | null = null;

export function calculateCoinsForEcpm(eCPM: number): number {
  const netPerAd = (eCPM / 1000) * ADMOB_REVENUE_SHARE;
  const raw = Math.floor((netPerAd / COIN_VALUE_USD) * REWARD_MULTIPLIER);
  return Math.min(MAX_COINS_PER_AD, Math.max(MIN_COINS_PER_AD, raw));
}

export async function refreshRewardCache(): Promise<void> {
  try {
    const metrics = await fetchAdMobEcpm(7);

    // Group by country, average eCPM across ad units
    const byCountry: Record<string, { totalECPM: number; count: number }> = {};
    for (const m of metrics) {
      if (!byCountry[m.country]) byCountry[m.country] = { totalECPM: 0, count: 0 };
      byCountry[m.country].totalECPM += m.eCPM;
      byCountry[m.country].count     += 1;
    }

    rewardCache = {};
    for (const [country, data] of Object.entries(byCountry)) {
      const avgECPM = data.totalECPM / data.count;
      const coins   = calculateCoinsForEcpm(avgECPM);
      rewardCache[country] = {
        country,
        eCPM:            parseFloat(avgECPM.toFixed(4)),
        yourNetPerAdUSD: parseFloat(((avgECPM / 1000) * ADMOB_REVENUE_SHARE).toFixed(6)),
        coinsPerAd:      coins,
        lastUpdated:     new Date().toISOString(),
      };
    }

    cacheUpdatedAt = new Date();
    console.log(`Ad reward cache updated: ${Object.keys(rewardCache).length} countries`);
  } catch (err) {
    console.error('Failed to refresh ad reward cache:', err);
    // Don't crash — keep using existing cache or defaults
  }
}

// Get coin reward for a specific country (called when user watches ad)
export function getCoinsForCountry(countryCode: string): number {
  const config = rewardCache[countryCode] ?? rewardCache['NG'] ?? null;
  if (!config) {
    // No data yet — use default eCPM for Nigeria
    return calculateCoinsForEcpm(DEFAULT_ECPM_USD);
  }
  return config.coinsPerAd;
}

// Get full reward table (for admin dashboard)
export function getFullRewardTable(): CoinRewardConfig[] {
  return Object.values(rewardCache).sort((a, b) => b.eCPM - a.eCPM);
}

export function getCacheAge(): string {
  if (!cacheUpdatedAt) return 'never';
  const mins = Math.floor((Date.now() - cacheUpdatedAt.getTime()) / 60000);
  return `${mins} minutes ago`;
}

// ─── Example reward table at different eCPMs ─────────────────────────────
//
// Country | eCPM    | Your net/ad | Coins given | Your profit/ad
// --------|---------|-------------|-------------|---------------
// US      | $12.00  | $0.00816    | 12 coins    | $0.00272
// UK      | $8.00   | $0.00544    | 8 coins     | $0.00181
// Nigeria | $2.00   | $0.00136    | 5 coins     | $0.00045  (hits floor)
// India   | $1.50   | $0.00102    | 5 coins     | $0.00034  (hits floor)
//
// At MIN_COINS=5, Nigerian users cost you ~$0.005/ad in coin liability
// vs earning you $0.00136. You're subsidising by ~3.7× at default settings.
// This is intentional — coins keep users engaged until they buy packs.
