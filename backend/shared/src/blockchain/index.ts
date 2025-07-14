import { ethers } from 'ethers';
import { config } from '../config';

// Import contract ABIs (these would be generated from compiled contracts)
import DeliveryRegistryABI from './abi/DeliveryRegistry.json';
import PaymentEscrowABI from './abi/PaymentEscrow.json';
import GasOptimizerABI from './abi/GasOptimizer.json';

export class BlockchainService {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet;
  private reskflowRegistry: ethers.Contract;
  private paymentEscrow: ethers.Contract;
  private gasOptimizer: ethers.Contract;

  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.blockchain.polygon.rpcUrl);
    this.signer = new ethers.Wallet(config.blockchain.privateKey, this.provider);

    this.reskflowRegistry = new ethers.Contract(
      config.blockchain.polygon.contracts.reskflowRegistry,
      DeliveryRegistryABI,
      this.signer
    );

    this.paymentEscrow = new ethers.Contract(
      config.blockchain.polygon.contracts.paymentEscrow,
      PaymentEscrowABI,
      this.signer
    );

    this.gasOptimizer = new ethers.Contract(
      config.blockchain.polygon.contracts.gasOptimizer,
      GasOptimizerABI,
      this.signer
    );
  }

  async createDeliveryOnChain(
    reskflowId: string,
    recipient: string,
    ipfsHash: string,
    value: bigint
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.reskflowRegistry.createDelivery(
      ethers.id(reskflowId),
      recipient,
      ipfsHash,
      value
    );
    return tx.wait();
  }

  async updateDeliveryStatus(
    reskflowId: string,
    status: number,
    location: string,
    proof: string
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.reskflowRegistry.updateDeliveryStatus(
      ethers.id(reskflowId),
      status,
      location,
      proof
    );
    return tx.wait();
  }

  async createEscrow(
    reskflowId: string,
    amount: bigint,
    driverShare: number = 8000,
    platformFee: number = 500
  ): Promise<ethers.TransactionReceipt> {
    const tx = await this.paymentEscrow.createEscrow(
      ethers.id(reskflowId),
      driverShare,
      platformFee,
      { value: amount }
    );
    return tx.wait();
  }

  async releasePayment(reskflowId: string): Promise<ethers.TransactionReceipt> {
    const tx = await this.paymentEscrow.releasePayment(ethers.id(reskflowId));
    return tx.wait();
  }

  async getDeliveryDetails(reskflowId: string): Promise<any> {
    return this.reskflowRegistry.getDelivery(ethers.id(reskflowId));
  }

  async getDriverStats(driverAddress: string): Promise<{
    completed: bigint;
    rating: bigint;
    activeDeliveries: bigint;
  }> {
    return this.reskflowRegistry.getDriverStats(driverAddress);
  }

  async estimateGas(
    contract: string,
    method: string,
    params: any[]
  ): Promise<bigint> {
    let contractInstance: ethers.Contract;
    
    switch (contract) {
      case 'reskflowRegistry':
        contractInstance = this.reskflowRegistry;
        break;
      case 'paymentEscrow':
        contractInstance = this.paymentEscrow;
        break;
      case 'gasOptimizer':
        contractInstance = this.gasOptimizer;
        break;
      default:
        throw new Error('Unknown contract');
    }

    return contractInstance[method].estimateGas(...params);
  }

  async getCurrentGasPrice(): Promise<bigint> {
    return this.provider.getFeeData().then(data => data.gasPrice || 0n);
  }

  async getBalance(address: string): Promise<bigint> {
    return this.provider.getBalance(address);
  }

  async listenToEvents(
    contract: string,
    eventName: string,
    callback: (event: any) => void
  ): Promise<void> {
    let contractInstance: ethers.Contract;
    
    switch (contract) {
      case 'reskflowRegistry':
        contractInstance = this.reskflowRegistry;
        break;
      case 'paymentEscrow':
        contractInstance = this.paymentEscrow;
        break;
      case 'gasOptimizer':
        contractInstance = this.gasOptimizer;
        break;
      default:
        throw new Error('Unknown contract');
    }

    contractInstance.on(eventName, callback);
  }

  async removeAllListeners(): Promise<void> {
    await Promise.all([
      this.reskflowRegistry.removeAllListeners(),
      this.paymentEscrow.removeAllListeners(),
      this.gasOptimizer.removeAllListeners(),
    ]);
  }

  generateDeliveryId(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  hashDeliveryData(data: any): string {
    return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
  }

  async verifySignature(message: string, signature: string): Promise<string> {
    return ethers.verifyMessage(message, signature);
  }

  formatEther(value: bigint): string {
    return ethers.formatEther(value);
  }

  parseEther(value: string): bigint {
    return ethers.parseEther(value);
  }
}

export const blockchain = new BlockchainService();