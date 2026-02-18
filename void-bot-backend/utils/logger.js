const logger = {
  info: (...args) => console.log('\x1b[36m[INFO]\x1b[0m', ...args),
  success: (...args) => console.log('\x1b[32m[SUCCESS]\x1b[0m', ...args),
  warn: (...args) => console.log('\x1b[33m[WARN]\x1b[0m', ...args),
  error: (...args) => console.error('\x1b[31m[ERROR]\x1b[0m', ...args),
  request: (method, path) => console.log(`\x1b[35m[${method}]\x1b[0m ${path}`)
};

module.exports = { logger };
