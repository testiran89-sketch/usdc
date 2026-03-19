const { formatUnits } = require('ethers');

async function estimateGasUsd(provider, gasUnits, ethUsd, multiplier) {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? 100000000n;
  const gasInEth = Number(formatUnits(gasPrice * BigInt(Math.ceil(gasUnits * multiplier)), 18));
  return gasInEth * ethUsd;
}

module.exports = { estimateGasUsd };
