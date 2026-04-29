// src/routes/monetization.ts
import { Router } from 'express';
import { monetizationService, COIN_PACKS, ECONOMY } from '../services/monetizationService';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// ── Daily login bonus ──────────────────────────────────────────────────────
router.post('/daily/login', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const result = await monetizationService.claimDailyLogin(userId);
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('Daily login error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── First win bonus ────────────────────────────────────────────────────────
router.post('/daily/first-win', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const result = await monetizationService.claimFirstWinBonus(userId);
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('First win bonus error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Get ad status ──────────────────────────────────────────────────────────
router.get('/ad-status', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const status = await monetizationService.getAdStatus(userId);
    res.json(status);
  } catch (e: any) {
    console.error('Ad status error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Claim ad reward ────────────────────────────────────────────────────────
router.post('/claim-ad-reward', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { adUnitId, sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId required' });
    }

    const result = await monetizationService.rewardAdWatch(userId, adUnitId, sessionId);

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }

    res.json({ success: true, coinsEarned: result.coins, newBalance: result.newBalance });
  } catch (e: any) {
    console.error('Claim ad reward error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Claim login bonus ──────────────────────────────────────────────────────
router.post('/claim-login-bonus', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const result = await monetizationService.claimDailyLogin(userId);
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('Claim login bonus error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Get available coin packs ───────────────────────────────────────────────
router.get('/packs', (req: any, res: any) => {
  res.json({ packs: COIN_PACKS });
});

// ── Get economy config ─────────────────────────────────────────────────────
router.get('/config', (req: any, res: any) => {
  res.json({
    roomCosts: ECONOMY.ROOM_COSTS,
    adCoins: ECONOMY.AD_COINS_PER_WATCH,
    maxAdsPerDay: ECONOMY.MAX_ADS_PER_DAY,
    dailyLogin: ECONOMY.DAILY_LOGIN_COINS,
    dailyFirstWin: ECONOMY.DAILY_FIRST_WIN_COINS,
    referralCoins: ECONOMY.REFERRAL_COINS,
  });
});

// ── Initiate coin pack purchase ────────────────────────────────────────────
router.post('/packs/purchase', authMiddleware, async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    const { packId } = req.body;

    const pack = COIN_PACKS.find(p => p.id === packId);
    if (!pack) {
      return res.status(400).json({ error: 'Invalid pack' });
    }

    // For now, just fulfill the pack directly (in production, use Paystack)
    const result = await monetizationService.fulfillCoinPack(userId, packId, `manual_${Date.now()}`);
    res.json({ success: true, ...result });
  } catch (e: any) {
    console.error('Purchase error:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;