import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("Deploying ArbitrageCore contract...");

  const AAVE_ADDRESS_PROVIDER = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb";
  const QUICKSWAP_ROUTER = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
  const SUSHISWAP_ROUTER = "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506";

  // Use ethers.parseEther for v6
  const MIN_PROFIT_THRESHOLD = hre.ethers.parseEther("10");

  // Deploy the contract
  const ArbitrageCore = await hre.ethers.getContractFactory("ArbitrageCore");
  const arbitrageCore = await ArbitrageCore.deploy(
    AAVE_ADDRESS_PROVIDER,
    QUICKSWAP_ROUTER,
    SUSHISWAP_ROUTER,
    MIN_PROFIT_THRESHOLD
  );

  // Wait for the deployment transaction to be mined
  await arbitrageCore.waitForDeployment();

  // Get the deployed contract address
  const deployedAddress = await arbitrageCore.getAddress();
  console.log(`Contract deployed at: ${deployedAddress}`);

  // Update .env file with the deployed address
  updateEnvFile('FLASH_LOAN_ADDRESS', deployedAddress);
  console.log("Updated .env file with flash loan address");
}

function updateEnvFile(key: string, value: string): void {
  const envFilePath = path.resolve('.env');
  let envFileContent = '';
  
  if (fs.existsSync(envFilePath)) {
    envFileContent = fs.readFileSync(envFilePath, 'utf8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(envFileContent)) {
      envFileContent = envFileContent.replace(regex, `${key}=${value}`);
    } else {
      envFileContent += `\n${key}=${value}`;
    }
  } else {
    envFileContent = `${key}=${value}`;
  }

  fs.writeFileSync(envFilePath, envFileContent.trim() + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
