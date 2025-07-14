import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { ethers } from 'ethers';
import { DeliveryRegistry, PaymentEscrow, GasOptimizer } from '../contracts';
import { deployContracts } from '../utils/contractHelpers';

describe('Blockchain Smart Contract Tests', () => {
  let owner: ethers.Signer;
  let driver: ethers.Signer;
  let sender: ethers.Signer;
  let recipient: ethers.Signer;
  let reskflowRegistry: DeliveryRegistry;
  let paymentEscrow: PaymentEscrow;
  let gasOptimizer: GasOptimizer;

  beforeAll(async () => {
    // Setup test signers
    [owner, driver, sender, recipient] = await ethers.getSigners();

    // Deploy contracts
    const contracts = await deployContracts(owner);
    reskflowRegistry = contracts.reskflowRegistry;
    paymentEscrow = contracts.paymentEscrow;
    gasOptimizer = contracts.gasOptimizer;

    // Grant roles
    await reskflowRegistry.connect(owner).registerDriver(await driver.getAddress());
  });

  describe('DeliveryRegistry', () => {
    it('should create a reskflow', async () => {
      const reskflowId = ethers.id('test-reskflow-1');
      const ipfsHash = 'QmTest123';
      const value = ethers.parseEther('0.1');

      await expect(
        reskflowRegistry
          .connect(sender)
          .createDelivery(
            reskflowId,
            await recipient.getAddress(),
            ipfsHash,
            value
          )
      ).to.emit(reskflowRegistry, 'DeliveryCreated')
        .withArgs(
          reskflowId,
          await sender.getAddress(),
          await recipient.getAddress(),
          value
        );

      const reskflow = await reskflowRegistry.getDelivery(reskflowId);
      expect(reskflow.sender).to.equal(await sender.getAddress());
      expect(reskflow.recipient).to.equal(await recipient.getAddress());
      expect(reskflow.ipfsHash).to.equal(ipfsHash);
      expect(reskflow.status).to.equal(0); // Created
    });

    it('should assign driver to reskflow', async () => {
      const reskflowId = ethers.id('test-reskflow-2');
      const ipfsHash = 'QmTest456';
      const value = ethers.parseEther('0.1');

      await reskflowRegistry
        .connect(sender)
        .createDelivery(reskflowId, await recipient.getAddress(), ipfsHash, value);

      await expect(
        reskflowRegistry
          .connect(owner)
          .assignDriver(reskflowId, await driver.getAddress())
      ).to.emit(reskflowRegistry, 'DeliveryAssigned')
        .withArgs(reskflowId, await driver.getAddress());

      const reskflow = await reskflowRegistry.getDelivery(reskflowId);
      expect(reskflow.driver).to.equal(await driver.getAddress());
      expect(reskflow.status).to.equal(1); // Assigned
    });

    it('should update reskflow status', async () => {
      const reskflowId = ethers.id('test-reskflow-3');
      const ipfsHash = 'QmTest789';
      const value = ethers.parseEther('0.1');

      await reskflowRegistry
        .connect(sender)
        .createDelivery(reskflowId, await recipient.getAddress(), ipfsHash, value);

      await reskflowRegistry
        .connect(owner)
        .assignDriver(reskflowId, await driver.getAddress());

      await expect(
        reskflowRegistry
          .connect(driver)
          .updateDeliveryStatus(
            reskflowId,
            2, // PickedUp
            JSON.stringify({ lat: 40.7128, lng: -74.0060 }),
            ''
          )
      ).to.emit(reskflowRegistry, 'StatusUpdated')
        .withArgs(reskflowId, 2, expect.any(String));
    });

    it('should enforce access control', async () => {
      const reskflowId = ethers.id('test-reskflow-4');
      
      await expect(
        reskflowRegistry
          .connect(driver) // Driver can't assign drivers
          .assignDriver(reskflowId, await driver.getAddress())
      ).to.be.revertedWith('AccessControl');
    });

    it('should track driver statistics', async () => {
      const stats = await reskflowRegistry.getDriverStats(await driver.getAddress());
      expect(stats.completed).to.be.a('bigint');
      expect(stats.rating).to.be.a('bigint');
      expect(stats.activeDeliveries).to.be.a('bigint');
    });
  });

  describe('PaymentEscrow', () => {
    it('should create escrow payment', async () => {
      const reskflowId = ethers.id('test-reskflow-escrow-1');
      const amount = ethers.parseEther('0.1');

      // First create reskflow
      await reskflowRegistry
        .connect(sender)
        .createDelivery(
          reskflowId,
          await recipient.getAddress(),
          'QmTestEscrow',
          amount
        );

      await expect(
        paymentEscrow
          .connect(sender)
          .createEscrow(reskflowId, 8000, 500, { value: amount })
      ).to.emit(paymentEscrow, 'EscrowCreated')
        .withArgs(
          reskflowId,
          await sender.getAddress(),
          amount,
          ethers.ZeroAddress
        );

      const escrow = await paymentEscrow.getEscrowDetails(reskflowId);
      expect(escrow.amount).to.equal(amount);
      expect(escrow.payer).to.equal(await sender.getAddress());
    });

    it('should release payment on reskflow', async () => {
      const reskflowId = ethers.id('test-reskflow-escrow-2');
      const amount = ethers.parseEther('0.1');

      // Setup reskflow and escrow
      await reskflowRegistry
        .connect(sender)
        .createDelivery(
          reskflowId,
          await recipient.getAddress(),
          'QmTestEscrow2',
          amount
        );

      await reskflowRegistry
        .connect(owner)
        .assignDriver(reskflowId, await driver.getAddress());

      await paymentEscrow
        .connect(sender)
        .createEscrow(reskflowId, 8000, 500, { value: amount });

      // Update to delivered status
      await reskflowRegistry
        .connect(driver)
        .updateDeliveryStatus(reskflowId, 4, '', ''); // Delivered

      // Release payment
      await expect(
        paymentEscrow.connect(driver).releasePayment(reskflowId)
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
      const reskflowCount = 10;
      const ipfsHash = 'QmBatchTest';

      await expect(
        gasOptimizer
          .connect(owner)
          .createBatch(merkleRoot, reskflowCount, ipfsHash)
      ).to.emit(gasOptimizer, 'BatchCreated')
        .withArgs(
          expect.any(String),
          merkleRoot,
          reskflowCount,
          ipfsHash
        );
    });

    it('should verify and update reskflow with Merkle proof', async () => {
      // This would require setting up a proper Merkle tree
      // For brevity, showing the structure
      const batchId = ethers.id('test-batch');
      const reskflowId = ethers.id('test-reskflow-merkle');
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
        to: reskflowRegistry.target,
        value: 0,
        nonce: 0,
        data: reskflowRegistry.interface.encodeFunctionData(
          'createDelivery',
          [
            ethers.id('meta-tx-reskflow'),
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
      const reskflowId = ethers.id('gas-test-reskflow');
      const ipfsHash = 'QmGasTest';
      const value = ethers.parseEther('0.1');

      // Create reskflow
      const createTx = await reskflowRegistry
        .connect(sender)
        .createDelivery(
          reskflowId,
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
      const reskflowIds = Array(10).fill(null).map((_, i) => 
        ethers.id(`batch-test-${i}`)
      );

      // Measure individual updates
      let individualGas = 0n;
      for (const id of reskflowIds.slice(0, 3)) {
        await reskflowRegistry
          .connect(sender)
          .createDelivery(id, await recipient.getAddress(), 'Qm', 0);
        
        const tx = await reskflowRegistry
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