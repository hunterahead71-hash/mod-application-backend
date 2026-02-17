const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const { logger } = require("../utils/logger");

let botInstance = null;
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
    partials: [
      Partials.Channel, 
      Partials.GuildMember, 
      Partials.Message, 
      Partials.Reaction, 
      Partials.User
    ]
  });
}

function setupBotEvents(bot) {
  bot.on('ready', async () => {
    botReady = true;
    botLoginAttempts = 0;
    
    logger.success(`Discord bot ready as ${bot.user.tag}`);
    logger.info(`📊 Servers: ${bot.guilds.cache.size}`);
    
    // Log all servers for debugging
    bot.guilds.cache.forEach(guild => {
      logger.info(`   - ${guild.name} (${guild.id})`);
    });
    
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
        
        logger.info("🔍 Bot Permissions Check:");
        logger.info(`   - Manage Roles: ${botMember.permissions.has('ManageRoles') ? '✅' : '❌'}`);
        logger.info(`   - Send Messages: ${botMember.permissions.has('SendMessages') ? '✅' : '❌'}`);
        logger.info(`   - Read Messages: ${botMember.permissions.has('ViewChannel') ? '✅' : '❌'}`);
        
        if (process.env.MOD_ROLE_ID) {
          const modRole = guild.roles.cache.get(process.env.MOD_ROLE_ID);
          logger.info(`   - Mod Role Found: ${modRole ? `✅ ${modRole.name}` : '❌ Not Found'}`);
          
          if (modRole) {
            logger.info(`   - Role Position: ${modRole.position}`);
            logger.info(`   - Bot's Highest Role Position: ${botMember.roles.highest.position}`);
            
            if (modRole.position >= botMember.roles.highest.position) {
              logger.warn(`⚠️  WARNING: Mod role is higher than bot's highest role! Bot cannot assign this role.`);
            }
          }
        }
      } catch (error) {
        logger.error("❌ Error checking bot permissions:", error.message);
      }
    }
  });

  bot.on('error', (error) => {
    logger.error('❌ Discord bot error:', error.message);
  });

  bot.on('warn', (warning) => {
    logger.warn('⚠️ Discord bot warning:', warning);
  });
}

async function loginBot() {
  logger.info("🔐 Attempting bot login...");
  
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.error("❌ CRITICAL: DISCORD_BOT_TOKEN not set!");
    return false;
  }
  
  const token = process.env.DISCORD_BOT_TOKEN;
  
  try {
    await botInstance.login(token);
    botReady = true;
    logger.success("✅ Bot login successful!");
    return true;
  } catch (error) {
    logger.error("❌ Bot login failed:", error.message);
    
    if (error.message.includes("disallowed intents")) {
      logger.info("💡 FIX: Go to Discord Developer Portal → Bot → Enable:");
      logger.info("   - SERVER MEMBERS INTENT (REQUIRED)");
      logger.info("   - MESSAGE CONTENT INTENT (REQUIRED)");
    }
    
    return false;
  }
}

async function ensureBotReady() {
  if (!botInstance) {
    logger.error("❌ Bot instance is null!");
    return false;
  }
  
  if (botReady && botInstance.isReady()) return true;
  
  logger.info("🔄 Bot not ready, attempting to reconnect...");
  
  if (!botInstance.isReady() && process.env.DISCORD_BOT_TOKEN) {
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
    logger.warn("⚠️ DISCORD_BOT_TOKEN not set - bot features disabled");
    return;
  }
  
  logger.info("🤖 Starting Discord bot...");
  botLoginAttempts++;
  
  try {
    await loginBot();
  } catch (error) {
    logger.error(`❌ Bot startup failed (attempt ${botLoginAttempts}):`, error.message);
    
    if (botLoginAttempts < 3) {
      logger.info(`⏳ Retrying in 10 seconds...`);
      setTimeout(startBotWithRetry, 10000);
    }
  }
}

function initializeBot() {
  botInstance = createBot();
  setupBotEvents(botInstance);
  startBotWithRetry();
}

// Export both the bot instance and the functions
module.exports = { 
  bot: botInstance,  // This will be null initially but will be set after login
  getBot: () => botInstance, // Helper function to get the current bot instance
  botReady, 
  ensureBotReady, 
  initializeBot 
};
