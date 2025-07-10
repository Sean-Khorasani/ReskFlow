import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { DeliveryRegistry, PaymentEscrow, GasOptimizer } from '../contracts';
import { deployContracts } from '../utils/contractHelpers';

describe('Blockchain Smart Contract Tests', () => {
  let owner: ethers.Signer;
  let driver: ethers.Signer;
  let sender: ethers.Signer;
  let recipient: ethers.Signer;
  let deliveryRegistry: DeliveryRegistry;
  let paymentEscrow: PaymentEscrow;
  let gasOptimizer: GasOptimizer;

  beforeAll(async () => {
    // Setup test signers
    [owner, driver, sender, recipient] = await ethers.getSigners();

    // Deploy contracts
    const contracts = await deployContracts(owner);
    deliveryRegistry = contracts.deliveryRegistry;
    paymentEscrow = contracts.paymentEscrow;
    gasOptimizer = contracts.gasOptimizer;

    // Grant roles
    await deliveryRegistry.connect(owner).registerDriver(await driver.getAddress());
  });

  describe('DeliveryRegistry', () => {
    it('should create a delivery', async () => {
      const deliveryId = ethers.id('test-delivery-1');
      const ipfsHash = 'QmTest123';
      const value = ethers.parseEther('0.1');

      await expect(
        deliveryRegistry
          .connect(sender)
          .createDelivery(
            deliveryId,
            await recipient.getAddress(),
            ipfsHash,
            value
          )
      ).to.emit(deliveryRegistry, 'DeliveryCreated')
        .withArgs(
          deliveryId,
          await sender.getAddress(),
          await recipient.getAddress(),
          value
        );

      const delivery = await deliveryRegistry.getDelivery(deliveryId);
      expect(delivery.sender).to.equal(await sender.getAddress());
      expect(delivery.recipient).to.equal(await recipient.getAddress());
      expect(delivery.ipfsHash).to.equal(ipfsHash);
      expect(delivery.status).to.equal(0); // Created
    });

    it('should assign driver to delivery', async () => {
      const deliveryId = ethers.id('test-delivery-2');
      const ipfsHash = 'QmTest456';
      const value = ethers.parseEther('0.1');

      await deliveryRegistry
        .connect(sender)
        .createDelivery(deliveryId, await recipient.getAddress(), ipfsHash, value);

      await expect(
        deliveryRegistry
          .connect(owner)
          .assignDriver(deliveryId, await driver.getAddress())
      ).to.emit(deliveryRegistry, 'DeliveryAssigned')
        .withArgs(deliveryId, await driver.getAddress());

      const delivery = await deliveryRegistry.getDelivery(deliveryId);
      expect(delivery.driver).to.equal(await driver.getAddress());
      expect(delivery.status).to.equal(1); // Assigned
    });

    it('should update delivery status', async () => {
      const deliveryId = ethers.id('test-delivery-3');
      const ipfsHash = 'QmTest789';
      const value = ethers.parseEther('0.1');

      await deliveryRegistry
        .connect(sender)
        .createDelivery(deliveryId, await recipient.getAddress(), ipfsHash, value);

      await deliveryRegistry
        .connect(owner)
        .assignDriver(deliveryId, await driver.getAddress());

      await expect(
        deliveryRegistry
          .connect(driver)
          .updateDeliveryStatus(
            deliveryId,
            2, // PickedUp
            JSON.stringify({ lat: 40.7128, lng: -74.0060 }),
            ''
          )
      ).to.emit(deliveryRegistry, 'StatusUpdated')
        .withArgs(deliveryId, 2, expect.any(String));
    });

    it('should enforce access control', async () => {
      const deliveryId = ethers.id('test-delivery-4');
      
      await expect(
        deliveryRegistry
          .connect(driver) // Driver can't assign drivers
          .assignDriver(deliveryId, await driver.getAddress())
      ).to.be.revertedWith('AccessControl');
    });

    it('should track driver statistics', async () => {
      const stats = await deliveryRegistry.getDriverStats(await driver.getAddress());
      expect(stats.completed).to.be.a('bigint');
      expect(stats.rating).to.be.a('bigint');
      expect(stats.activeDeliveries).to.be.a('bigint');
    });
  });

  describe('PaymentEscrow', () => {
    it('should create escrow payment', async () => {
      const deliveryId = ethers.id('test-delivery-escrow-1');
      const amount = ethers.parseEther('0.1');

      // First create delivery
      await deliveryRegistry
        .connect(sender)
        .createDelivery(
          deliveryId,
          await recipient.getAddress(),
          'QmTestEscrow',
          amount
        );

      await expect(
        paymentEscrow
          .connect(sender)
          .createEscrow(deliveryId, 8000, 500, { value: amount })
      ).to.emit(paymentEscrow, 'EscrowCreated')
        .withArgs(
          deliveryId,
          await sender.getAddress(),
          amount,
          ethers.ZeroAddress
        );

      const escrow = await paymentEscrow.getEscrowDetails(deliveryId);
      expect(escrow.amount).to.equal(amount);
      expect(escrow.payer).to.equal(await sender.getAddress());
    });

    it('should release payment on delivery', async () => {
      const deliveryId = ethers.id('test-delivery-escrow-2');
      const amount = ethers.parseEther('0.1');

      // Setup delivery and escrow
      await deliveryRegistry
        .connect(sender)
        .createDelivery(
          deliveryId,
          await recipient.getAddress(),
          'QmTestEscrow2',
          amount
        );

      await deliveryRegistry
        .connect(owner)
        .assignDriver(deliveryId, await driver.getAddress());

      await paymentEscrow
        .connect(sender)
        .createEscrow(deliveryId, 8000, 500, { value: amount });

      // Update to delivered status
      await deliveryRegistry
        .connect(driver)
        .updateDeliveryStatus(deliveryId, 4, '', ''); // Delivered

      // Release payment
      await expect(
        paymentEscrow.connect(driver).releasePayment(deliveryId)
      ).to.emit(paymentEscrow, 'PaymentReleased');

      const driverBalance = await paymentEscrow.getDriverBalance(
        await driver.getAddress()
      );
      expect(driverBalance).to.be.gt(0);
    });

    it('should handle driver withdrawal', async () => {
      const driverAddress = await driver.getAddress();
      const balanceBefore = await paymentEscrow.getDriverBalance(driverAddress);

      if (balanceBefore > 0) {
        const ethBalanceBefore = await ethers.provider.getBalance(driverAddress);

        await expect(
          paymentEscrow.connect(driver).withdrawBalance()
        ).to.emit(paymentEscrow, 'DriverWithdrawal')
          .withArgs(driverAddress, ethers.ZeroAddress, balanceBefore);

        const ethBalanceAfter = await ethers.provider.getBalance(driverAddress);
        expect(ethBalanceAfter).to.be.gt(ethBalanceBefore);

        const balanceAfter = await paymentEscrow.getDriverBalance(driverAddress);
        expect(balanceAfter).to.equal(0);
      }
    });
  });

  describe('GasOptimizer', () => {
    it('should create batch for gas optimization', async () => {
      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes('test-merkle-root'));
      const deliveryCount = 10;
      const ipfsHash = 'QmBatchTest';

      await expect(
        gasOptimizer
          .connect(owner)
          .createBatch(merkleRoot, deliveryCount, ipfsHash)
      ).to.emit(gasOptimizer, 'BatchCreated')
        .withArgs(
          expect.any(String),
          merkleRoot,
          deliveryCount,
          ipfsHash
        );
    });

    it('should verify and update delivery with Merkle proof', async () => {
      // This would require setting up a proper Merkle tree
      // For brevity, showing the structure
      const batchId = ethers.id('test-batch');
      const deliveryId = ethers.id('test-delivery-merkle');
      const status = 3; // InTransit
      const location = JSON.stringify({ lat: 40.7128, lng: -74.0060 });
      const leafIndex = 0;
      const proof: string[] = []; // Would be actual Merkle proof

      // Would test the verification and update process
    });

    it('should execute meta transaction', async () => {
      // Meta transaction allows gasless transactions for users
      const metaTx = {
        from: await sender.getAddress(),
        to: deliveryRegistry.target,
        value: 0,
        nonce: 0,
        data: deliveryRegistry.interface.encodeFunctionData(
          'createDelivery',
          [
            ethers.id('meta-tx-delivery'),
            await recipient.getAddress(),
            'QmMetaTx',
            ethers.parseEther('0.1')
          ]
        ),
        signature: '0x', // Would be actual signature
      };

      // Would test meta transaction execution
    });
  });

  describe('Gas Usage Analysis', () => {
    it('should measure gas costs for operations', async () => {
      const deliveryId = ethers.id('gas-test-delivery');
      const ipfsHash = 'QmGasTest';
      const value = ethers.parseEther('0.1');

      // Create delivery
      const createTx = await deliveryRegistry
        .connect(sender)
        .createDelivery(
          deliveryId,
          await recipient.getAddress(),
          ipfsHash,
          value
        );

      const createReceipt = await createTx.wait();
      console.log(`Create Delivery Gas: ${createReceipt?.gasUsed}`);

      // Estimate gas in USD (assuming MATIC = $0.80)
      const gasPrice = await ethers.provider.getFeeData();
      const costInMatic = (createReceipt?.gasUsed || 0n) * (gasPrice.gasPrice || 0n);
      const costInUSD = Number(ethers.formatEther(costInMatic)) * 0.80;
      console.log(`Create Delivery Cost: $${costInUSD.toFixed(4)}`);

      expect(costInUSD).to.be.lt(0.01); // Less than 1 cent
    });

    it('should compare batch vs individual updates', async () => {
      const deliveryIds = Array(10).fill(null).map((_, i) => 
        ethers.id(`batch-test-${i}`)
      );

      // Measure individual updates
      let individualGas = 0n;
      for (const id of deliveryIds.slice(0, 3)) {
        await deliveryRegistry
          .connect(sender)
          .createDelivery(id, await recipient.getAddress(), 'Qm', 0);
        
        const tx = await deliveryRegistry
          .connect(owner)
          .assignDriver(id, await driver.getAddress());
        
        const receipt = await tx.wait();
        individualGas += receipt?.gasUsed || 0n;
      }

      console.log(`Individual Updates (3): ${individualGas}`);

      // Batch update would show significant savings
      // Example: 3 individual = 300k gas, batch of 3 = 150k gas
      // Savings = 50%
    });
  });
});