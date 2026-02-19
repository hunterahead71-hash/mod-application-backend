/**
 * Holds Discord client and ensureReady - breaks circular dependency.
 * Set via setDiscordRefs() from discord.js when ready.
 */
let _client = null;
let _ensureReady = null;

function setDiscordRefs(client, ensureReadyFn) {
  _client = client;
  _ensureReady = ensureReadyFn;
}

function getClient() {
  return _client;
}

async function ensureReady() {
  if (_ensureReady) return _ensureReady();
  return !!_client?.isReady();
}

module.exports = { setDiscordRefs, getClient, ensureReady };
