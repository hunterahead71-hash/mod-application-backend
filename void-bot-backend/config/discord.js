const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
const { logger } = require("../utils/logger");

let bot = null;
let botReady = false;
let botLoginAttempts = 0;

function createBot() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds, 
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildPresences
    ],
    partials: ['CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'REACTION', 'USER']
  });
}

function setupBotEvents(bot) {
  bot.on('ready', async () => {
    botReady = true;
    botLoginAttempts = 0;
    
    logger.botReady(bot.user.tag, bot.guilds.cache.size);
    
    // Set bot status
    bot.user.setPresence({
      activities: [{ 
        name: 'Mod Applications', 
        type: ActivityType.Watching
      }],
      status: 'online'
    });
    
    // Verify bot permissions if guild ID is set
    if (process.env.DISCORD_GUILD_ID) {
      try {
        const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const botMember = await guild.members.fetch(bot.user.id);
        
        logger.botPermissions(botMember, guild, process.env.MOD_ROLE_ID);
      } catch (error) {
        logger.error("Error checking bot permissions:", error.message);
      }
    }
  });

  bot.on('error', (error) => {
    logger.error('Discord bot error:', error.message);
  });

  bot.on('warn', (warning) => {
    logger.warn('Discord bot warning:', warning);
  });

  bot.on('guildMemberAdd', async (member) => {
    logger.info(`New member joined: ${member.user.tag}`);
  });
}

async function loginBot() {
  logger.info("Attempting bot login...");
  
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.error("CRITICAL: DISCORD_BOT_TOKEN not set!");
    logger.info("Add to Render.com: DISCORD_BOT_TOKEN=your_token_here");
    return false;
  }
  
  const token = process.env.DISCORD_BOT_TOKEN;
  
  if (!token.startsWith("MT") && !token.startsWith("NT") && !token.startsWith("Mz")) {
    logger.error("Invalid token format! Should start with 'MT', 'NT', or 'Mz'");
    return false;
  }
  
  try {
    await bot.login(token);
    botReady = true;
    logger.success("Bot login successful!");
    return true;
  } catch (error) {
    logger.error("Bot login failed:", error.message);
    
    if (error.message.includes("disallowed intents")) {
      logger.info("FIX: Go to Discord Developer Portal → Bot → Enable:");
      logger.info("   - SERVER MEMBERS INTENT (REQUIRED)");
      logger.info("   - MESSAGE CONTENT INTENT (REQUIRED)");
      logger.info("   - PRESENCE INTENT (optional)");
    } else if (error.message.includes("Incorrect login details")) {
      logger.info("Token is invalid. Reset in Discord Developer Portal");
    }
    
    return false;
  }
}

async function ensureBotReady() {
  if (botReady && bot.isReady()) return true;
  
  logger.info("Bot not ready, attempting to reconnect...");
  
  if (!bot.isReady() && process.env.DISCORD_BOT_TOKEN) {
    const success = await loginBot();
    if (success) {
      botReady = true;
      return true;
    }
  }
  
  return false;
}

async function startBotWithRetry() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.warn("DISCORD_BOT_TOKEN not set - bot features disabled");
    return;
  }
  
  logger.info("Starting Discord bot...");
  botLoginAttempts++;
  
  try {
    await loginBot();
  } catch (error) {
    logger.error(`Bot startup failed (attempt ${botLoginAttempts}):`, error.message);
    
    if (botLoginAttempts < 3) {
      logger.info(`Retrying in 10 seconds...`);
      setTimeout(startBotWithRetry, 10000);
    }
  }
}

function initializeBot() {
  bot = createBot();
  setupBotEvents(bot);
  startBotWithRetry();
}

module.exports = { 
  bot, 
  botReady, 
  ensureBotReady, 
  initializeBot 
};
