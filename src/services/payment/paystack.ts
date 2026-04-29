import axios from 'axios';

const BASE = 'https://api.paystack.co';
const headers = () => ({ Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` });

class PaystackService {
  async initializeTransaction(payload: {
    email: string; amount: number; reference: string;
    metadata?: object; callback_url?: string;
  }) {
    const { data } = await axios.post(`${BASE}/transaction/initialize`, payload, { headers: headers() });
    return data.data;
  }

  async verifyTransaction(reference: string) {
    const { data } = await axios.get(`${BASE}/transaction/verify/${reference}`, { headers: headers() });
    return data.data;
  }

  async initiateTransfer(amountKobo: number, bankDetails: any, reference: string) {
    // First create transfer recipient
    const { data: recipientData } = await axios.post(`${BASE}/transferrecipient`, {
      type: 'nuban',
      name: bankDetails.accountName,
      account_number: bankDetails.accountNumber,
      bank_code: bankDetails.bankCode,
      currency: 'NGN',
    }, { headers: headers() });

    // Then initiate transfer
    const { data } = await axios.post(`${BASE}/transfer`, {
      source: 'balance',
      amount: amountKobo,
      recipient: recipientData.data.recipient_code,
      reason: 'Ludo App Withdrawal',
      reference,
    }, { headers: headers() });

    return data.data;
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(payload)
      .digest('hex');
    return hash === signature;
  }
}

export const paystackService = new PaystackService();
