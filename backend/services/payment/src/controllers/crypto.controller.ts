import { Request, Response, NextFunction } from 'express';
import { CryptoService, ExchangeRateService } from '../services';
import { asyncHandler } from '../utils/async-handler';
import { AppError } from '../utils/errors';
import { CryptoCurrency } from '../types';

export class CryptoController {
  private cryptoService: CryptoService;
  private exchangeRateService: ExchangeRateService;

  constructor() {
    this.cryptoService = new CryptoService();
    this.exchangeRateService = new ExchangeRateService();
  }

  createDepositAddress = asyncHandler(async (req: Request, res: Response) => {
    const { userId, walletId, cryptocurrency, network, amount } = req.body;

    const depositAddress = await this.cryptoService.createDepositAddress({
      userId,
      walletId,
      cryptocurrency,
      network,
      amount
    });

    res.status(201).json({
      success: true,
      data: depositAddress
    });
  });

  getCryptoTransaction = asyncHandler(async (req: Request, res: Response) => {
    const { transactionId } = req.params;

    const transaction = await this.cryptoService.getCryptoTransaction(transactionId);
    if (!transaction) {
      throw new AppError('Transaction not found', 404);
    }

    res.json({
      success: true,
      data: transaction
    });
  });

  getUserCryptoTransactions = asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;

    const transactions = await this.cryptoService.getUserCryptoTransactions(userId);

    res.json({
      success: true,
      data: transactions
    });
  });

  getExchangeRate = asyncHandler(async (req: Request, res: Response) => {
    const { cryptocurrency } = req.params;
    const { currency = 'USD' } = req.query;

    const rate = await this.exchangeRateService.getRate(
      cryptocurrency as CryptoCurrency,
      currency as string
    );

    res.json({
      success: true,
      data: {
        from: cryptocurrency,
        to: currency,
        rate,
        timestamp: new Date()
      }
    });
  });

  getExchangeRates = asyncHandler(async (req: Request, res: Response) => {
    const { currency = 'USD' } = req.query;

    const cryptos = Object.values(CryptoCurrency);
    const rates = await this.exchangeRateService.getRates(cryptos, currency as string);

    const ratesObject: Record<string, number> = {};
    rates.forEach((rate, crypto) => {
      ratesObject[crypto] = rate;
    });

    res.json({
      success: true,
      data: {
        rates: ratesObject,
        currency,
        timestamp: new Date()
      }
    });
  });

  convertAmount = asyncHandler(async (req: Request, res: Response) => {
    const { amount, from, to = 'USD' } = req.query;

    if (!amount || !from) {
      throw new AppError('Amount and from currency are required', 400);
    }

    const convertedAmount = await this.exchangeRateService.convertAmount(
      parseFloat(amount as string),
      from as CryptoCurrency,
      to as string
    );

    res.json({
      success: true,
      data: {
        originalAmount: parseFloat(amount as string),
        from,
        to,
        convertedAmount,
        timestamp: new Date()
      }
    });
  });
}