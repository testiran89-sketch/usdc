const { Contract } = require('ethers');

class DexAdapter {
  constructor(name, provider, routerAddress) {
    this.name = name;
    this.provider = provider;
    this.routerAddress = routerAddress;
  }

  createContract(address, abi) {
    return new Contract(address, abi, this.provider);
  }
}

module.exports = { DexAdapter };
