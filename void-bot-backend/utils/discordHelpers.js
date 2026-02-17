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
        return true;
      }
      
      return false;
    }
  } catch (error) {
    logger.error(`❌ Unexpected error in sendDMToUser:`, error.message);
    return false;
  }
}

// FIXED function to assign mod role
async function assignModRole(discordId, discordUsername = 'User') {
  logger.info(`\n🎯 ATTEMPTING TO ASSIGN MOD ROLE`);
  logger.info(`   User: ${discordUsername} (${discordId})`);
  
  try {
    const bot = getBot();
    if (!bot) {
      logger.error("❌ Bot instance is null! Make sure bot is initialized.");
      return { success: false, error: "Bot not initialized" };
    }
    
    // 1. Check if bot is ready
    if (!await ensureBotReady()) {
      logger.error("❌ Bot is not ready/connected");
      return { success: false, error: "Bot not ready" };
    }
    
    // 2. Check if required environment variables exist
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      logger.error("❌ Missing environment variables");
      return { success: false, error: "Missing Discord configuration" };
    }
    
    const guildId = process.env.DISCORD_GUILD_ID;
    const roleId = process.env.MOD_ROLE_ID;
    
    logger.info(`🔍 Guild ID: ${guildId}`);
    logger.info(`🔍 Role ID: ${roleId}`);
    
    // 3. Fetch guild
    let guild;
    try {
      guild = await bot.guilds.fetch(guildId);
      logger.success(`✅ Found guild: ${guild.name} (${guild.id})`);
    } catch (guildError) {
      logger.error(`❌ Could not fetch guild:`, guildError.message);
      return { success: false, error: `Guild not found. Bot might not be in this server.` };
    }
    
    // 4. Fetch member
    let member;
    try {
      member = await guild.members.fetch(discordId);
      logger.success(`✅ Found member: ${member.user.tag} (${member.id})`);
    } catch (memberError) {
      logger.error(`❌ Could not fetch member:`, memberError.message);
      return { success: false, error: `User not found in the server.` };
    }
    
    // 5. Fetch role
    let role;
    try {
      role = await guild.roles.fetch(roleId);
      if (!role) {
        logger.error(`❌ Role ${roleId} not found`);
        return { success: false, error: `Mod role not found.` };
      }
      logger.success(`✅ Found role: ${role.name} (${role.id})`);
    } catch (roleError) {
      logger.error(`❌ Error fetching role:`, roleError.message);
      return { success: false, error: `Could not fetch role.` };
    }
    
    // 6. Check bot permissions
    const botMember = await guild.members.fetch(bot.user.id);
    
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      logger.error("❌ Bot lacks ManageRoles permission");
      return { success: false, error: "Bot lacks 'Manage Roles' permission." };
    }
    logger.success("✅ Bot has ManageRoles permission");
    
    // 7. Check role hierarchy
    const botHighestRole = botMember.roles.highest;
    
    if (role.position >= botHighestRole.position) {
      logger.error("❌ Role hierarchy issue");
      return { success: false, error: "Role hierarchy issue. Bot's role must be higher than the mod role." };
    }
    logger.success("✅ Role hierarchy is valid");
    
    // 8. Check if member already has the role
    if (member.roles.cache.has(role.id)) {
      logger.info(`ℹ️ Member already has the role`);
      return { success: true, message: "Member already has the role", dmSent: false };
    }
    
    // 9. Assign the role
    logger.info(`🔄 Assigning role "${role.name}" to ${member.user.tag}...`);
    try {
      await member.roles.add(role);
      logger.success(`✅ SUCCESS: Assigned mod role to ${member.user.tag}`);
      
      // 10. Send welcome DM
      const dmSuccess = await sendDMToUser(
        discordId,
        '🎉 Welcome to the Void Esports Mod Team!',
        `Congratulations ${discordUsername}! Your moderator application has been **approved**.\n\n` +
        `You have been granted the **${role.name}** role.`,
        0x3ba55c,
        'Welcome to the Mod Team!'
      );
      
      return { 
        success: true, 
        message: `Successfully assigned ${role.name}`,
        dmSent: dmSuccess
      };
      
    } catch (assignError) {
      logger.error('❌ ERROR assigning role:', assignError.message);
      return { success: false, error: `Failed to assign role: ${assignError.message}` };
    }
    
  } catch (error) {
    logger.error('❌ CRITICAL ERROR in assignModRole:', error.message);
    return { success: false, error: `Unexpected error: ${error.message}` };
  }
}

// Function to send rejection DM
async function sendRejectionDM(discordId, discordUsername, reason = "Not specified") {
  try {
    logger.info(`📨 Sending rejection DM to ${discordUsername} (${discordId})`);
    
    const success = await sendDMToUser(
      discordId,
      '❌ Application Status Update',
      `Hello ${discordUsername},\n\n` +
      `After careful review, your moderator application has **not been approved** at this time.\n\n` +
      `**Reason:** ${reason}\n\n` +
      `**You can reapply in 30 days.**`,
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
