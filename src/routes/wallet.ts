// src/routes/wallet.ts
import { Router, Response } from 'express';
import { Wallet, Transaction } from '../models';
import { AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/balance', async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await Wallet.findOne({ where: { userId: req.userId } });
    res.json({
      nairaBalance: Number(wallet?.nairaBalance || 0),
      usdtBalance: Number(wallet?.usdtBalance || 0),
      usdcBalance: Number(wallet?.usdcBalance || 0),
      btcBalance: Number(wallet?.btcBalance || 0),
      coinBalance: Number(wallet?.coinBalance || 0),
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/transactions', async (req: AuthRequest, res: Response) => {
  try {
    const transactions = await Transaction.findAll({
      where: { userId: req.userId },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;