import { expect } from "chai";
import { ethers, network } from "hardhat";

describe("ArbitrageExecutor integration (fork)", function () {
  const hasFork = !!process.env.RPC_URL;

  before(async function () {
    if (!hasFork) {
      this.skip();
    }
  });

  it("deploys against forked mainnet and validates configuration", async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.RPC_URL!,
            blockNumber: process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined
          }
        }
      ]
    });

    const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const aavePool = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fa4E2";
    const balancerVault = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";

    const Executor = await ethers.getContractFactory("ArbitrageExecutor");
    const executor = await Executor.deploy(usdc, aavePool, balancerVault);
    await executor.waitForDeployment();

    expect(await executor.usdc()).to.eq(usdc);
    expect(await executor.aavePool()).to.eq(aavePool);
    expect(await executor.balancerVault()).to.eq(balancerVault);
  });
});
