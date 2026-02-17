const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { getBot, ensureBotReady } = require("../config/discord");
const { logger } = require("./logger");

// Enhanced function to send DM to user
async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    logger.info(`📨 Attempting to send DM to ${discordId}: ${title}`);
    
    const bot = getBot();
    if (!bot) {
      logger.error("❌ Bot instance is null!");
      return false;
    }
    
    if (!await ensureBotReady()) {
      logger.warn("❌ Bot not ready for DM");
      return false;
    }
    
    let user;
    try {
      user = await bot.users.fetch(discordId);
      if (!user) {
        logger.warn(`❌ User ${discordId} not found`);
        return false;
      }
    } catch (error) {
      logger.warn(`❌ Could not fetch user ${discordId}:`, error.message);
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
      logger.success(`✅ DM sent to ${user.tag} (${user.id})`);
      return true;
    } catch (dmError) {
      logger.error(`❌ Failed to send DM to ${user.tag}:`, dmError.message);
      
      if (dmError.code === 50007) {
        logger.info(`📵 User ${user.tag} has DMs disabled`);
        return true; // Still return true since it's not a bot error
      }
      
      return false;
    }
  } catch (error) {
    logger.error(`❌ Unexpected error in sendDMToUser:`, error.message);
    return false;
  }
}

// MODIFIED: Assign multiple roles from comma-separated MOD_ROLE_ID env variable
async function assignModRole(discordId, discordUsername = 'User') {
  logger.info(`\n🎯 ATTEMPTING TO ASSIGN MOD ROLES`);
  logger.info(`   User: ${discordUsername} (${discordId})`);
  
  try {
    const bot = getBot();
    if (!bot) {
      logger.error("❌ Bot instance is null!");
      return { success: false, error: "Bot not initialized" };
    }
    
    if (!await ensureBotReady()) {
      logger.error("❌ Bot is not ready/connected");
      return { success: false, error: "Bot not ready" };
    }
    
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      logger.error("❌ Missing environment variables");
      return { success: false, error: "Missing Discord configuration" };
    }
    
    const guildId = process.env.DISCORD_GUILD_ID;
    // Split the role IDs by comma and trim whitespace
    const roleIds = process.env.MOD_ROLE_ID.split(',').map(id => id.trim()).filter(id => id.length > 0);
    
    if (roleIds.length === 0) {
      logger.error("❌ No valid role IDs found in MOD_ROLE_ID");
      return { success: false, error: "No role IDs configured" };
    }
    
    logger.info(`🔍 Guild ID: ${guildId}`);
    logger.info(`🔍 Role IDs to assign: ${roleIds.join(', ')}`);
    
    // Fetch guild
    let guild;
    try {
      guild = await bot.guilds.fetch(guildId);
      logger.success(`✅ Found guild: ${guild.name} (${guild.id})`);
    } catch (guildError) {
      logger.error(`❌ Could not fetch guild:`, guildError.message);
      return { success: false, error: `Guild not found.` };
    }
    
    // Fetch member
    let member;
    try {
      member = await guild.members.fetch(discordId);
      logger.success(`✅ Found member: ${member.user.tag} (${member.id})`);
    } catch (memberError) {
      logger.error(`❌ Could not fetch member:`, memberError.message);
      return { success: false, error: `User not found in the server.` };
    }
    
    // Check bot permissions
    const botMember = await guild.members.fetch(bot.user.id);
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      logger.error("❌ Bot lacks ManageRoles permission");
      return { success: false, error: "Bot lacks 'Manage Roles' permission." };
    }
    
    // For each role ID, fetch role, check hierarchy, and assign
    const assignedRoles = [];
    const failedRoles = [];
    
    for (const roleId of roleIds) {
      try {
        const role = await guild.roles.fetch(roleId);
        if (!role) {
          logger.warn(`⚠️ Role ${roleId} not found, skipping`);
          failedRoles.push({ id: roleId, reason: 'not found' });
          continue;
        }
        
        // Check hierarchy
        const botHighestRole = botMember.roles.highest;
        if (role.position >= botHighestRole.position) {
          logger.warn(`⚠️ Role ${role.name} (${role.id}) is higher than bot's highest role, skipping`);
          failedRoles.push({ id: roleId, name: role.name, reason: 'hierarchy' });
          continue;
        }
        
        // Check if already has role
        if (member.roles.cache.has(role.id)) {
          logger.info(`ℹ️ Member already has role ${role.name}`);
          assignedRoles.push({ id: role.id, name: role.name });
          continue;
        }
        
        // Assign role
        await member.roles.add(role);
        logger.success(`✅ Assigned role ${role.name} to ${member.user.tag}`);
        assignedRoles.push({ id: role.id, name: role.name });
        
      } catch (roleError) {
        logger.error(`❌ Error assigning role ${roleId}:`, roleError.message);
        failedRoles.push({ id: roleId, reason: roleError.message });
      }
    }
    
    // Send welcome DM only if at least one role was assigned (optional)
    let dmSent = false;
    if (assignedRoles.length > 0) {
      const roleNames = assignedRoles.map(r => r.name).join(', ');
      dmSent = await sendDMToUser(
        discordId,
        '🎉 Welcome to the Void Esports Mod Team!',
        `Congratulations ${discordUsername}! Your moderator application has been **approved**.\n\n` +
        `You have been granted the following role(s): **${roleNames}**.\n\n` +
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
    }
    
    return {
      success: failedRoles.length === 0, // overall success if no failures
      message: `Assigned ${assignedRoles.length} roles, failed ${failedRoles.length}`,
      assigned: assignedRoles,
      failed: failedRoles,
      dmSent
    };
    
  } catch (error) {
    logger.error('❌ CRITICAL ERROR in assignModRole:', error.message);
    logger.error('Stack trace:', error.stack);
    return { success: false, error: `Unexpected error: ${error.message}` };
  }
}

// Function to send rejection DM (unchanged)
async function sendRejectionDM(discordId, discordUsername, reason = "Not specified") {
  try {
    logger.info(`📨 Sending rejection DM to ${discordUsername} (${discordId})`);
    
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
    logger.error('❌ Error in sendRejectionDM:', error);
    return false;
  }
}

module.exports = { 
  sendDMToUser, 
  assignModRole, 
  sendRejectionDM 
};
