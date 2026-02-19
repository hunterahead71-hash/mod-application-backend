const { EmbedBuilder, PermissionsBitField } = require("discord.js");
const { getClient, ensureReady } = require("../config/discord");
const { supabase } = require("../config/supabase");
const { logger } = require("./logger");

// ==================== DM TEMPLATE RESOLVER ====================
async function getDMTemplate(type, defaults) {
  try {
    const { data, error } = await supabase
      .from('dm_templates')
      .select('*')
      .eq('type', type)
      .single();

    if (error || !data) return defaults;

    let color = defaults.color;
    if (data.color_hex && typeof data.color_hex === 'string') {
      const hex = data.color_hex.replace('#', '');
      const parsed = parseInt(hex, 16);
      if (!Number.isNaN(parsed)) {
        color = parsed;
      }
    }

    return {
      title: data.title || defaults.title,
      body: data.body || defaults.body,
      footer: data.footer || defaults.footer,
      color
    };
  } catch (e) {
    logger.warn(`DM template lookup failed for type=${type}:`, e.message);
    return defaults;
  }
}

// ==================== FIXED: DM WITH EXPLICIT CHANNEL CREATION ====================
async function sendDM(userId, title, description, color, footer = null) {
  try {
    const client = getClient();
    if (!client) {
      logger.error("❌ No Discord client");
      return false;
    }

    if (!await ensureReady()) {
      logger.error("❌ Bot not ready");
      return false;
    }

    // Fetch user
    let user;
    try {
      user = await client.users.fetch(userId);
    } catch (e) {
      logger.error(`❌ Cannot fetch user ${userId}:`, e.message);
      return false;
    }

    // ===== CRITICAL: Create DM channel explicitly =====
    let dmChannel;
    try {
      dmChannel = await user.createDM();
    } catch (e) {
      logger.error(`❌ Cannot create DM with ${userId}:`, e.message);
      return false;
    }

    // Create embed
    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();

    if (footer) {
      embed.setFooter({ text: footer });
    }

    // Send
    try {
      await dmChannel.send({ embeds: [embed] });
      logger.success(`✅ DM sent to ${user.tag}`);
      return true;
    } catch (e) {
      if (e.code === 50007) {
        logger.info(`📵 User ${user.tag} has DMs disabled`);
        return true; // Not a bot error
      }
      logger.error(`❌ DM send failed:`, e.message);
      return false;
    }
  } catch (error) {
    logger.error("❌ sendDM error:", error);
    return false;
  }
}

// ==================== FIXED: ROLE ASSIGNMENT ====================
async function assignModRole(userId, username = 'User') {
  logger.info(`\n🎯 assignModRole for ${username} (${userId})`);

  try {
    const client = getClient();
    if (!client) return { success: false, error: "No client" };
    if (!await ensureReady()) return { success: false, error: "Bot not ready" };
    if (!process.env.DISCORD_GUILD_ID) {
      return { success: false, error: "Missing DISCORD_GUILD_ID" };
    }

    const guildId = process.env.DISCORD_GUILD_ID;
    
    // Fetch roles from database first
    let roleIds = [];
    try {
      const { data: roles, error: dbError } = await supabase
        .from('mod_roles')
        .select('role_id');
      
      if (!dbError && roles && roles.length > 0) {
        roleIds = roles.map(r => r.role_id).filter(id => id);
        logger.info(`📋 Found ${roleIds.length} role(s) in database`);
      }
    } catch (dbErr) {
      logger.warn("Error fetching roles from DB:", dbErr.message);
    }
    
    // Fallback to env var if database is empty
    if (roleIds.length === 0 && process.env.MOD_ROLE_ID) {
      roleIds = process.env.MOD_ROLE_ID.split(',').map(id => id.trim()).filter(id => id);
      logger.info(`📋 Using ${roleIds.length} role(s) from environment variable`);
    }

    if (roleIds.length === 0) {
      return { success: false, error: "No role IDs configured" };
    }

    // Fetch guild, with fallback if DISCORD_GUILD_ID is invalid
    let guild;
    try {
      guild = await client.guilds.fetch(guildId);
    } catch {
      // Fallback: try to pick a sensible default guild
      const cachedGuilds = client.guilds.cache;
      if (!cachedGuilds || cachedGuilds.size === 0) {
        return { success: false, error: "Guild not found" };
      }
      const voidGuild = cachedGuilds.find(g => g.name && g.name.toLowerCase().includes('void'));
      guild = voidGuild || cachedGuilds.first();
      logger.warn(`Guild ${guildId} not found. Falling back to guild ${guild.name} (${guild.id}) for role assignment.`);
    }

    // ===== CRITICAL: Force fetch member (bypass cache for mobile) =====
    let member;
    try {
      member = await guild.members.fetch({ user: userId, force: true });
    } catch {
      return { success: false, error: "User not in guild" };
    }

    // Bot permissions
    const botMember = await guild.members.fetch(client.user.id);
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return { success: false, error: "Bot lacks Manage Roles" };
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

    // Send welcome DM if any roles assigned
    let dmSent = false;
    if (assigned.length > 0) {
      const roleNames = assigned.map(r => r.name).join(', ');
      const defaults = {
        title: '🎉 Welcome to the Void Esports Mod Team!',
        body: `Congratulations ${username}! Your application was **approved**.\n\nYou've been granted: **${roleNames}**.\n\n**Next Steps:**\n1. Read #staff-rules-and-info\n2. Introduce yourself in #staff-introductions\n3. Join next mod training\n\nWelcome aboard!`,
        footer: 'Welcome to the Mod Team!',
        color: 0x3ba55c
      };

      const template = await getDMTemplate('accept', defaults);
      const body = template.body
        .replace(/\{username\}/g, username)
        .replace(/\{roles\}/g, roleNames);

      dmSent = await sendDM(
        userId,
        template.title,
        body,
        template.color,
        template.footer
      );
    }

    return {
      success: true,
      message: `Assigned ${assigned.length}, failed ${failed.length}`,
      assigned,
      failed,
      dmSent
    };

  } catch (error) {
    logger.error("❌ assignModRole error:", error);
    return { success: false, error: error.message };
  }
}

// ==================== REJECTION DM ====================
async function sendRejectionDM(userId, username, reason) {
  const defaults = {
    title: '❌ Application Status Update',
    body: `Hello ${username},\n\nAfter review, your moderator application has **not been approved**.\n\n**Reason:** ${reason}\n\nYou may reapply in 30 days.\n\nThank you for your interest.`,
    footer: 'Better luck next time!',
    color: 0xed4245
  };

  const template = await getDMTemplate('reject', defaults);
  const body = template.body
    .replace(/\{username\}/g, username)
    .replace(/\{reason\}/g, reason || 'Not specified');

  return await sendDM(
    userId,
    template.title,
    body,
    template.color,
    template.footer
  );
}

module.exports = { sendDM, assignModRole, sendRejectionDM, getDMTemplate };
