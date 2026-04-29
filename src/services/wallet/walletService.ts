// src/services/wallet/walletService.ts
import { Wallet, Transaction, User } from '../../models';
import { paystackService } from '../payment/paystack';
import { sequelize } from '../../models';
import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';

export type Currency = 'NGN' | 'USDT' | 'USDC' | 'BTC' | 'COIN';

const PLATFORM_FEE_PERCENT = 10;

class WalletService {

  async getWallet(userId: string) {
    return Wallet.findOne({ where: { userId } });
  }

  async getBalance(userId: string) {
    const wallet = await this.getWallet(userId);
    return {
      nairaBalance: Number(wallet?.nairaBalance || 0),
      usdtBalance: Number(wallet?.usdtBalance || 0),
      usdcBalance: Number(wallet?.usdcBalance || 0),
      btcBalance: Number(wallet?.btcBalance || 0),
      coinBalance: Number(wallet?.coinBalance || 0),
    };
  }

  // ─── NAIRA DEPOSIT via Paystack ──────────────────────────
  async initNairaDeposit(userId: string, amountKobo: number) {
    const user = await User.findByPk(userId);
    if (!user) throw new Error('User not found');

    const reference = `NGN_DEP_${uuidv4()}`;

    const paystackRes = await paystackService.initializeTransaction({
      email: (user as any).email,
      amount: amountKobo,
      reference,
      metadata: { userId, type: 'deposit' },
      callback_url: `${process.env.APP_DEEP_LINK || 'ludoapp://'}/wallet/confirm`,
    });

    await Transaction.create({
      userId, type: 'deposit', currency: 'NGN',
      amount: amountKobo / 100,
      status: 'pending', reference,
    });

    return { authorizationUrl: paystackRes.authorization_url, reference };
  }

  async confirmNairaDeposit(reference: string) {
    const tx = await Transaction.findOne({ where: { reference } }) as any;
    if (!tx || tx.status !== 'pending') throw new Error('Invalid transaction');

    const verified = await paystackService.verifyTransaction(reference);
    if (verified.status !== 'success') throw new Error('Payment not successful');

    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId: tx.userId }, transaction: t });
      if (wallet) {
        await wallet.increment('nairaBalance', { by: tx.amount, transaction: t });
      }
      await tx.update({ status: 'confirmed' }, { transaction: t });
      await t.commit();
      return { success: true, amount: tx.amount };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // ─── NAIRA WITHDRAWAL ────────────────────────────────────
  async withdrawNaira(userId: string, amountNaira: number, bankDetails: object) {
    const wallet = await this.getWallet(userId) as any;
    if (!wallet || Number(wallet.nairaBalance) < amountNaira) throw new Error('Insufficient balance');

    const reference = `NGN_WDR_${uuidv4()}`;
    const fee = amountNaira * 0.015; // 1.5% withdrawal fee
    const netAmount = amountNaira - fee;

    const t = await sequelize.transaction();
    try {
      await wallet.decrement('nairaBalance', { by: amountNaira, transaction: t });
      await Transaction.create({
        userId, type: 'withdrawal', currency: 'NGN',
        amount: amountNaira, fee, status: 'pending', reference,
        metadata: { bankDetails, netAmount },
      }, { transaction: t });

      if (paystackService.initiateTransfer) {
        await paystackService.initiateTransfer(netAmount * 100, bankDetails, reference);
      }
      await t.commit();
      return { reference, netAmount };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // ─── CRYPTO DEPOSIT ADDRESS (Mock - No real crypto) ──────────────────────────────
  async getCryptoDepositAddress(userId: string, currency: 'USDT' | 'USDC' | 'BTC') {
    const wallet = await this.getWallet(userId) as any;
    if (!wallet) throw new Error('Wallet not found');

    if (currency === 'BTC') {
      if (!wallet.btcAddress) {
        // Mock BTC address generation
        const address = `bc1${userId.slice(0, 8)}${Math.random().toString(36).substring(2, 10)}`;
        await wallet.update({ btcAddress: address });
        return { address, currency: 'BTC', network: 'Bitcoin' };
      }
      return { address: wallet.btcAddress, currency: 'BTC', network: 'Bitcoin' };
    }

    // USDT and USDC use ERC-20 (same ETH address) - Mock generation
    if (!wallet.ethAddress) {
      const address = `0x${userId.slice(0, 8)}${Math.random().toString(36).substring(2, 34)}`;
      await wallet.update({ ethAddress: address });
    }
    return {
      address: wallet.ethAddress,
      currency,
      network: 'ERC-20 (Ethereum)',
      contractNote: currency === 'USDT'
        ? 'Send USDT (ERC-20) only'
        : 'Send USDC (ERC-20) only',
    };
  }

  // ─── CRYPTO WITHDRAWAL (Mock - No real crypto) ───────────────────────────────────
  async withdrawCrypto(userId: string, currency: 'USDT' | 'USDC' | 'BTC', amount: number, toAddress: string) {
    const wallet = await this.getWallet(userId) as any;
    const balanceField = `${currency.toLowerCase()}Balance`;
    if (!wallet || Number(wallet[balanceField]) < amount) throw new Error('Insufficient balance');

    const reference = `${currency}_WDR_${uuidv4()}`;
    const fee = 0.001; // Mock fee

    const t = await sequelize.transaction();
    try {
      await wallet.decrement(balanceField as any, { by: amount, transaction: t });
      const txHash = `0x${Math.random().toString(36).substring(2, 66)}`;
      await Transaction.create({
        userId, type: 'withdrawal', currency,
        amount, fee, status: 'confirmed', reference,
        metadata: { toAddress, txHash },
      }, { transaction: t });
      await t.commit();
      return { txHash, reference };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // ─── STAKE (lock funds for game) ─────────────────────────
  async stakeForGame(userId: string, gameId: string, currency: Currency, amount: number) {
    const wallet = await this.getWallet(userId) as any;
    const balanceField = this.getBalanceField(currency);
    if (Number(wallet[balanceField]) < amount) throw new Error('Insufficient balance');

    const t = await sequelize.transaction();
    try {
      await wallet.decrement(balanceField as any, { by: amount, transaction: t });
      await Transaction.create({
        userId, type: 'stake', currency, amount,
        status: 'confirmed', reference: `STAKE_${gameId}_${userId}`, gameId,
      }, { transaction: t });
      await t.commit();
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // ─── PAY WINNER ──────────────────────────────────────────
  async payWinner(winnerId: string, gameId: string, currency: Currency, potAmount: number) {
    const platformCut = potAmount * (PLATFORM_FEE_PERCENT / 100);
    const winnerPrize = potAmount - platformCut;
    const balanceField = this.getBalanceField(currency);

    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId: winnerId }, transaction: t });
      if (wallet) {
        await wallet.increment(balanceField as any, { by: winnerPrize, transaction: t });
      }
      await Transaction.create({
        userId: winnerId, type: 'prize', currency,
        amount: winnerPrize, fee: platformCut,
        status: 'confirmed', reference: `PRIZE_${gameId}`, gameId,
      }, { transaction: t });
      await t.commit();
      return { winnerPrize, platformCut };
    } catch (err) {
      await t.rollback();
      throw err;
    }
  }

  // ─── ADD COINS (for ad rewards, daily bonuses) ───────────
  async addCoins(userId: string, amount: number, reason: string) {
    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
      if (!wallet) throw new Error('Wallet not found');
      
      await wallet.increment('coinBalance', { by: amount, transaction: t });
      
      await Transaction.create({
        userId,
        type: 'coin_earn',
        currency: 'COIN',
        amount,
        status: 'confirmed',
        reference: `${reason}_${userId}_${Date.now()}`,
        metadata: { reason },
      }, { transaction: t });
      
      await t.commit();
      return { success: true, newBalance: Number(wallet.coinBalance) + amount };
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  // ─── DEDUCT COINS (for game entry) ───────────────────────
  async deductCoins(userId: string, amount: number, reason: string) {
    const t = await sequelize.transaction();
    try {
      const wallet = await Wallet.findOne({ where: { userId }, transaction: t });
      if (!wallet) throw new Error('Wallet not found');
      
      if (Number(wallet.coinBalance) < amount) {
        throw new Error('Insufficient coins');
      }
      
      await wallet.decrement('coinBalance', { by: amount, transaction: t });
      
      await Transaction.create({
        userId,
        type: 'stake',
        currency: 'COIN',
        amount,
        status: 'confirmed',
        reference: `${reason}_${userId}_${Date.now()}`,
        metadata: { reason },
      }, { transaction: t });
      
      await t.commit();
      return { success: true, newBalance: Number(wallet.coinBalance) - amount };
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  private getBalanceField(currency: Currency): string {
    const map: Record<Currency, string> = {
      NGN: 'nairaBalance', USDT: 'usdtBalance',
      USDC: 'usdcBalance', BTC: 'btcBalance', COIN: 'coinBalance',
    };
    return map[currency];
  }
}

export const walletService = new WalletService();
