import { ethers } from "hardhat";

async function main() {
  console.log("Deploying ArbitrageCore contract...");

  // Get the contract factory
  const ArbitrageCore = await ethers.getContractFactory("ArbitrageCore");
  
  // Constructor arguments from your contract:
  // IPoolAddressesProvider _addressProvider,
  // address _quickswapRouter,
  // address _sushiswapRouter,
  // address _uniswapV3Router,
  // address _balancerVault,
  // uint256 _minProfitThreshold,
  // uint256 _maxGasPrice
  
  // Polygon network addresses (replace these with actual addresses for your network)
  const aaveV3PoolAddressesProvider = "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb"; // Polygon Aave V3
  const quickswapRouter = "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff";
  const sushiswapRouter = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
  const uniswapV3Router = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
  const minProfitThreshold = ethers.parseEther("0.1"); // 0.1 MATIC or other native token
  const maxGasPrice = ethers.parseUnits("300", "gwei"); // 300 gwei max gas price
  
  // Deploy the contract with correct constructor arguments
  const arbitrageCore = await ArbitrageCore.deploy(
    aaveV3PoolAddressesProvider,
    quickswapRouter,
    sushiswapRouter,
    uniswapV3Router,
    balancerVault,
    minProfitThreshold,
    maxGasPrice
  );

  await arbitrageCore.waitForDeployment();
  
  const deployedAddress = await arbitrageCore.getAddress();
  console.log(`ArbitrageCore deployed to: ${deployedAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
