// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, Wallet, Transaction } from '../models';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';
const SIGNUP_BONUS = 500; // Free coins for new users

// Register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { username, email, phone, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'Username, email, and password are required' });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const existingUsername = await User.findOne({ where: { username } });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const referralCode = username.toUpperCase().slice(0, 4) + Math.random().toString(36).substring(2, 6).toUpperCase();

    const user = await User.create({
      username,
      email,
      phone: phone || null,
      passwordHash,
      referralCode,
      country: 'NGA',
      elo: 1000,
      totalWins: 0,
      totalGames: 0,
    });

    // Create wallet with 500 coins signup bonus
    const wallet = await Wallet.create({
      userId: user.id,
      coinBalance: SIGNUP_BONUS,
      nairaBalance: 0,
      usdtBalance: 0,
      usdcBalance: 0,
      btcBalance: 0,
    });

    console.log(`✅ User ${username} registered with ${wallet.coinBalance} coins`);

    // Record signup bonus transaction
    await Transaction.create({
      userId: user.id,
      type: 'coin_earn',
      currency: 'COIN',
      amount: SIGNUP_BONUS,
      status: 'confirmed',
      reference: `SIGNUP_BONUS_${user.id}`,
      metadata: { reason: 'signup_bonus', amount: SIGNUP_BONUS },
    });

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

    const userData = user.toJSON();
    delete userData.passwordHash;

    // Return user with wallet data
    const responseData = {
      user: {
        ...userData,
        wallet: {
          coinBalance: wallet.coinBalance,
          nairaBalance: wallet.nairaBalance,
          usdtBalance: wallet.usdtBalance,
          usdcBalance: wallet.usdcBalance,
          btcBalance: wallet.btcBalance,
        }
      },
      token
    };

    res.status(201).json(responseData);
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({
      where: { email },
      include: [{ model: Wallet, as: 'wallet' }]
    });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });

    const userData = user.toJSON();
    delete userData.passwordHash;

    // Get wallet data
    const wallet = userData.wallet || { coinBalance: SIGNUP_BONUS };

    console.log(`✅ User ${userData.username} logged in with ${wallet.coinBalance} coins`);

    // Return user with wallet data
    const responseData = {
      user: {
        ...userData,
        wallet: {
          coinBalance: wallet.coinBalance,
          nairaBalance: wallet.nairaBalance || 0,
          usdtBalance: wallet.usdtBalance || 0,
          usdcBalance: wallet.usdcBalance || 0,
          btcBalance: wallet.btcBalance || 0,
        }
      },
      token
    };

    res.json(responseData);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Get current user
router.get('/me', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    const user = await User.findByPk(decoded.id, {
      include: [{ model: Wallet, as: 'wallet' }],
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = user.toJSON();
    delete userData.passwordHash;

    const wallet = userData.wallet || { coinBalance: SIGNUP_BONUS };

    res.json({
      user: {
        ...userData,
        wallet: {
          coinBalance: wallet.coinBalance,
          nairaBalance: wallet.nairaBalance || 0,
          usdtBalance: wallet.usdtBalance || 0,
          usdcBalance: wallet.usdcBalance || 0,
          btcBalance: wallet.btcBalance || 0,
        }
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

// Get wallet balance only
router.get('/wallet', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    const wallet = await Wallet.findOne({ where: { userId: decoded.id } });

    if (!wallet) {
      return res.status(404).json({ message: 'Wallet not found' });
    }

    res.json({
      coinBalance: wallet.coinBalance,
      nairaBalance: wallet.nairaBalance,
      usdtBalance: wallet.usdtBalance,
      usdcBalance: wallet.usdcBalance,
      btcBalance: wallet.btcBalance,
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
});

export default router;