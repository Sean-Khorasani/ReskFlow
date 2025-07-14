import crypto from 'crypto';
import { ethers } from 'ethers';
import { CryptoCurrency, BlockchainNetwork } from '../types';
import { logger } from './logger';

// Generate a unique deposit address for a cryptocurrency
export const generateDepositAddress = async (
  cryptocurrency: CryptoCurrency,
  network: BlockchainNetwork
): Promise<string> => {
  try {
    switch (network) {
      case BlockchainNetwork.ETHEREUM:
      case BlockchainNetwork.POLYGON:
      case BlockchainNetwork.BSC:
        // Generate Ethereum-compatible address
        const wallet = ethers.Wallet.createRandom();
        return wallet.address;
      
      case BlockchainNetwork.BITCOIN:
        // In a real implementation, this would use a Bitcoin library
        // For now, we'll generate a mock Bitcoin address
        return generateMockBitcoinAddress();
      
      default:
        throw new Error(`Unsupported network: ${network}`);
    }
  } catch (error) {
    logger.error('Error generating deposit address:', error);
    throw error;
  }
};

// Generate a mock Bitcoin address (for demonstration)
const generateMockBitcoinAddress = (): string => {
  const prefix = '1'; // Bitcoin mainnet address prefix
  const hash = crypto.randomBytes(20).toString('hex');
  return prefix + hash.substring(0, 33).toUpperCase();
};

// Validate cryptocurrency address format
export const validateAddress = (
  address: string,
  network: BlockchainNetwork
): boolean => {
  try {
    switch (network) {
      case BlockchainNetwork.ETHEREUM:
      case BlockchainNetwork.POLYGON:
      case BlockchainNetwork.BSC:
        return ethers.isAddress(address);
      
      case BlockchainNetwork.BITCOIN:
        // Basic Bitcoin address validation
        return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
      
      default:
        return false;
    }
  } catch (error) {
    logger.error('Error validating address:', error);
    return false;
  }
};

// Calculate transaction fee estimate
export const estimateTransactionFee = async (
  cryptocurrency: CryptoCurrency,
  network: BlockchainNetwork
): Promise<number> => {
  // In a real implementation, this would query the blockchain for current fee rates
  const feeEstimates: Record<string, number> = {
    [`${CryptoCurrency.BTC}_${BlockchainNetwork.BITCOIN}`]: 0.0001,
    [`${CryptoCurrency.ETH}_${BlockchainNetwork.ETHEREUM}`]: 0.002,
    [`${CryptoCurrency.MATIC}_${BlockchainNetwork.POLYGON}`]: 0.001,
    [`${CryptoCurrency.USDT}_${BlockchainNetwork.ETHEREUM}`]: 0.005,
    [`${CryptoCurrency.USDC}_${BlockchainNetwork.ETHEREUM}`]: 0.005
  };

  const key = `${cryptocurrency}_${network}`;
  return feeEstimates[key] || 0.001;
};

// Generate secure random string
export const generateSecureToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

// Hash data using SHA256
export const hashData = (data: string): string => {
  return crypto.createHash('sha256').update(data).digest('hex');
};