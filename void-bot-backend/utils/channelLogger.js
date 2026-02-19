/**
 * Channel Logger - No circular dependency with discord config.
 * Call setClient(client) from discord.js when bot is ready.
 */
const { EmbedBuilder } = require("discord.js");
const { logger } = require("./logger");

const LOG_CHANNEL_ID = '1474079570641686655';
const LOG_GUILD_ID = '1351362266246680626';

let _client = null;

function setClient(client) {
  _client = client;
}

async function logToChannel(title, description, color = 0x5865f2, fields = []) {
  try {
    if (!_client || !_client.isReady()) {
      logger.warn("Bot not ready, skipping log to channel");
      return false;
    }

    const guild = await _client.guilds.fetch(LOG_GUILD_ID).catch(() => null);
    if (!guild) {
      logger.warn(`Guild ${LOG_GUILD_ID} not found for logging`);
      return false;
    }

    const channel = await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
    if (!channel) {
      logger.warn(`Channel ${LOG_CHANNEL_ID} not found for logging`);
      return false;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();

    if (fields.length > 0) {
      embed.addFields(fields);
    }

    await channel.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.error("Error logging to channel:", error);
    return false;
  }
}

module.exports = { logToChannel, setClient };
