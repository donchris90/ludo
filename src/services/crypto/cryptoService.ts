// src/services/crypto/cryptoService.ts
import { ethers } from 'ethers';
import * as bitcoin from 'bitcoinjs-lib';
import { Wallet, Transaction } from '../../models';
import { v4 as uuidv4 } from 'uuid';

// ERC-20 ABI (minimal for USDT/USDC transfers)
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const USDT_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

class CryptoService {
  private ethProvider: ethers.JsonRpcProvider | null = null;
  private hotWallet: ethers.Wallet | null = null;
  private mockMode: boolean = true;

  constructor() {
    // Check if we have real credentials, otherwise use mock mode
    const ethRpcUrl = process.env.ETH_RPC_URL;
    const privateKey = process.env.HOT_WALLET_PRIVATE_KEY;
    
    if (ethRpcUrl && privateKey && privateKey !== 'your-private-key-here') {
      try {
        this.ethProvider = new ethers.JsonRpcProvider(ethRpcUrl);
        this.hotWallet = new ethers.Wallet(privateKey, this.ethProvider);
        this.mockMode = false;
        console.log('✅ CryptoService: Using real blockchain connections');
      } catch (error) {
        console.warn('⚠️ CryptoService: Failed to initialize real wallet, using mock mode:', error);
        this.mockMode = true;
      }
    } else {
      console.log('🔧 CryptoService: Running in mock mode (no blockchain connections)');
      this.mockMode = true;
    }
  }

  // Generate unique ETH address per user (HD wallet derivation)
  async generateEthAddress(userId: string): Promise<string> {
    if (this.mockMode) {
      // Generate mock address
      return `0x${Buffer.from(userId).toString('hex').padStart(40, '0').slice(0, 40)}`;
    }
    
    const masterMnemonic = process.env.MASTER_MNEMONIC;
    if (!masterMnemonic) throw new Error('MASTER_MNEMONIC not set');
    
    const index = await this.getUserDerivationIndex(userId);
    const wallet = ethers.HDNodeWallet.fromPhrase(masterMnemonic, undefined, `m/44'/60'/0'/0/${index}`);
    return wallet.address;
  }

  // Generate unique BTC address per user
  async generateBtcAddress(userId: string): Promise<string> {
    if (this.mockMode) {
      // Generate mock BTC address
      return `bc1${Buffer.from(userId).toString('hex').slice(0, 38)}`;
    }
    
    const network = bitcoin.networks.bitcoin;
    const masterXpub = process.env.BTC_MASTER_XPUB;
    if (!masterXpub) throw new Error('BTC_MASTER_XPUB not set');
    
    const masterKey = bitcoin.bip32.fromBase58(masterXpub, network);
    const index = await this.getUserDerivationIndex(userId);
    const child = masterKey.derive(index);
    const { address } = bitcoin.payments.p2wpkh({ pubkey: child.publicKey, network });
    return address!;
  }

  // Credit user when crypto arrives (called from webhook/blockchain listener)
  async creditCryptoDeposit(toAddress: string, currency: 'USDT' | 'USDC' | 'BTC', amount: number, txHash: string) {
    const wallet = await Wallet.findOne({
      where: currency === 'BTC'
        ? { btcAddress: toAddress }
        : { ethAddress: toAddress },
    }) as any;

    if (!wallet) throw new Error('No wallet found for address');

    const existingTx = await Transaction.findOne({ where: { reference: txHash } });
    if (existingTx) return; // idempotency

    const balanceField = `${currency.toLowerCase()}Balance`;
    await wallet.increment(balanceField, { by: amount });
    await Transaction.create({
      userId: wallet.userId, type: 'deposit', currency,
      amount, status: 'confirmed', reference: txHash,
      metadata: { toAddress, txHash },
    });
  }

  async sendCrypto(currency: 'USDT' | 'USDC' | 'BTC', toAddress: string, amount: number): Promise<string> {
    if (this.mockMode) {
      console.log(`[MOCK] Sending ${amount} ${currency} to ${toAddress}`);
      return `0x${uuidv4().replace(/-/g, '')}`;
    }
    
    if (currency === 'BTC') return this.sendBtc(toAddress, amount);
    return this.sendERC20(currency, toAddress, amount);
  }

  private async sendERC20(currency: 'USDT' | 'USDC', toAddress: string, amount: number): Promise<string> {
    if (!this.hotWallet || !this.ethProvider) {
      throw new Error('ETH wallet not initialized');
    }
    
    const contractAddress = currency === 'USDT' ? USDT_CONTRACT : USDC_CONTRACT;
    const contract = new ethers.Contract(contractAddress, ERC20_ABI, this.hotWallet);
    const decimals = await contract.decimals();
    const amountInUnits = ethers.parseUnits(amount.toString(), decimals);
    const tx = await contract.transfer(toAddress, amountInUnits);
    await tx.wait();
    return tx.hash;
  }

  private async sendBtc(toAddress: string, amount: number): Promise<string> {
    if (this.mockMode) {
      return `btc_${uuidv4().replace(/-/g, '')}`;
    }
    
    // Use a Bitcoin RPC or third-party API like BlockCypher for BTC sends
    try {
      const axios = require('axios');
      const { data } = await axios.post(`https://api.blockcypher.com/v1/btc/main/txs/new`, {
        inputs: [{ addresses: [process.env.BTC_HOT_WALLET_ADDRESS] }],
        outputs: [{ addresses: [toAddress], value: Math.floor(amount * 1e8) }],
      }, { params: { token: process.env.BLOCKCYPHER_TOKEN } });
      return data.tx.hash;
    } catch (error) {
      console.error('BTC send error:', error);
      throw new Error('BTC transaction failed');
    }
  }

  async estimateFee(currency: 'USDT' | 'USDC' | 'BTC'): Promise<number> {
    if (this.mockMode) {
      // Return mock fees
      if (currency === 'BTC') return 0.00005;
      return 5; // $5 for USDT/USDC
    }
    
    if (currency === 'BTC') return 0.00005; // ~$3 at $60k BTC
    
    if (!this.ethProvider) throw new Error('ETH provider not initialized');
    
    const feeData = await this.ethProvider.getFeeData();
    const gasLimit = 65000n; // ERC-20 transfer
    const gasCostWei = (feeData.gasPrice ?? 0n) * gasLimit;
    const gasCostEth = parseFloat(ethers.formatEther(gasCostWei));
    // Convert ETH fee to USDT/USDC equivalent (approx ETH price * 3000)
    return gasCostEth * 3000;
  }

  private async getUserDerivationIndex(userId: string): Promise<number> {
    // Deterministic index from userId hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(userId).digest('hex');
    return parseInt(hash.slice(0, 8), 16) % 2_000_000;
  }

  // Check if running in mock mode
  isMockMode(): boolean {
    return this.mockMode;
  }
}

export const cryptoService = new CryptoService();