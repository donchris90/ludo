// src/services/monetizationService.ts
import { Wallet, Transaction, User, DailyClaim } from '../models';
import { sequelize } from '../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';

// ── Economy Config (single source of truth) ────────────────────────────────
export const ECONOMY = {
  SIGNUP_COINS:          1000,
  DAILY_LOGIN_COINS:     50,
  DAILY_FIRST_WIN_COINS: 100,
  AD_COINS_PER_WATCH:    30,
  MAX_ADS_PER_DAY:       5,
  AD_PLATFORM_CUT_PCT:   65,  // you keep 65% of ad revenue
  REFERRAL_COINS:        200, // both referrer and new user get this

  // Room entry costs
  ROOM_COSTS: {
    casual:      50,
    competitive: 200,
    tournament:  500,
  },

  // Platform fee on real-money games
  PLATFORM_FEE_PCT: 10,
};

// ── Coin Pack definitions ──────────────────────────────────────────────────
export const COIN_PACKS = [
  { id: 'starter', name: 'Starter Pack', coins: 500, bonus: 0, priceNGN: 1500, priceUSD: 0.99 },
  { id: 'popular', name: 'Popular Pack', coins: 3000, bonus: 500, priceNGN: 7500, priceUSD: 4.99 },
  { id: 'pro', name: 'Pro Pack', coins: 8000, bonus: 2000, priceNGN: 15000, priceUSD: 9.99 },
  { id: 'whale', name: 'Whale Pack', coins: 25000, bonus: 7500, priceNGN: 37500, priceUSD: 24.99 },
];

class MonetizationService {

  // ── Signup bonus ───────────────────────────────────────────────────────────
  async grantSignupBonus(userId: string): Promise<void> {
    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId } });
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.increment('coinBalance', { by: ECONOMY.SIGNUP_COINS, transaction: t });
      await Transaction.create({
        userId, 
        type: 'coin_earn', 
        currency: 'COIN',
        amount: ECONOMY.SIGNUP_COINS, 
        status: 'confirmed',
        reference: `SIGNUP_${userId}`,
        metadata: { reason: 'signup_bonus' },
      }, { transaction: t });
      await t.commit();
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Get user's current coin balance ────────────────────────────────────────
  async getUserBalance(userId: string): Promise<number> {
    const wallet = await Wallet.findOne({ where: { userId } });
    return wallet ? Number(wallet.coinBalance) : 0;
  }

  // ── Get ad status for user ─────────────────────────────────────────────────
  async getAdStatus(userId: string): Promise<{
    adsWatchedToday: number;
    adsRemaining: number;
    maxAdsPerDay: number;
    coinsPerAd: number;
  }> {
    const today = new Date().toISOString().split('T')[0];
    
    const dailyClaim = await DailyClaim.findOne({
      where: { userId, date: today },
    });
    
    const adsWatched = dailyClaim?.adsWatched || 0;
    
    return {
      adsWatchedToday: adsWatched,
      adsRemaining: Math.max(0, ECONOMY.MAX_ADS_PER_DAY - adsWatched),
      maxAdsPerDay: ECONOMY.MAX_ADS_PER_DAY,
      coinsPerAd: ECONOMY.AD_COINS_PER_WATCH,
    };
  }

  // ── Daily login bonus ──────────────────────────────────────────────────────
  async claimDailyLogin(userId: string): Promise<{ coins: number; alreadyClaimed: boolean; newBalance: number }> {
    const today = new Date().toISOString().split('T')[0];
    const ref = `DAILY_LOGIN_${userId}_${today}`;

    const existing = await Transaction.findOne({ where: { reference: ref } });
    if (existing) {
      const balance = await this.getUserBalance(userId);
      return { coins: 0, alreadyClaimed: true, newBalance: balance };
    }

    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.increment('coinBalance', { by: ECONOMY.DAILY_LOGIN_COINS, transaction: t });
      await Transaction.create({
        userId, type: 'coin_earn', currency: 'COIN',
        amount: ECONOMY.DAILY_LOGIN_COINS, status: 'confirmed',
        reference: ref, metadata: { reason: 'daily_login', date: today },
      }, { transaction: t });
      
      // Update or create daily claim
      await DailyClaim.upsert({
        userId,
        date: today,
        loginClaimed: true,
      }, { transaction: t });
      
      await t.commit();
      const newBalance = await this.getUserBalance(userId);
      return { coins: ECONOMY.DAILY_LOGIN_COINS, alreadyClaimed: false, newBalance };
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── First win of the day bonus ─────────────────────────────────────────────
  async claimFirstWinBonus(userId: string): Promise<{ coins: number; alreadyClaimed: boolean; newBalance: number }> {
    const today = new Date().toISOString().split('T')[0];
    const ref = `FIRST_WIN_${userId}_${today}`;

    const existing = await Transaction.findOne({ where: { reference: ref } });
    if (existing) {
      const balance = await this.getUserBalance(userId);
      return { coins: 0, alreadyClaimed: true, newBalance: balance };
    }

    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.increment('coinBalance', { by: ECONOMY.DAILY_FIRST_WIN_COINS, transaction: t });
      await Transaction.create({
        userId, type: 'coin_earn', currency: 'COIN',
        amount: ECONOMY.DAILY_FIRST_WIN_COINS, status: 'confirmed',
        reference: ref, metadata: { reason: 'first_win', date: today },
      }, { transaction: t });
      
      // Update or create daily claim
      await DailyClaim.upsert({
        userId,
        date: today,
        firstWinClaimed: true,
      }, { transaction: t });
      
      await t.commit();
      const newBalance = await this.getUserBalance(userId);
      return { coins: ECONOMY.DAILY_FIRST_WIN_COINS, alreadyClaimed: false, newBalance };
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Ad reward (called from webhook after AdMob confirms completion) ─────────
  async rewardAdWatch(userId: string, adUnitId: string, sessionId: string): Promise<{ coins: number; error?: string; newBalance?: number }> {
    const today = new Date().toISOString().split('T')[0];

    // Check daily limit using DailyClaim
    let dailyClaim = await DailyClaim.findOne({
      where: { userId, date: today },
    });
    
    const adsWatched = dailyClaim?.adsWatched || 0;
    if (adsWatched >= ECONOMY.MAX_ADS_PER_DAY) {
      return { coins: 0, error: 'daily_limit_reached' };
    }

    // Idempotency: same session shouldn't reward twice
    const existing = await Transaction.findOne({
      where: { reference: `AD_${sessionId}` },
    });
    if (existing) {
      const balance = await this.getUserBalance(userId);
      return { coins: 0, error: 'already_rewarded', newBalance: balance };
    }

    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.increment('coinBalance', { by: ECONOMY.AD_COINS_PER_WATCH, transaction: t });
      await Transaction.create({
        userId, type: 'coin_earn', currency: 'COIN',
        amount: ECONOMY.AD_COINS_PER_WATCH, status: 'confirmed',
        reference: `AD_${sessionId}`,
        metadata: { reason: 'ad_watch', date: today, adUnitId },
      }, { transaction: t });
      
      // Update or create daily claim for ads watched
      if (dailyClaim) {
        dailyClaim.adsWatched = adsWatched + 1;
        await dailyClaim.save({ transaction: t });
      } else {
        await DailyClaim.create({
          userId,
          date: today,
          adsWatched: 1,
        }, { transaction: t });
      }
      
      await t.commit();
      const newBalance = await this.getUserBalance(userId);
      return { coins: ECONOMY.AD_COINS_PER_WATCH, newBalance };
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Deduct coins for game entry ────────────────────────────────────────────
  async deductGameEntry(userId: string, gameId: string, gameMode: string): Promise<{ success: boolean; error?: string; newBalance?: number }> {
    const cost = ECONOMY.ROOM_COSTS[gameMode as keyof typeof ECONOMY.ROOM_COSTS];
    if (!cost) return { success: true }; // real money game, handled separately

    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet || Number(wallet.coinBalance) < cost) {
      return { success: false, error: 'insufficient_coins' };
    }

    const t = await sequelize.transaction();
    try {
      await wallet.decrement('coinBalance', { by: cost, transaction: t });
      await Transaction.create({
        userId, type: 'stake', currency: 'COIN',
        amount: cost, status: 'confirmed',
        reference: `ENTRY_${gameId}_${userId}`,
        gameId, metadata: { gameMode },
      }, { transaction: t });
      await t.commit();
      const newBalance = Number(wallet.coinBalance) - cost;
      return { success: true, newBalance };
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Pay coin game winner ───────────────────────────────────────────────────
  async payCoinWinner(winnerId: string, gameId: string, potCoins: number): Promise<void> {
    const platformCut = Math.floor(potCoins * (ECONOMY.PLATFORM_FEE_PCT / 100));
    const prize = potCoins - platformCut;

    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId: winnerId }, transaction: t });
      if (!wallet) throw new Error('Winner wallet not found');
      
      await wallet.increment('coinBalance', { by: prize, transaction: t });
      await Transaction.create({
        userId: winnerId, type: 'prize', currency: 'COIN',
        amount: prize, fee: platformCut, status: 'confirmed',
        reference: `PRIZE_${gameId}`, gameId,
        metadata: { potCoins, platformCut },
      }, { transaction: t });
      await t.commit();
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Purchase coin pack ─────────────────────────────────────────────────────
  async fulfillCoinPack(userId: string, packId: string, paymentRef: string): Promise<{ coins: number; newBalance: number }> {
    const pack = COIN_PACKS.find(p => p.id === packId);
    if (!pack) throw new Error('Invalid pack ID');

    // Idempotency
    const existing = await Transaction.findOne({ where: { reference: paymentRef } });
    if (existing) {
      const balance = await this.getUserBalance(userId);
      return { coins: pack.coins + pack.bonus, newBalance: balance };
    }

    const totalCoins = pack.coins + pack.bonus;
    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.increment('coinBalance', { by: totalCoins, transaction: t });
      await Transaction.create({
        userId, type: 'coin_purchase', currency: 'COIN',
        amount: totalCoins, status: 'confirmed',
        reference: paymentRef,
        metadata: { packId, packName: pack.name, baseCoins: pack.coins, bonusCoins: pack.bonus },
      }, { transaction: t });
      await t.commit();
      const newBalance = await this.getUserBalance(userId);
      return { coins: totalCoins, newBalance };
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Confirm coin pack purchase (after webhook) ─────────────────────────────
  async confirmCoinPackPurchase(reference: string, userId: string): Promise<{ success: boolean; alreadyProcessed: boolean; coins?: number; newBalance?: number }> {
    const existingTx = await Transaction.findOne({ where: { reference } });
    if (existingTx) {
      const balance = await this.getUserBalance(userId);
      return { success: true, alreadyProcessed: true, newBalance: balance };
    }
    
    // Parse packId from reference (format: PACK_{packId}_{userId}_{timestamp})
    const packId = reference.split('_')[1];
    if (!packId) throw new Error('Invalid reference format');
    
    const result = await this.fulfillCoinPack(userId, packId, reference);
    return { success: true, alreadyProcessed: false, coins: result.coins, newBalance: result.newBalance };
  }

  // ── Referral bonus ─────────────────────────────────────────────────────────
  async processReferral(newUserId: string, referralCode: string): Promise<void> {
    const referrer = await User.findOne({ where: { referralCode } });
    if (!referrer) return;

    // Check if already processed
    const existing = await Transaction.findOne({
      where: { reference: `REFERRAL_${newUserId}_${referrer.id}` },
    });
    if (existing) return;

    const t = await sequelize.transaction();
    try {
      // Reward both users
      for (const uid of [referrer.id, newUserId]) {
        const wallet = await Wallet.findOne({ where: { userId: uid }, transaction: t });
        if (wallet) {
          await wallet.increment('coinBalance', { by: ECONOMY.REFERRAL_COINS, transaction: t });
          await Transaction.create({
            userId: uid, type: 'coin_earn', currency: 'COIN',
            amount: ECONOMY.REFERRAL_COINS, status: 'confirmed',
            reference: `REFERRAL_${newUserId}_${uid}`,
            metadata: { reason: 'referral', newUserId, referrerId: referrer.id },
          }, { transaction: t });
        }
      }
      await t.commit();
    } catch (e) { 
      await t.rollback(); 
      throw e; 
    }
  }

  // ── Revenue stats (admin use) ──────────────────────────────────────────────
  async getDailyRevenue(date: string): Promise<{
    adImpressions: number;
    adRevenue: number;
    coinPackRevenue: number;
    totalRevenue: number;
  }> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const adTxs = await Transaction.count({
      where: {
        type: 'coin_earn',
        createdAt: { [Op.between]: [start, end] },
        metadata: { reason: 'ad_watch' } as any,
      },
    });

    // Estimate: each ad pays ~$0.01, you keep AD_PLATFORM_CUT_PCT%
    const adRevenue = adTxs * 0.01 * (ECONOMY.AD_PLATFORM_CUT_PCT / 100);
    
    // Coin pack revenue from purchases
    const packTxs = await Transaction.findAll({
      where: {
        type: 'coin_purchase',
        status: 'confirmed',
        createdAt: { [Op.between]: [start, end] },
      },
    });
    
    let coinPackRevenue = 0;
    for (const tx of packTxs) {
      const metadata = tx.metadata as any;
      const pack = COIN_PACKS.find(p => p.id === metadata?.packId);
      if (pack) {
        coinPackRevenue += pack.priceUSD;
      }
    }

    return {
      adImpressions:   adTxs,
      adRevenue:       parseFloat(adRevenue.toFixed(2)),
      coinPackRevenue: parseFloat(coinPackRevenue.toFixed(2)),
      totalRevenue:    parseFloat((adRevenue + coinPackRevenue).toFixed(2)),
    };
  }
}

export const monetizationService = new MonetizationService();