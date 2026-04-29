// src/routes/tournament.ts
import { Router, Response } from 'express';
import { Tournament } from '../models';
import { AuthRequest } from '../middleware/auth';

const router = Router();

router.get('/active', async (req: AuthRequest, res: Response) => {
  try {
    const tournaments = await Tournament.findAll({
      where: { status: 'registering' },
      order: [['startTime', 'ASC']],
    });
    res.json({ tournaments });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;