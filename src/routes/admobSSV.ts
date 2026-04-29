// src/routes/admobssv.ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import axios from 'axios';

const router = Router();

// Google's public keys URL
const GOOGLE_KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';

interface GoogleKey {
  keyId: number;
  pem: string;
}

let googleKeysCache: GoogleKey[] = [];
let googleKeysCachedAt = 0;

async function getGooglePublicKeys(): Promise<GoogleKey[]> {
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  if (Date.now() - googleKeysCachedAt < CACHE_TTL && googleKeysCache.length > 0) {
    return googleKeysCache;
  }
  try {
    const { data } = await axios.get(GOOGLE_KEYS_URL);
    googleKeysCache = data.keys;
    googleKeysCachedAt = Date.now();
  } catch (error) {
    console.warn('Failed to fetch Google keys, using cached');
  }
  return googleKeysCache;
}

function verifyGoogleSignature(
  queryString: string,
  signature: string,
  publicKeyPem: string
): boolean {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(queryString);
    verify.end();
    return verify.verify(publicKeyPem, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

// AdMob SSV callback - Google calls this via GET
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const {
      ad_network,
      ad_unit_id,
      custom_data,
      key_id,
      reward_amount,
      reward_item,
      timestamp,
      transaction_id,
      user_id,
      signature,
    } = req.query as Record<string, string>;

    // Skip verification in development
    if (process.env.NODE_ENV !== 'production') {
      console.log('Dev mode: skipping SSV verification');
      const { Wallet, Transaction, DailyClaim } = await import('../models');
      
      const [userId, country = 'NG'] = (custom_data ?? '').split(':');
      const COINS_PER_AD = 30;
      const today = new Date().toISOString().split('T')[0];
      
      if (userId) {
        const wallet = await Wallet.findOne({ where: { userId } });
        if (wallet) {
          let dailyClaim = await DailyClaim.findOne({ where: { userId, date: today } });
          const adsWatched = dailyClaim?.adsWatched || 0;
          
          if (adsWatched < 5) {
            wallet.coinBalance = Number(wallet.coinBalance) + COINS_PER_AD;
            await wallet.save();
            
            await Transaction.create({
              userId,
              type: 'coin_earn',
              currency: 'COIN',
              amount: COINS_PER_AD,
              status: 'confirmed',
              reference: `ad_${userId}_${Date.now()}`,
              metadata: { reason: 'ad_watch', ad_unit: ad_unit_id },
            });
            
            if (dailyClaim) {
              dailyClaim.adsWatched = adsWatched + 1;
              await dailyClaim.save();
            } else {
              await DailyClaim.create({ userId, date: today, adsWatched: 1 });
            }
          }
        }
      }
      
      return res.status(200).send('OK');
    }

    // Production verification
    const rawQuery = req.url.split('?')[1] ?? '';
    const queryWithoutSig = rawQuery.replace(/&signature=[^&]+$/, '');

    const keys = await getGooglePublicKeys();
    const key = keys.find(k => k.keyId === parseInt(key_id));

    if (!key) {
      console.error(`SSV: Unknown key_id ${key_id}`);
      return res.status(400).send('Unknown key');
    }

    const valid = verifyGoogleSignature(queryWithoutSig, signature!, key.pem);
    if (!valid) {
      console.error('SSV: Invalid signature');
      return res.status(400).send('Invalid signature');
    }

    const [userId, country = 'NG'] = (custom_data ?? '').split(':');
    if (!userId) {
      console.error('SSV: No userId in custom_data');
      return res.status(400).send('Missing userId');
    }

    const { Wallet, Transaction, DailyClaim } = await import('../models');
    const COINS_PER_AD = 30;
    const today = new Date().toISOString().split('T')[0];

    const wallet = await Wallet.findOne({ where: { userId } });
    if (wallet) {
      let dailyClaim = await DailyClaim.findOne({ where: { userId, date: today } });
      const adsWatched = dailyClaim?.adsWatched || 0;
      
      if (adsWatched < 5) {
        wallet.coinBalance = Number(wallet.coinBalance) + COINS_PER_AD;
        await wallet.save();
        
        await Transaction.create({
          userId,
          type: 'coin_earn',
          currency: 'COIN',
          amount: COINS_PER_AD,
          status: 'confirmed',
          reference: transaction_id || `ad_${userId}_${Date.now()}`,
          metadata: { reason: 'ad_watch', ad_unit: ad_unit_id, timestamp },
        });
        
        if (dailyClaim) {
          dailyClaim.adsWatched = adsWatched + 1;
          await dailyClaim.save();
        } else {
          await DailyClaim.create({ userId, date: today, adsWatched: 1 });
        }
      }
    }

    console.log(`SSV: Rewarded userId=${userId} coins=${COINS_PER_AD}`);
    res.status(200).send('OK');

  } catch (error) {
    console.error('SSV error:', error);
    res.status(200).send('OK');
  }
});

export default router;