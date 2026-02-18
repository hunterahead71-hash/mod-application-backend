const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { getBot, ensureBotReady } = require("../config/discord");
const { logger } = require("./logger");

async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    const bot = getBot();
    if (!bot) return false;
    if (!await ensureBotReady()) return false;

    let user;
    try {
      user = await bot.users.fetch(discordId);
    } catch {
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
      logger.success(`✅ DM sent to ${user.tag}`);
      return true;
    } catch (dmError) {
      if (dmError.code === 50007) {
        logger.info(`📵 User ${user.tag} has DMs disabled`);
        return true; // treat as success because it's not a bot error
      }
      return false;
    }
  } catch (error) {
    logger.error("DM error:", error.message);
    return false;
  }
}

async function assignModRole(discordId, discordUsername = 'User') {
  logger.info(`\n🎯 assignModRole called for ${discordUsername} (${discordId})`);
  try {
    const bot = getBot();
    if (!bot) return { success: false, error: "Bot not initialized" };
    if (!await ensureBotReady()) return { success: false, error: "Bot not ready" };
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      return { success: false, error: "Missing Discord env vars" };
    }

    const guildId = process.env.DISCORD_GUILD_ID;
    const roleIds = process.env.MOD_ROLE_ID.split(',').map(id => id.trim()).filter(id => id);

    if (roleIds.length === 0) return { success: false, error: "No role IDs configured" };

    // Fetch guild
    let guild;
    try {
      guild = await bot.guilds.fetch(guildId);
    } catch {
      return { success: false, error: "Guild not found" };
    }

    // Fetch member
    let member;
    try {
      member = await guild.members.fetch(discordId);
    } catch {
      return { success: false, error: "User not in guild" };
    }

    // Bot permissions
    const botMember = await guild.members.fetch(bot.user.id);
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return { success: false, error: "Bot lacks Manage Roles permission" };
    }

    const assigned = [];
    const failed = [];

    for (const roleId of roleIds) {
      try {
        const role = await guild.roles.fetch(roleId);
        if (!role) {
          failed.push({ id: roleId, reason: 'not found' });
          continue;
        }

        if (role.position >= botMember.roles.highest.position) {
          failed.push({ id: roleId, name: role.name, reason: 'hierarchy' });
          continue;
        }

        if (member.roles.cache.has(role.id)) {
          assigned.push({ id: role.id, name: role.name });
          continue;
        }

        await member.roles.add(role);
        assigned.push({ id: role.id, name: role.name });
        logger.success(`✅ Assigned ${role.name}`);
      } catch (e) {
        failed.push({ id: roleId, reason: e.message });
      }
    }

    // Send welcome DM if at least one role assigned
    let dmSent = false;
    if (assigned.length > 0) {
      const roleNames = assigned.map(r => r.name).join(', ');
      dmSent = await sendDMToUser(
        discordId,
        '🎉 Welcome to the Void Esports Mod Team!',
        `Congratulations ${discordUsername}! Your application was **approved**.\n\nYou've been granted: **${roleNames}**.\n\n**Next Steps:**\n1. Read #staff-rules-and-info\n2. Introduce yourself in #staff-introductions\n3. Join our next mod training\n\nWe're excited to have you on the team!`,
        0x3ba55c,
        'Welcome to the Mod Team!'
      );
    }

    return {
      success: failed.length === 0,
      message: `Assigned ${assigned.length}, failed ${failed.length}`,
      assigned,
      failed,
      dmSent
    };

  } catch (error) {
    logger.error("assignModRole critical error:", error.message);
    return { success: false, error: error.message };
  }
}

async function sendRejectionDM(discordId, discordUsername, reason) {
  return await sendDMToUser(
    discordId,
    '❌ Application Status Update',
    `Hello ${discordUsername},\n\nAfter review, your moderator application has **not been approved**.\n\n**Reason:** ${reason}\n\nYou may reapply in 30 days.\n\nThank you for your interest.`,
    0xed4245,
    'Better luck next time!'
  );
}

module.exports = { sendDMToUser, assignModRole, sendRejectionDM };
