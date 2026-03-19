const { ethers } = require('ethers');

const RPC_TIMEOUT_MS = Number(process.env.RPC_TIMEOUT_MS || 8_000);

class RotatingRpcProvider {
  constructor(rpcUrls, chainId = 42161) {
    this.chainId = chainId;
    this.providers = rpcUrls.map((url) => ({
      url,
      provider: (() => {
        const request = new ethers.FetchRequest(url);
        request.timeout = RPC_TIMEOUT_MS;
        return new ethers.JsonRpcProvider(request, chainId, { staticNetwork: ethers.Network.from(chainId) });
      })(),
      failures: 0,
      lastHealthyAt: 0
    }));
    this.activeIndex = 0;
  }

  async initialize() {
    if (!this.providers.length) {
      throw new Error('At least one RPC URL is required');
    }

    const initErrors = [];
    for (let index = 0; index < this.providers.length; index += 1) {
      const candidate = this.providers[index];
      try {
        const network = await candidate.provider.getNetwork();
        if (Number(network.chainId) !== this.chainId) {
          throw new Error(`Unexpected chainId ${network.chainId} for ${candidate.url}`);
        }
        candidate.lastHealthyAt = Date.now();
        this.activeIndex = index;
        return candidate.provider;
      } catch (error) {
        candidate.failures += 1;
        initErrors.push(`${candidate.url} => ${error.code || error.name || 'ERROR'}: ${error.message}`);
      }
    }

    throw new Error(`Unable to initialize any configured Arbitrum RPC endpoint. Tried: ${initErrors.join(' | ')}`);
  }

  get current() {
    return this.providers[this.activeIndex].provider;
  }

  get currentUrl() {
    return this.providers[this.activeIndex].url;
  }

  async withFallback(fn) {
    let lastError;

    for (let offset = 0; offset < this.providers.length; offset += 1) {
      const index = (this.activeIndex + offset) % this.providers.length;
      const candidate = this.providers[index];
      try {
        const result = await fn(candidate.provider);
        candidate.lastHealthyAt = Date.now();
        this.activeIndex = index;
        return result;
      } catch (error) {
        candidate.failures += 1;
        lastError = error;
      }
    }

    throw lastError;
  }

  async call(method, ...args) {
    return this.withFallback((provider) => provider[method](...args));
  }

  wallet(privateKey) {
    return new ethers.Wallet(privateKey, this.current);
  }

  connectContract(address, abi, signerOrProvider) {
    return new ethers.Contract(address, abi, signerOrProvider || this.current);
  }
}

module.exports = {
  RotatingRpcProvider
};
