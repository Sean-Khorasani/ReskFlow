import { ethers, upgrades } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Starting deployment...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance));

  // Deploy DeliveryRegistry
  console.log("\nDeploying DeliveryRegistry...");
  const DeliveryRegistry = await ethers.getContractFactory("DeliveryRegistry");
  const reskflowRegistry = await upgrades.deployProxy(
    DeliveryRegistry,
    [deployer.address],
    { initializer: "initialize" }
  );
  await reskflowRegistry.waitForDeployment();
  const reskflowRegistryAddress = await reskflowRegistry.getAddress();
  console.log("DeliveryRegistry deployed to:", reskflowRegistryAddress);

  // Deploy PaymentEscrow
  console.log("\nDeploying PaymentEscrow...");
  const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
  const paymentEscrow = await upgrades.deployProxy(
    PaymentEscrow,
    [
      deployer.address, // admin
      reskflowRegistryAddress, // reskflow registry
      deployer.address, // treasury (change in production)
      8000, // 80% driver share
      500, // 5% platform fee
    ],
    { initializer: "initialize" }
  );
  await paymentEscrow.waitForDeployment();
  const paymentEscrowAddress = await paymentEscrow.getAddress();
  console.log("PaymentEscrow deployed to:", paymentEscrowAddress);

  // Deploy GasOptimizer with trusted forwarder
  console.log("\nDeploying GasOptimizer...");
  // In production, use a proper trusted forwarder address
  const trustedForwarder = "0x0000000000000000000000000000000000000001"; 
  const GasOptimizer = await ethers.getContractFactory("GasOptimizer");
  const gasOptimizer = await upgrades.deployProxy(
    GasOptimizer,
    [deployer.address, reskflowRegistryAddress],
    { 
      initializer: "initialize",
      constructorArgs: [trustedForwarder]
    }
  );
  await gasOptimizer.waitForDeployment();
  const gasOptimizerAddress = await gasOptimizer.getAddress();
  console.log("GasOptimizer deployed to:", gasOptimizerAddress);

  // Grant roles
  console.log("\nConfiguring roles...");
  
  // Grant ORACLE_ROLE to GasOptimizer in DeliveryRegistry
  const ORACLE_ROLE = await reskflowRegistry.ORACLE_ROLE();
  await reskflowRegistry.registerOracle(gasOptimizerAddress);
  console.log("Granted ORACLE_ROLE to GasOptimizer");

  // Set up some test drivers
  const testDrivers = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  ];

  for (const driver of testDrivers) {
    await reskflowRegistry.registerDriver(driver);
    console.log(`Registered driver: ${driver}`);
  }

  // Save deployment addresses
  const deploymentInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    contracts: {
      DeliveryRegistry: {
        address: reskflowRegistryAddress,
        deployer: deployer.address,
        deploymentBlock: (await reskflowRegistry.deploymentTransaction())?.blockNumber,
      },
      PaymentEscrow: {
        address: paymentEscrowAddress,
        deployer: deployer.address,
        deploymentBlock: (await paymentEscrow.deploymentTransaction())?.blockNumber,
        config: {
          defaultDriverShare: 8000,
          defaultPlatformFee: 500,
          treasury: deployer.address,
        },
      },
      GasOptimizer: {
        address: gasOptimizerAddress,
        deployer: deployer.address,
        deploymentBlock: (await gasOptimizer.deploymentTransaction())?.blockNumber,
        config: {
          trustedForwarder: trustedForwarder,
        },
      },
    },
    testDrivers: testDrivers,
    deployedAt: new Date().toISOString(),
  };

  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  fs.writeFileSync(
    path.join(deploymentPath, `deployment-${(await ethers.provider.getNetwork()).chainId}.json`),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\nDeployment completed successfully!");
  console.log("Deployment info saved to:", path.join(deploymentPath, `deployment-${(await ethers.provider.getNetwork()).chainId}.json`));

  // Verify contracts on Etherscan (if not on local network)
  const networkName = (await ethers.provider.getNetwork()).name;
  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nWaiting for block confirmations before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30 seconds

    console.log("Verifying contracts on Etherscan...");
    try {
      await verifyContract(reskflowRegistryAddress, []);
      await verifyContract(paymentEscrowAddress, []);
      await verifyContract(gasOptimizerAddress, [trustedForwarder]);
    } catch (error) {
      console.error("Verification failed:", error);
    }
  }
}

async function verifyContract(address: string, constructorArguments: any[]) {
  try {
    await run("verify:verify", {
      address: address,
      constructorArguments: constructorArguments,
    });
    console.log(`Contract verified: ${address}`);
  } catch (error: any) {
    if (error.message.includes("already verified")) {
      console.log(`Contract already verified: ${address}`);
    } else {
      console.error(`Verification failed for ${address}:`, error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });