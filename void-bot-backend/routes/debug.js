const express = require("express");
const { PermissionsBitField } = require("discord.js");
const { bot, botReady, ensureBotReady } = require("../config/discord");
const { assignModRole, sendDMToUser } = require("../utils/discordHelpers");
const { logger } = require("../utils/logger");

const router = express.Router();

// Bot status
router.get("/bot", async (req, res) => {
  try {
    const botStatus = {
      isReady: bot.isReady(),
      botReady: botReady,
      user: bot.user ? bot.user.tag : "Not logged in",
      userId: bot.user ? bot.user.id : "N/A",
      guilds: bot.guilds.cache.size,
      environment: {
        tokenSet: !!process.env.DISCORD_BOT_TOKEN,
        tokenLength: process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.length : 0,
        guildId: process.env.DISCORD_GUILD_ID || "NOT SET",
        modRoleId: process.env.MOD_ROLE_ID || "NOT SET",
        clientId: process.env.DISCORD_CLIENT_ID || "NOT SET"
      }
    };
    
    if (process.env.DISCORD_GUILD_ID && bot.isReady()) {
      try {
        const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const botMember = await guild.members.fetch(bot.user.id);
        
        botStatus.permissions = {
          manageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles),
          sendMessages: botMember.permissions.has(PermissionsBitField.Flags.SendMessages),
          viewChannel: botMember.permissions.has(PermissionsBitField.Flags.ViewChannel)
        };
        
        if (process.env.MOD_ROLE_ID) {
          const modRole = guild.roles.cache.get(process.env.MOD_ROLE_ID);
          botStatus.modRole = modRole ? {
            name: modRole.name,
            id: modRole.id,
            position: modRole.position,
            exists: true
          } : { exists: false };
          
          botStatus.roleHierarchy = {
            botHighestRole: botMember.roles.highest.position,
            modRolePosition: modRole ? modRole.position : null,
            canAssign: modRole ? (modRole.position < botMember.roles.highest.position) : false
          };
        }
      } catch (error) {
        botStatus.permissions = { error: error.message };
      }
    }
    
    res.json(botStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test bot connection
router.get("/bot-test", async (req, res) => {
  try {
    if (!process.env.DISCORD_BOT_TOKEN) {
      return res.json({
        success: false,
        error: "DISCORD_BOT_TOKEN not set"
      });
    }
    
    const token = process.env.DISCORD_BOT_TOKEN;
    const isValidFormat = token.startsWith("MT") || token.startsWith("NT") || token.startsWith("Mz");
    
    if (!isValidFormat) {
      return res.json({
        success: false,
        error: "Invalid token format"
      });
    }
    
    if (!bot.isReady()) {
      try {
        await bot.login(token);
      } catch (loginError) {
        return res.json({
          success: false,
          error: "Bot login failed",
          message: loginError.message
        });
      }
    }
    
    res.json({
      success: true,
      message: "Bot is connected!",
      bot: {
        tag: bot.user.tag,
        id: bot.user.id,
        guilds: bot.guilds.cache.size
      }
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
  }
});

// Test role assignment
router.post("/bot/test-assign-role", async (req, res) => {
  try {
    const { userId, testUsername = "Test User" } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }
    
    logger.info(`Testing role assignment for ${userId}`);
    
    const result = await assignModRole(userId, testUsername);
    
    res.json({
      test: "Role Assignment Test",
      timestamp: new Date().toISOString(),
      userId,
      result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test DM
router.post("/bot/test-dm", async (req, res) => {
  try {
    const { userId, message = "Test DM from bot" } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }
    
    logger.info(`Testing DM to ${userId}`);
    
    const success = await sendDMToUser(
      userId,
      '🧪 Test DM',
      message,
      0x00ffea,
      'Test Footer'
    );
    
    res.json({
      test: "DM Test",
      timestamp: new Date().toISOString(),
      userId,
      success
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
