import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import { initDB } from './models';
import { initRedis } from './utils/redis';
import { setupSocketHandlers } from './socket';
import { initQueues } from './utils/queues';

import authRoutes from './routes/auth';
import walletRoutes from './routes/wallet';
import gameRoutes from './routes/game';
import leaderboardRoutes from './routes/leaderboard';
import tournamentRoutes from './routes/tournament';
import webhookRoutes from './routes/webhook';

import monetizationRouter from './routes/monetization';
import { coinRouter } from './routes/coinRoutes';
import admobssvRouter from './routes/admobSSV';
import { authMiddleware } from './middleware/auth';

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL || '*', credentials: true },
  transports: ['websocket'],
  pingTimeout: 20000,
  pingInterval: 10000,
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));

// Raw body for webhooks (must be before express.json())
app.use('/api/coins/webhook/paystack', express.raw({ type: 'application/json' }));
app.use('/api/ads/callback', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/tournament', tournamentRoutes);
app.use('/api/webhook', webhookRoutes);

// Coin economy routes - check if routers exist before using
if (coinRouter) {
  app.use('/api/coins', authMiddleware, coinRouter);
} else {
  console.warn('⚠️ coinRouter is not defined');
}

if (monetizationRouter) {
  app.use('/api/monetization', authMiddleware, monetizationRouter);
} else {
  console.warn('⚠️ monetizationRouter is not defined');
}

if (admobssvRouter) {
  app.use('/api/ads', admobssvRouter);
} else {
  console.warn('⚠️ admobssvRouter is not defined');
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await initDB();
    console.log('✅ Database initialized');

    await initRedis();
    console.log('✅ Redis initialized');

    await initQueues();
    console.log('✅ Queues initialized');

    setupSocketHandlers(io);
    console.log('✅ Socket handlers initialized');

    const PORT = process.env.PORT || 4000;
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📊 Available endpoints:`);
      console.log(`   POST   /api/auth/register`);
      console.log(`   POST   /api/auth/login`);
      console.log(`   GET    /api/leaderboard`);
      console.log(`   GET    /api/wallet/balance`);
      console.log(`   GET    /api/monetization/ad-status`);
      console.log(`   POST   /api/monetization/claim-ad-reward`);
      console.log(`   POST   /api/monetization/claim-login-bonus`);
      console.log(`   GET    /api/coins/packs`);
      console.log(`   POST   /api/ads/callback (AdMob SSV)`);
      console.log(`   WS     Socket.IO ready`);
    });
  } catch (error) {
    console.error('❌ Bootstrap failed:', error);
    process.exit(1);
  }
}

bootstrap().catch(console.error);

export { io };