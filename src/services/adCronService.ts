import cron from 'node-cron';
import {
  refreshRewardCache,
  getCoinsForCountry,
  getFullRewardTable,
  getCacheAge,
  fetchAdMobEcpm,
} from './adRevenueService';
import { monetizationService } from './monetizationService';
import { Wallet, Transaction } from '../models';
import { sequelize } from '../models';

// ─── Nightly cron: refresh eCPM data from AdMob ───────────────────────────
// Runs at 2am server time every day
export function startCronJobs() {
  cron.schedule('0 2 * * *', async () => {
    console.log('[CRON] Refreshing AdMob eCPM data...');
    await refreshRewardCache();
  });

  // Also refresh on startup
  refreshRewardCache().catch(console.error);
}

// ─── Updated ad reward handler (replaces the one in monetizationService) ──
// This version uses dynamic coins based on user's country + actual eCPM

export async function rewardAdWatchDynamic(
  userId:    string,
  adUnitId:  string,
  sessionId: string,
  country:   string  // pass from user's profile or IP lookup
): Promise<{ coins: number; error?: string }> {

  const today = new Date().toISOString().split('T')[0];

  // Count today's ad watches
  const todayCount = await Transaction.count({
    where: {
      userId,
      type: 'coin_earn',
      // Sequelize JSONB query
      ...(sequelize.getDialect() === 'postgres' ? {
        metadata: sequelize.literal(`metadata->>'reason' = 'ad_watch' AND metadata->>'date' = '${today}'`),
      } : {}),
    },
  });

  const MAX_ADS = 5;
  if (todayCount >= MAX_ADS) {
    return { coins: 0, error: 'daily_limit_reached' };
  }

  // Idempotency check
  const existing = await Transaction.findOne({ where: { reference: `AD_${sessionId}` } });
  if (existing) return { coins: 0, error: 'already_rewarded' };

  // Get dynamic coin reward based on country's eCPM
  const coinsToGive = getCoinsForCountry(country);

  const t = await sequelize.transaction();
  try {
    await Wallet.increment('coinBalance', {
      by: coinsToGive, where: { userId }, transaction: t,
    });
    await Transaction.create({
      userId, type: 'coin_earn', currency: 'COIN',
      amount: coinsToGive, status: 'confirmed',
      reference: `AD_${sessionId}`,
      metadata: {
        reason: 'ad_watch',
        date: today,
        adUnitId,
        country,
        coinsGiven: coinsToGive,
      },
    }, { transaction: t });
    await t.commit();
    return { coins: coinsToGive };
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

// ─── Admin endpoint: view eCPM + coin reward table ────────────────────────
import { Router } from 'express';
const adminRouter = Router();

// GET /api/admin/ad-revenue — shows your eCPM data and coin rewards per country
adminRouter.get('/ad-revenue', async (req, res) => {
  try {
    const table    = getFullRewardTable();
    const cacheAge = getCacheAge();

    // Also fetch raw AdMob data if requested
    const raw = req.query.raw === 'true'
      ? await fetchAdMobEcpm(parseInt(req.query.days as string ?? '7'))
      : null;

    res.json({
      cacheAge,
      summary: {
        countriesTracked: table.length,
        topEcpm:   table[0]  ?? null,
        bottomEcpm: table[table.length - 1] ?? null,
      },
      rewardTable: table,
      rawMetrics: raw,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/ad-revenue/today — today's estimated revenue
adminRouter.get('/ad-revenue/today', async (req, res) => {
  try {
    const today  = new Date().toISOString().split('T')[0];
    const stats  = await monetizationService.getDailyRevenue(today);
    const table  = getFullRewardTable();

    // Coins paid out today
    const coinsPaidOut = await Transaction.sum('amount', {
      where: {
        type: 'coin_earn',
        createdAt: { $gte: new Date(today) } as any,
        metadata: sequelize.literal(`metadata->>'reason' = 'ad_watch'`) as any,
      },
    }) as number ?? 0;

    res.json({
      date: today,
      ...stats,
      coinsPaidOut,
      coinsPaidOutUSD: parseFloat((coinsPaidOut * 0.001).toFixed(4)), // 1 coin = $0.001
      margin: parseFloat((stats.adRevenue - coinsPaidOut * 0.001).toFixed(4)),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export { adminRouter };
