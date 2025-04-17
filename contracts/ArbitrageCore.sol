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
}

contract ArbitrageCore is IFlashLoanSimpleReceiver, Ownable, ReentrancyGuard {
    IPoolAddressesProvider public immutable override ADDRESSES_PROVIDER;
    IPool public immutable override POOL;
    address public immutable quickswapRouter;
    address public immutable sushiswapRouter;
    uint256 public minProfitThreshold;
    bool public isPaused;

    event ArbitrageExecuted(address indexed token, uint256 profit, bytes32 strategyHash, uint256 timestamp);
    event FlashLoanExecuted(address indexed token, uint256 amount, uint256 fee);

    constructor(
        IPoolAddressesProvider _addressProvider,
        address _quickswapRouter,
        address _sushiswapRouter,
        uint256 _minProfitThreshold
    ) Ownable(msg.sender) {
        ADDRESSES_PROVIDER = _addressProvider;
        POOL = IPool(_addressProvider.getPool());
        quickswapRouter = _quickswapRouter;
        sushiswapRouter = _sushiswapRouter;
        minProfitThreshold = _minProfitThreshold;
        isPaused = false;
    }

    function setPaused(bool _paused) external onlyOwner {
        isPaused = _paused;
    }

    function setMinProfitThreshold(uint256 _minProfitThreshold) external onlyOwner {
        minProfitThreshold = _minProfitThreshold;
    }

    function executeArbitrage(
        address token,
        uint256 amount,
        bytes calldata data,
        bytes32 strategyHash
    ) external onlyOwner nonReentrant {
        require(!isPaused, "Contract is paused");
        POOL.flashLoanSimple(
            address(this),
            token,
            amount,
            abi.encode(data, strategyHash),
            0
        );
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Callback not from Pool");
        require(initiator == owner(), "Invalid initiator");

        (bytes memory routingData, bytes32 strategyHash) = abi.decode(params, (bytes, bytes32));
        (address[] memory path, uint256 minAmountOut) = abi.decode(routingData, (address[], uint256));

        uint256 totalDebt = amount + premium;
        uint256 received = amount;

        // Approve the router to spend the asset
        IERC20(asset).approve(quickswapRouter, amount);

        // Perform the swaps along the path
        for (uint i = 0; i < path.length - 1; i++) {
            address[] memory hop = new address[](2);
            hop[0] = path[i];
            hop[1] = path[i + 1];

            address router = (i % 2 == 0) ? quickswapRouter : sushiswapRouter;
            IERC20(hop[0]).approve(router, received);

            // External call, revert on failure (no try/catch needed)
            uint[] memory amounts = IRouter(router).swapExactTokensForTokens(
                received,
                0, // Accept any output for now, slippage handled by minAmountOut at the end
                hop,
                address(this),
                block.timestamp + 300
            );
            received = amounts[1];
        }

        // Check profit
        require(received >= minAmountOut, "Insufficient output");
        require(received >= totalDebt + minProfitThreshold, "Profit below threshold");

        // Repay the loan
        IERC20(asset).approve(address(POOL), totalDebt);

        emit ArbitrageExecuted(asset, received - totalDebt, strategyHash, block.timestamp);
        emit FlashLoanExecuted(asset, amount, premium);
        return true;
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner(), amount);
    }

    function withdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    receive() external payable {}
}
