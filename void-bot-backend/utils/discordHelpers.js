const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { bot, ensureBotReady } = require("../config/discord");
const { logger } = require("./logger");

// Enhanced function to send DM to user
async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    logger.info(`Attempting to send DM to ${discordId}: ${title}`);
    
    if (!await ensureBotReady()) {
      logger.warn("Bot not ready for DM");
      return false;
    }
    
    let user;
    try {
      user = await bot.users.fetch(discordId);
      if (!user) {
        logger.warn(`User ${discordId} not found`);
        return false;
      }
    } catch (error) {
      logger.warn(`Could not fetch user ${discordId}:`, error.message);
      return false;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: footer || 'Void Esports Mod Team' });

    try {
      await user.send({ embeds: [embed] });
      logger.success(`DM sent to ${user.tag} (${user.id})`);
      return true;
    } catch (dmError) {
      logger.error(`Failed to send DM to ${user.tag}:`, dmError.message);
      
      if (dmError.code === 50007) {
        logger.info(`User ${user.tag} has DMs disabled`);
        return true;
      }
      
      return false;
    }
  } catch (error) {
    logger.error(`Unexpected error in sendDMToUser:`, error.message);
    return false;
  }
}

// Function to assign mod role - ALWAYS returns success for UI
async function assignModRole(discordId, discordUsername = 'User') {
  logger.info(`\n🎯 ATTEMPTING TO ASSIGN MOD ROLE`);
  logger.info(`   User: ${discordUsername} (${discordId})`);
  
  try {
    if (!await ensureBotReady()) {
      logger.warn("Bot is not ready/connected");
      return { 
        uiSuccess: true, 
        success: false, 
        error: "Bot not ready. Please check if bot is online and has proper intents enabled." 
      };
    }
    
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      logger.warn("Missing environment variables");
      return { 
        uiSuccess: true, 
        success: false, 
        error: "Missing Discord configuration." 
      };
    }
    
    const guildId = process.env.DISCORD_GUILD_ID;
    const roleId = process.env.MOD_ROLE_ID;
    
    let guild;
    try {
      guild = await bot.guilds.fetch(guildId);
      logger.info(`✅ Found guild: ${guild.name} (${guild.id})`);
    } catch (guildError) {
      logger.error(`Could not fetch guild:`, guildError.message);
      return { 
        uiSuccess: true, 
        success: false, 
        error: `Guild not found.` 
      };
    }
    
    let member;
    try {
      member = await guild.members.fetch(discordId);
      logger.info(`✅ Found member: ${member.user.tag} (${member.id})`);
    } catch (memberError) {
      logger.error(`Could not fetch member:`, memberError.message);
      return { 
        uiSuccess: true, 
        success: false, 
        error: `User not found in the server.` 
      };
    }
    
    let role;
    try {
      role = await guild.roles.fetch(roleId);
      if (!role) {
        logger.warn(`Role ${roleId} not found`);
        return { 
          uiSuccess: true, 
          success: false, 
          error: `Mod role not found.` 
        };
      }
      logger.info(`✅ Found role: ${role.name} (${role.id})`);
    } catch (roleError) {
      logger.error(`Error fetching role:`, roleError.message);
      return { 
        uiSuccess: true, 
        success: false, 
        error: `Could not fetch role.` 
      };
    }
    
    const botMember = await guild.members.fetch(bot.user.id);
    
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      logger.warn("Bot lacks ManageRoles permission");
      return { 
        uiSuccess: true, 
        success: false, 
        error: "Bot lacks 'Manage Roles' permission." 
      };
    }
    
    const botHighestRole = botMember.roles.highest;
    
    if (role.position >= botHighestRole.position) {
      logger.warn("Role hierarchy issue: Mod role is higher than bot's highest role");
      return { 
        uiSuccess: true, 
        success: false, 
        error: "Role hierarchy issue. Bot's role must be higher than the mod role." 
      };
    }
    
    if (member.roles.cache.has(role.id)) {
      logger.info(`Member already has the role`);
      return { 
        uiSuccess: true, 
        success: true, 
        message: "Member already has the role", 
        dmSent: false 
      };
    }
    
    logger.info(`Assigning role "${role.name}" to ${member.user.tag}...`);
    try {
      await member.roles.add(role);
      logger.success(`SUCCESS: Assigned mod role to ${member.user.tag}`);
      
      logger.info(`Attempting to send welcome DM...`);
      const dmSuccess = await sendDMToUser(
        discordId,
        '🎉 Welcome to the Void Esports Mod Team!',
        `Congratulations ${discordUsername}! Your moderator application has been **approved**.\n\n` +
        `You have been granted the **${role.name}** role.\n\n` +
        `**Next Steps:**\n` +
        `1. Read #staff-rules-and-info\n` +
        `2. Introduce yourself in #staff-introductions\n` +
        `3. Join our next mod training session\n` +
        `4. Start with ticket duty in #mod-tickets\n\n` +
        `If you have any questions, ping @Senior Staff in #staff-chat.\n\n` +
        `We're excited to have you on the team!`,
        0x3ba55c,
        'Welcome to the Mod Team!'
      );
      
      if (dmSuccess) {
        logger.success(`Welcome DM sent to ${member.user.tag}`);
      } else {
        logger.info(`Could not send welcome DM (user may have DMs disabled)`);
      }
      
      return { 
        uiSuccess: true,
        success: true, 
        message: `Successfully assigned ${role.name} to ${member.user.tag}`,
        dmSent: dmSuccess,
        details: {
          username: member.user.tag,
          role: role.name,
          guild: guild.name
        }
      };
      
    } catch (assignError) {
      logger.error('ERROR assigning role:', assignError.message);
      
      return { 
        uiSuccess: true,
        success: false, 
        error: `Failed to assign role: ${assignError.message}` 
      };
    }
    
  } catch (error) {
    logger.error('CRITICAL ERROR in assignModRole:', error.message);
    return { 
      uiSuccess: true,
      success: false, 
      error: `Unexpected error: ${error.message}` 
    };
  }
}

// Function to send rejection DM
async function sendRejectionDM(discordId, discordUsername, reason = "Not specified") {
  try {
    logger.info(`Sending rejection DM to ${discordUsername} (${discordId})`);
    
    const success = await sendDMToUser(
      discordId,
      '❌ Application Status Update',
      `Hello ${discordUsername},\n\n` +
      `After careful review, your moderator application has **not been approved** at this time.\n\n` +
      `**Reason:** ${reason}\n\n` +
      `**You can reapply in 30 days.**\n` +
      `In the meantime, remain active in the community and consider improving your knowledge of our rules and procedures.\n\n` +
      `Thank you for your interest in joining the Void Esports team!`,
      0xed4245,
      'Better luck next time!'
    );
    
    return success;
  } catch (error) {
    logger.error('Error in sendRejectionDM:', error);
    return false;
  }
}

module.exports = { 
  sendDMToUser, 
  assignModRole, 
  sendRejectionDM 
};
