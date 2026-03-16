import { expect } from "chai";
import { ethers } from "hardhat";

describe("ArbitrageExecutor unit", function () {
  async function fixture() {
    const [owner] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const usdc = await Token.deploy("USD Coin", "USDC", 6);
    const weth = await Token.deploy("Wrapped Ether", "WETH", 18);

    const Router = await ethers.getContractFactory("MockUniswapRouter");
    const router = await Router.deploy();

    const Aave = await ethers.getContractFactory("MockAavePool");
    const aave = await Aave.deploy();

    const Executor = await ethers.getContractFactory("ArbitrageExecutor");
    const executor = await Executor.deploy(await usdc.getAddress(), await aave.getAddress(), owner.address);

    await usdc.mint(await aave.getAddress(), 10_000_000_000n);
    await usdc.mint(await router.getAddress(), 10_000_000_000n);
    await weth.mint(await router.getAddress(), ethers.parseUnits("100000", 18));

    return { owner, usdc, weth, router, aave, executor };
  }

  it("executes successful arbitrage", async function () {
    const { executor, usdc, weth, router } = await fixture();

    const steps = [
      [0, await router.getAddress(), await usdc.getAddress(), await weth.getAddress(), ethers.parseUnits("50", 18), "0x"],
      [1, await router.getAddress(), await weth.getAddress(), await usdc.getAddress(), 50_500_000n, "0x"]
    ];

    const params = [await usdc.getAddress(), 50_000_000n, steps, 10_000n, 0];
    await expect(executor.executeArbitrage(params)).to.emit(executor, "ArbitrageProfit");
  });

  it("reverts when profit is insufficient", async function () {
    const { executor, usdc, weth, router } = await fixture();
    await router.setMultiplierBps(10_000);

    const steps = [
      [0, await router.getAddress(), await usdc.getAddress(), await weth.getAddress(), 49_000_000n, "0x"],
      [1, await router.getAddress(), await weth.getAddress(), await usdc.getAddress(), 49_000_000n, "0x"]
    ];

    const params = [await usdc.getAddress(), 50_000_000n, steps, 1_000_000n, 0];
    await expect(executor.executeArbitrage(params)).to.be.revertedWith("profit below threshold");
  });

  it("reverts on slippage violation", async function () {
    const { executor, usdc, weth, router } = await fixture();
    await router.setMultiplierBps(8_000);

    const steps = [
      [0, await router.getAddress(), await usdc.getAddress(), await weth.getAddress(), ethers.parseUnits("1000", 18), "0x"],
      [1, await router.getAddress(), await weth.getAddress(), await usdc.getAddress(), 80_000_000n, "0x"]
    ];

    const params = [await usdc.getAddress(), 50_000_000n, steps, 1_000n, 0];
    await expect(executor.executeArbitrage(params)).to.be.reverted;
  });

  it("reverts when flash loan repayment fails", async function () {
    const { executor, usdc, weth, router, aave } = await fixture();
    await aave.setFeeBps(3_000);

    const steps = [
      [0, await router.getAddress(), await usdc.getAddress(), await weth.getAddress(), 40_000_000n, "0x"],
      [1, await router.getAddress(), await weth.getAddress(), await usdc.getAddress(), 40_000_000n, "0x"]
    ];

    const params = [await usdc.getAddress(), 50_000_000n, steps, 1_000n, 0];
    await expect(executor.executeArbitrage(params)).to.be.reverted;
  });

  it("reverts when gas price is above configured max", async function () {
    const { executor, usdc, weth, router } = await fixture();
    await executor.setRiskParameters(50, 10_000n, ethers.parseUnits("1", "gwei"));

    const steps = [
      [0, await router.getAddress(), await usdc.getAddress(), await weth.getAddress(), 50_000_000n, "0x"],
      [1, await router.getAddress(), await weth.getAddress(), await usdc.getAddress(), 51_000_000n, "0x"]
    ];

    const params = [await usdc.getAddress(), 50_000_000n, steps, 1_000n, 0];
    await expect(executor.executeArbitrage(params, { gasPrice: ethers.parseUnits("5", "gwei") })).to.be.revertedWith(
      "gas too high"
    );
  });
});
