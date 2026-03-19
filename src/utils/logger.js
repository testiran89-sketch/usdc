class Logger {
  info(message, meta) {
    console.log(`[INFO] ${new Date().toISOString()} ${message}`, meta ?? '');
  }

  warn(message, meta) {
    console.warn(`[WARN] ${new Date().toISOString()} ${message}`, meta ?? '');
  }

  error(message, meta) {
    console.error(`[ERROR] ${new Date().toISOString()} ${message}`, meta ?? '');
  }
}

module.exports = { Logger };
