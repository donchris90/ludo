// src/routes/webhook.ts
import { Router, Request, Response } from 'express';

const router = Router();

router.post('/paystack', async (req: Request, res: Response) => {
  try {
    const { event, data } = req.body;
    console.log('Paystack webhook:', event);
    res.status(200).json({ received: true });
  } catch (error) {
    res.status(500).json({ error: 'Webhook error' });
  }
});

export default router;