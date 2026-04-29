// src/routes/coinRoutes.ts
import { Router, Request, Response } from 'express';

// Coin packs configuration
export const COIN_PACKS = {
  starter: { id: 'starter', name: 'Starter Pack', coins: 500, price: 0.99, currency: 'USD', bonus: 0 },
  popular: { id: 'popular', name: 'Popular Pack', coins: 3000, price: 4.99, currency: 'USD', bonus: 500 },
  best_value: { id: 'best_value', name: 'Best Value', coins: 8000, price: 9.99, currency: 'USD', bonus: 2000 },
  pro: { id: 'pro', name: 'Pro Pack', coins: 25000, price: 24.99, currency: 'USD', bonus: 7500 },
};

export const coinRouter = Router();

// Get coin packs
coinRouter.get('/packs', async (_req: Request, res: Response) => {
  res.json({ packs: Object.values(COIN_PACKS) });
});

// Get user's coin balance
coinRouter.get('/balance', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Import dynamically to avoid circular dependencies
    const { Wallet } = await import('../models');
    const wallet = await Wallet.findOne({ where: { userId } });
    res.json({ balance: wallet?.coinBalance || 0 });
  } catch (error) {
    console.error('Balance error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialize coin purchase (create Paystack payment intent)
coinRouter.post('/purchase/init', async (req: Request, res: Response) => {
  try {
    const { packId } = req.body;
    const userId = (req as any).user?.id;
    const userEmail = (req as any).user?.email;

    const pack = Object.values(COIN_PACKS).find(p => p.id === packId);
    if (!pack) {
      return res.status(400).json({ error: 'Invalid coin pack' });
    }

    // Return payment URL (implement Paystack integration)
    res.json({
      success: true,
      paymentUrl: `https://paystack.com/pay/${pack.id}_${userId}`,
      reference: `coin_${userId}_${Date.now()}`,
    });
  } catch (error) {
    console.error('Purchase init error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Confirm purchase after payment
coinRouter.post('/purchase/confirm', async (req: Request, res: Response) => {
  try {
    const { reference } = req.body;
    const userId = (req as any).user?.id;

    const { Wallet, Transaction } = await import('../models');
    const wallet = await Wallet.findOne({ where: { userId } });

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Add coins based on reference (implement actual Paystack verification)
    const coinsToAdd = 1000; // Example
    wallet.coinBalance = Number(wallet.coinBalance) + coinsToAdd;
    await wallet.save();

    await Transaction.create({
      userId,
      type: 'coin_purchase',
      currency: 'COIN',
      amount: coinsToAdd,
      status: 'confirmed',
      reference,
      metadata: { packId: 'unknown' },
    });

    res.json({ success: true, newBalance: wallet.coinBalance });
  } catch (error) {
    console.error('Purchase confirm error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Claim daily login bonus
coinRouter.post('/daily-bonus', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { Wallet, Transaction, DailyClaim } = await import('../models');

    const today = new Date().toISOString().split('T')[0];
    const LOGIN_BONUS = 50;

    let dailyClaim = await DailyClaim.findOne({
      where: { userId, date: today },
    });

    if (dailyClaim?.loginClaimed) {
      return res.status(400).json({ error: 'Already claimed today' });
    }

    const wallet = await Wallet.findOne({ where: { userId } });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    wallet.coinBalance = Number(wallet.coinBalance) + LOGIN_BONUS;
    await wallet.save();

    await Transaction.create({
      userId,
      type: 'coin_earn',
      currency: 'COIN',
      amount: LOGIN_BONUS,
      status: 'confirmed',
      reference: `daily_login_${userId}_${Date.now()}`,
      metadata: { reason: 'daily_login', date: today },
    });

    if (dailyClaim) {
      dailyClaim.loginClaimed = true;
      await dailyClaim.save();
    } else {
      await DailyClaim.create({
        userId,
        date: today,
        loginClaimed: true,
      });
    }

    res.json({ success: true, bonus: LOGIN_BONUS, newBalance: wallet.coinBalance });
  } catch (error) {
    console.error('Daily bonus error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check remaining ads for today
coinRouter.get('/ads-remaining', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { DailyClaim } = await import('../models');

    const today = new Date().toISOString().split('T')[0];
    const MAX_ADS_PER_DAY = 5;

    const dailyClaim = await DailyClaim.findOne({
      where: { userId, date: today },
    });

    const adsWatched = dailyClaim?.adsWatched || 0;
    const remaining = Math.max(0, MAX_ADS_PER_DAY - adsWatched);

    res.json({ remaining, maxAdsPerDay: MAX_ADS_PER_DAY });
  } catch (error) {
    console.error('Ads remaining error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});