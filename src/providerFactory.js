const { JsonRpcProvider, WebSocketProvider } = require('ethers');

async function createProvider(rpcConfig, logger) {
  const httpProvider = new JsonRpcProvider(rpcConfig.httpUrl, 42161, {
    staticNetwork: true,
    polling: true,
    pollingInterval: rpcConfig.pollingIntervalMs ?? 1000
  });

  if (!rpcConfig.wsUrl || rpcConfig.enableWs !== true) {
    logger.info('Using HTTP RPC provider');
    return httpProvider;
  }

  try {
    const wsProvider = new WebSocketProvider(rpcConfig.wsUrl, 42161, {
      staticNetwork: true
    });

    attachWsGuards(wsProvider, logger);
    await withTimeout(wsProvider.getBlockNumber(), rpcConfig.wsHandshakeTimeoutMs ?? 2500);
    logger.info('Using WebSocket RPC provider');
    return wsProvider;
  } catch (error) {
    logger.warn('WebSocket RPC failed, falling back to HTTP provider', {
      wsUrl: rpcConfig.wsUrl,
      reason: error.message
    });
    return httpProvider;
  }
}

function attachWsGuards(provider, logger) {
  const socket = provider.websocket;
  if (!socket || typeof socket.on !== 'function') {
    return;
  }

  socket.on('error', (error) => {
    logger.warn('WebSocket transport error detected; scanner will keep using the current provider instance', {
      reason: error.message
    });
  });

  socket.on('close', (code) => {
    logger.warn('WebSocket transport closed', { code });
  });
}

async function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

module.exports = { createProvider };
