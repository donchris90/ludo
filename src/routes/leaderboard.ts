// src/routes/leaderboard.ts
import { Router, Request, Response } from 'express';
import { User } from '../models';
import { Op } from 'sequelize';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const { sortBy = 'wins' } = req.query;

    let order: any = [];
    if (sortBy === 'wins') order = [['totalWins', 'DESC']];
    else if (sortBy === 'games') order = [['totalGames', 'DESC']];
    else if (sortBy === 'elo') order = [['elo', 'DESC']];
    else order = [['totalWins', 'DESC']];

    const users = await User.findAll({
      attributes: ['id', 'username', 'elo', 'totalWins', 'totalGames', 'country'],
      where: { isBanned: false },
      order,
      limit: 100,
    });

    const leaderboard = users.map(user => ({
      id: user.id,
      username: user.username,
      elo: user.elo,
      totalWins: user.totalWins,
      totalGames: user.totalGames,
      winRate: user.totalGames > 0 ? Math.round((user.totalWins / user.totalGames) * 100) : 0,
      country: user.country,
    }));

    res.json({ users: leaderboard });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;