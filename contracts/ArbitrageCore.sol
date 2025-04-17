// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/core-v3/contracts/flashloan/interfaces/IFlashLoanSimpleReceiver.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function getAmountsOut(
        uint amountIn, 
        address[] calldata path
    ) external view returns (uint[] memory amounts);
}

interface IUniswapV3Router {
    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
    
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }
}

interface ICurvePool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
    function coins(uint256 i) external view returns (address);
}

interface IBalancerVault {
    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable returns (uint256);
    
    struct SingleSwap {
        bytes32 poolId;
        uint8 kind;
        address assetIn;
        address assetOut;
        uint256 amount;
        bytes userData;
    }
    
    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }
}

contract ArbitrageCore is IFlashLoanSimpleReceiver, Ownable, ReentrancyGuard {
    IPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
    IPool public immutable override POOL;
    
    // DEX routers
    address public immutable quickswapRouter;
    address public immutable sushiswapRouter;
    address public immutable uniswapV3Router;
    address public immutable balancerVault;
    
    // Configuration
    uint256 public minProfitThreshold;
    uint256 public maxGasPrice;
    bool public isPaused;
    
    // Performance tracking
    uint256 public totalExecutions;
    uint256 public totalProfit;
    uint256 public lastExecutionBlock;
    mapping(bytes32 => uint256) public strategyPerformance;
    
    // Protocol settings
    uint256 private constant MAX_BPS = 10000;
    uint256 private constant MAX_DEX_SLIPPAGE = 300; // 3% max slippage
    
    // Events
    event ArbitrageExecuted(
        address indexed token,
        uint256 profit,
        bytes32 strategyHash,
        uint256 gasUsed,
        uint256 timestamp
    );
    event FlashLoanExecuted(address indexed token, uint256 amount, uint256 fee);
    event StrategyScoreUpdated(bytes32 indexed strategyHash, uint256 newScore);
    event ConfigUpdated(string paramName, uint256 oldValue, uint256 newValue);

    constructor(
        IPoolAddressesProvider _addressProvider,
        address _quickswapRouter,
        address _sushiswapRouter,
        address _uniswapV3Router,
        address _balancerVault,
        uint256 _minProfitThreshold,
        uint256 _maxGasPrice
    ) Ownable(msg.sender) {
        ADDRESSES_PROVIDER = _addressProvider;
        POOL = IPool(_addressProvider.getPool());
        quickswapRouter = _quickswapRouter;
        sushiswapRouter = _sushiswapRouter;
        uniswapV3Router = _uniswapV3Router;
        balancerVault = _balancerVault;
        minProfitThreshold = _minProfitThreshold;
        maxGasPrice = _maxGasPrice;
        isPaused = false;
    }

    // Admin functions
    function setPaused(bool _paused) external onlyOwner {
        isPaused = _paused;
    }

    function setMinProfitThreshold(uint256 _minProfitThreshold) external onlyOwner {
        uint256 oldValue = minProfitThreshold;
        minProfitThreshold = _minProfitThreshold;
        emit ConfigUpdated("minProfitThreshold", oldValue, _minProfitThreshold);
    }
    
    function setMaxGasPrice(uint256 _maxGasPrice) external onlyOwner {
        uint256 oldValue = maxGasPrice;
        maxGasPrice = _maxGasPrice;
        emit ConfigUpdated("maxGasPrice", oldValue, _maxGasPrice);
    }
    
    function updateStrategyScore(bytes32 strategyHash, uint256 score) external onlyOwner {
        strategyPerformance[strategyHash] = score;
        emit StrategyScoreUpdated(strategyHash, score);
    }

    // Main arbitrage function
    function executeArbitrage(
        address token,
        uint256 amount,
        bytes calldata data,
        bytes32 strategyHash
    ) external onlyOwner nonReentrant {
        require(!isPaused, "Contract is paused");
        require(tx.gasprice <= maxGasPrice, "Gas price too high");
        
        uint256 startGas = gasleft();
        
        POOL.flashLoanSimple(
            address(this),
            token,
            amount,
            abi.encode(data, strategyHash),
            0
        );
        
        uint256 gasUsed = startGas - gasleft();
        lastExecutionBlock = block.number;
        totalExecutions += 1;
    }
    
    // Advanced multi-DEX arbitrage execution
    function executeMultiDexArbitrage(
        address token,
        uint256 amount,
        bytes calldata data,
        bytes32 strategyHash
    ) external onlyOwner nonReentrant {
        require(!isPaused, "Contract is paused");
        require(tx.gasprice <= maxGasPrice, "Gas price too high");
        
        uint256 startGas = gasleft();
        
        POOL.flashLoanSimple(
            address(this),
            token,
            amount,
            abi.encode(data, strategyHash, true),
            0
        );
        
        uint256 gasUsed = startGas - gasleft();
        lastExecutionBlock = block.number;
        totalExecutions += 1;
    }

    // Flash loan callback
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Callback not from Pool");
        require(initiator == owner(), "Invalid initiator");

        bool isMultiDex;
        bytes memory routingData;
        bytes32 strategyHash;
        
        if (params.length > 64) {
            (routingData, strategyHash, isMultiDex) = abi.decode(params, (bytes, bytes32, bool));
        } else {
            (routingData, strategyHash) = abi.decode(params, (bytes, bytes32));
        }
        
        uint256 totalDebt = amount + premium;
        uint256 startBalance = IERC20(asset).balanceOf(address(this));
        
        if (isMultiDex) {
            _executeMultiDexRoute(asset, amount, routingData);
        } else {
            _executeStandardRoute(asset, amount, routingData);
        }
        
        uint256 endBalance = IERC20(asset).balanceOf(address(this));
        uint256 profit = endBalance > totalDebt ? endBalance - totalDebt : 0;
        
        // Check profit requirement
        require(profit >= minProfitThreshold, "Profit below threshold");
        
        // Repay flash loan
        IERC20(asset).approve(address(POOL), totalDebt);
        
        // Update tracking
        totalProfit += profit;
        strategyPerformance[strategyHash] += 1;
        
        // Log events
        emit ArbitrageExecuted(
            asset,
            profit,
            strategyHash,
            tx.gasprice * gasleft(),
            block.timestamp
        );
        emit FlashLoanExecuted(asset, amount, premium);
        
        return true;
    }
    
    // Internal functions for various routing strategies
    function _executeStandardRoute(
        address asset,
        uint256 amount,
        bytes memory routingData
    ) internal {
        (address[] memory path, uint256 minAmountOut) = abi.decode(routingData, (address[], uint256));
        
        uint256 received = amount;
        
        // Perform the swaps along the path
        for (uint i = 0; i < path.length - 1; i++) {
            address[] memory hop = new address[](2);
            hop[0] = path[i];
            hop[1] = path[i + 1];
            
            // Alternating between routers
            address router = (i % 2 == 0) ? quickswapRouter : sushiswapRouter;
            IERC20(hop[0]).approve(router, received);
            
            // Execute swap
            uint[] memory amounts = IRouter(router).swapExactTokensForTokens(
                received,
                0,
                hop,
                address(this),
                block.timestamp + 300
            );
            received = amounts[1];
        }
        
        // Ensure minimum output
        require(received >= minAmountOut, "Insufficient output");
    }
    
    function _executeMultiDexRoute(
        address asset,
        uint256 amount,
        bytes memory routingData
    ) internal {
        (bytes[] memory routes, uint256 minAmountOut) = abi.decode(routingData, (bytes[], uint256));
        
        uint256 received = amount;
        
        // Execute each route segment
        for (uint routeIndex = 0; routeIndex < routes.length; routeIndex++) {
            bytes memory routeData = routes[routeIndex];
            (uint8 dexType, bytes memory swapData) = abi.decode(routeData, (uint8, bytes));
            
            // Execute based on DEX type
            if (dexType == 0) {
                // Standard AMM (Quickswap/Sushiswap)
                (address router, address[] memory path) = abi.decode(swapData, (address, address[]));
                IERC20(path[0]).approve(router, received);
                uint[] memory amounts = IRouter(router).swapExactTokensForTokens(
                    received,
                    0,
                    path,
                    address(this),
                    block.timestamp + 300
                );
                received = amounts[amounts.length - 1];
            } 
            else if (dexType == 1) {
                // Uniswap V3
                (bytes memory path, uint256 amountOutMin) = abi.decode(swapData, (bytes, uint256));
                address firstToken = _getFirstTokenFromV3Path(path);
                IERC20(firstToken).approve(uniswapV3Router, received);
                
                IUniswapV3Router.ExactInputParams memory params = IUniswapV3Router.ExactInputParams({
                    path: path,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: received,
                    amountOutMinimum: amountOutMin
                });
                
                received = IUniswapV3Router(uniswapV3Router).exactInput(params);
            }
            else if (dexType == 2) {
                // Curve
                (address pool, int128 curveI, int128 curveJ, uint256 minDy) = abi.decode(
                    swapData, 
                    (address, int128, int128, uint256)
                );
                address tokenIn = ICurvePool(pool).coins(uint256(uint128(curveI)));
                IERC20(tokenIn).approve(pool, received);
                received = ICurvePool(pool).exchange(curveI, curveJ, received, minDy);
            }
            else if (dexType == 3) {
                // Balancer
                (bytes32 poolId, address tokenIn, address tokenOut, uint256 minOut) = abi.decode(
                    swapData, 
                    (bytes32, address, address, uint256)
                );
                IERC20(tokenIn).approve(balancerVault, received);
                
                IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
                    poolId: poolId,
                    kind: 0, // GIVEN_IN
                    assetIn: tokenIn,
                    assetOut: tokenOut,
                    amount: received,
                    userData: ""
                });
                
                IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
                    sender: address(this),
                    fromInternalBalance: false,
                    recipient: payable(address(this)),
                    toInternalBalance: false
                });
                
                received = IBalancerVault(balancerVault).swap(
                    singleSwap,
                    funds,
                    minOut,
                    block.timestamp + 300
                );
            }
        }
        
        // Ensure minimum output
        require(received >= minAmountOut, "Insufficient output");
    }
    
    // Helper function to get first token from Uniswap V3 path
    function _getFirstTokenFromV3Path(bytes memory path) internal pure returns (address) {
        require(path.length >= 20, "Invalid V3 path");
        
        // Extract the first token address from the path bytes
        address firstToken;
        assembly {
            // Load the first 32 bytes starting at position 0x20 (skipping the length field)
            let pathData := mload(add(path, 0x20))
            // Take the first 20 bytes (address size) and convert to address
            firstToken := and(pathData, 0xffffffffffffffffffffffffffffffffffffffff)
        }
        
        return firstToken;
    }

    // Fallback to receive ETH
    receive() external payable {}
}
