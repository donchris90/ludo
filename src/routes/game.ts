// src/routes/game.ts
import { Router, Response } from 'express';
import { User, Game, Transaction } from '../models';
import { AuthRequest } from '../middleware/auth';

const router = Router();

router.post('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const { won, eloChange = 0, stakeAmount = 0, gameId } = req.body;

    const user = await User.findByPk(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.totalGames += 1;
    if (won) {
      user.totalWins += 1;
      user.elo += eloChange;

      if (stakeAmount > 0) {
        const wallet = await user.$get('wallet');
        if (wallet) {
          wallet.coinBalance = Number(wallet.coinBalance) + stakeAmount;
          await wallet.save();

          await Transaction.create({
            userId: req.userId,
            type: 'prize',
            currency: 'COIN',
            amount: stakeAmount,
            status: 'confirmed',
            reference: `prize_${Date.now()}`,
            gameId,
          });
        }
      }
    } else {
      user.elo = Math.max(0, user.elo - Math.abs(eloChange));
    }

    await user.save();

    res.json({ success: true, user: { totalWins: user.totalWins, totalGames: user.totalGames, elo: user.elo } });
  } catch (error) {
    console.error('Game stats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;