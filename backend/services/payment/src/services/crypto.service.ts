import {
  CryptoTransactionModel,
  CryptoDepositAddressModel
} from '../models';
import {
  CryptoTransaction,
  CryptoDepositAddress,
  CreateCryptoDepositDto,
  CryptoDepositWebhookDto,
  CryptoCurrency,
  CryptoTransactionStatus,
  BlockchainNetwork,
  TransactionType
} from '../types';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { config } from '../config';
import { WalletService } from './wallet.service';
import { ExchangeRateService } from './exchange-rate.service';
import { BlockchainService } from './blockchain.service';
import { generateDepositAddress } from '../utils/crypto';

export class CryptoService {
  private walletService: WalletService;
  private exchangeRateService: ExchangeRateService;
  private blockchainService: BlockchainService;

  constructor() {
    this.walletService = new WalletService();
    this.exchangeRateService = new ExchangeRateService();
    this.blockchainService = new BlockchainService();
  }

  async createDepositAddress(data: CreateCryptoDepositDto): Promise<CryptoDepositAddress> {
    try {
      // Check if user already has an active deposit address for this crypto
      const existingAddress = await CryptoDepositAddressModel.findOne({
        userId: data.userId,
        cryptocurrency: data.cryptocurrency,
        network: data.network,
        isActive: true
      });

      if (existingAddress) {
        return existingAddress.toJSON();
      }

      // Generate new deposit address
      const address = await generateDepositAddress(data.cryptocurrency, data.network);

      // Save deposit address
      const depositAddress = await CryptoDepositAddressModel.create({
        userId: data.userId,
        cryptocurrency: data.cryptocurrency,
        network: data.network,
        address: address
      });

      // Create pending transaction if amount is specified
      if (data.amount) {
        const exchangeRate = await this.exchangeRateService.getRate(data.cryptocurrency, 'USD');
        const amountInUSD = data.amount * exchangeRate;

        await CryptoTransactionModel.create({
          userId: data.userId,
          walletId: data.walletId,
          cryptocurrency: data.cryptocurrency,
          network: data.network,
          amount: data.amount,
          amountInUSD: amountInUSD,
          exchangeRate: exchangeRate,
          status: CryptoTransactionStatus.PENDING,
          depositAddress: address,
          requiredConfirmations: this.getRequiredConfirmations(data.cryptocurrency),
          expiresAt: new Date(Date.now() + config.limits.transactionExpiry)
        });
      }

      logger.info(`Deposit address created for user ${data.userId}: ${address}`);
      return depositAddress.toJSON();
    } catch (error) {
      logger.error('Error creating deposit address:', error);
      throw error;
    }
  }

  async processDepositWebhook(data: CryptoDepositWebhookDto): Promise<void> {
    try {
      // Find deposit address
      const depositAddress = await CryptoDepositAddressModel.findOne({
        address: data.toAddress,
        isActive: true
      });

      if (!depositAddress) {
        logger.warn(`Received webhook for unknown address: ${data.toAddress}`);
        return;
      }

      // Check if transaction already exists
      let transaction = await CryptoTransactionModel.findOne({
        transactionHash: data.transactionHash
      });

      if (!transaction) {
        // Create new transaction
        const exchangeRate = await this.exchangeRateService.getRate(data.cryptocurrency, 'USD');
        const amountInUSD = data.amount * exchangeRate;

        transaction = await CryptoTransactionModel.create({
          userId: depositAddress.userId,
          walletId: '', // Will be set when we find the user's wallet
          cryptocurrency: data.cryptocurrency,
          network: data.network,
          amount: data.amount,
          amountInUSD: amountInUSD,
          exchangeRate: exchangeRate,
          status: CryptoTransactionStatus.CONFIRMING,
          depositAddress: data.toAddress,
          transactionHash: data.transactionHash,
          fromAddress: data.fromAddress,
          confirmations: data.confirmations,
          requiredConfirmations: this.getRequiredConfirmations(data.cryptocurrency),
          blockNumber: data.blockNumber
        });

        // Get user's wallet
        const wallet = await this.walletService.getWallet(depositAddress.userId);
        if (!wallet) {
          throw new AppError('User wallet not found', 404);
        }

        transaction.walletId = wallet.id;
        await transaction.save();
      } else {
        // Update existing transaction
        transaction.confirmations = data.confirmations;
        transaction.blockNumber = data.blockNumber;

        if (data.confirmations >= transaction.requiredConfirmations && 
            transaction.status !== CryptoTransactionStatus.CONFIRMED) {
          transaction.status = CryptoTransactionStatus.CONFIRMED;
          transaction.confirmedAt = new Date();

          // Credit wallet
          await this.creditWallet(transaction);
        }

        await transaction.save();
      }

      logger.info(`Processed crypto deposit webhook: ${data.transactionHash}`);
    } catch (error) {
      logger.error('Error processing deposit webhook:', error);
      throw error;
    }
  }

  async checkPendingTransactions(): Promise<void> {
    try {
      // Get all pending/confirming transactions
      const transactions = await CryptoTransactionModel.find({
        status: { $in: [CryptoTransactionStatus.PENDING, CryptoTransactionStatus.CONFIRMING] }
      });

      for (const transaction of transactions) {
        try {
          // Check if transaction has expired
          if (transaction.expiresAt && transaction.expiresAt < new Date()) {
            transaction.status = CryptoTransactionStatus.EXPIRED;
            await transaction.save();
            continue;
          }

          // Check blockchain for updates
          if (transaction.transactionHash) {
            const blockchainTx = await this.blockchainService.getTransaction(
              transaction.transactionHash,
              transaction.network
            );

            if (blockchainTx) {
              transaction.confirmations = blockchainTx.confirmations;
              transaction.blockNumber = blockchainTx.blockNumber;
              transaction.fee = blockchainTx.fee;

              if (blockchainTx.confirmations >= transaction.requiredConfirmations &&
                  transaction.status !== CryptoTransactionStatus.CONFIRMED) {
                transaction.status = CryptoTransactionStatus.CONFIRMED;
                transaction.confirmedAt = new Date();

                // Credit wallet
                await this.creditWallet(transaction);
              } else if (transaction.status === CryptoTransactionStatus.PENDING) {
                transaction.status = CryptoTransactionStatus.CONFIRMING;
              }

              await transaction.save();
            }
          }
        } catch (error) {
          logger.error(`Error checking transaction ${transaction.id}:`, error);
        }
      }
    } catch (error) {
      logger.error('Error checking pending transactions:', error);
      throw error;
    }
  }

  async getCryptoTransaction(transactionId: string): Promise<CryptoTransaction | null> {
    const transaction = await CryptoTransactionModel.findById(transactionId);
    return transaction ? transaction.toJSON() : null;
  }

  async getUserCryptoTransactions(userId: string): Promise<CryptoTransaction[]> {
    const transactions = await CryptoTransactionModel
      .find({ userId })
      .sort({ createdAt: -1 });
    
    return transactions.map(t => t.toJSON());
  }

  private async creditWallet(transaction: any): Promise<void> {
    try {
      // Credit user's wallet
      await this.walletService.deposit({
        walletId: transaction.walletId,
        amount: transaction.amountInUSD,
        currency: 'USD',
        referenceId: transaction.id,
        description: `${transaction.cryptocurrency} deposit`,
        metadata: {
          cryptocurrency: transaction.cryptocurrency,
          cryptoAmount: transaction.amount,
          exchangeRate: transaction.exchangeRate,
          transactionHash: transaction.transactionHash
        }
      });

      logger.info(`Wallet credited for crypto transaction: ${transaction.id}`);
    } catch (error) {
      logger.error('Error crediting wallet:', error);
      throw error;
    }
  }

  private getRequiredConfirmations(cryptocurrency: CryptoCurrency): number {
    switch (cryptocurrency) {
      case CryptoCurrency.BTC:
        return config.crypto.bitcoin.confirmations;
      case CryptoCurrency.ETH:
        return config.crypto.ethereum.confirmations;
      case CryptoCurrency.MATIC:
        return config.crypto.polygon.confirmations;
      case CryptoCurrency.USDT:
      case CryptoCurrency.USDC:
        return config.crypto.ethereum.confirmations; // Assuming ERC-20
      default:
        return 12; // Default confirmations
    }
  }
}