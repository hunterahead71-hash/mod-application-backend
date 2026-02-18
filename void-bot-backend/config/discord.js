const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const { logger } = require("../utils/logger");
const { supabase } = require("./supabase");

// Import helpers dynamically to avoid circular dependency
let discordHelpers = null;

const client = new Client({
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

let botReady = false;
let loginAttempts = 0;

// ==================== DISCORD.JS v15 FIX: Use 'clientReady' not 'ready' ====================
client.on('clientReady', async () => {
  botReady = true;
  loginAttempts = 0;
  
  logger.success(`✅ Discord bot ready as ${client.user.tag}`);
  logger.info(`📊 Servers: ${client.guilds.cache.size}`);
  
  client.guilds.cache.forEach(guild => {
    logger.info(`   - ${guild.name} (${guild.id})`);
  });
  
  // Set presence
  client.user.setPresence({
    activities: [{ name: 'Mod Applications', type: ActivityType.Watching }],
    status: 'online'
  });

  // Check guild and roles
  if (process.env.DISCORD_GUILD_ID) {
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const botMember = await guild.members.fetch(client.user.id);
      
      logger.info("🔍 Bot Permissions Check:");
      logger.info(`   - Manage Roles: ${botMember.permissions.has('ManageRoles') ? '✅' : '❌'}`);
      logger.info(`   - Send Messages: ${botMember.permissions.has('SendMessages') ? '✅' : '❌'}`);
      logger.info(`   - Read Messages: ${botMember.permissions.has('ViewChannel') ? '✅' : '❌'}`);

      if (process.env.MOD_ROLE_ID) {
        const roleIds = process.env.MOD_ROLE_ID.split(',').map(id => id.trim());
        roleIds.forEach(roleId => {
          const role = guild.roles.cache.get(roleId);
          if (role) {
            logger.info(`   - Mod Role: ✅ ${role.name} (${role.id})`);
            logger.info(`      - Position: ${role.position}`);
            logger.info(`      - Bot's Highest Role: ${botMember.roles.highest.position}`);
            if (role.position >= botMember.roles.highest.position) {
              logger.warn(`⚠️  Role ${role.name} is higher than bot's highest role!`);
            }
          } else {
            logger.error(`❌ Mod Role ID ${roleId} not found in guild!`);
          }
        });
      }
    } catch (error) {
      logger.error("❌ Error checking guild:", error.message);
    }
  }
});

// Handle errors
client.on('error', (error) => {
  logger.error('❌ Discord client error:', error.message);
  botReady = false;
});

client.on('warn', (warning) => {
  logger.warn('⚠️ Discord client warning:', warning);
});

// ==================== BUTTON HANDLERS ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  
  logger.info(`🔘 Button clicked: ${interaction.customId} by ${interaction.user.tag}`);

  try {
    // IMMEDIATELY defer the interaction to prevent timeout
    // This is CRITICAL to fix "Unknown interaction" errors
    await interaction.deferUpdate().catch(err => {
      logger.error(`Failed to defer interaction: ${err.message}`);
      // Continue anyway
    });

    // Lazy load helpers to avoid circular dependency
    if (!discordHelpers) {
      discordHelpers = require("../utils/discordHelpers");
    }

    const [action, appId, discordId] = interaction.customId.split('_');

    if (action === 'accept') {
      await handleAccept(interaction, appId, discordId, discordHelpers);
    } else if (action === 'reject') {
      await handleReject(interaction, appId, discordId, discordHelpers);
    } else if (action === 'convo') {
      await handleConvo(interaction, appId);
    }
  } catch (error) {
    logger.error("❌ Button handler error:", error);
    try {
      await interaction.followUp({ 
        content: '❌ Error processing button. Check logs.', 
        ephemeral: true 
      }).catch(() => {});
    } catch {}
  }
});

// ==================== ACCEPT HANDLER ====================
async function handleAccept(interaction, appId, discordId, helpers) {
  try {
    // Get application
    const { data: app, error } = await supabase
      .from('applications')
      .select('*')
      .eq('id', appId)
      .single();

    if (error || !app) {
      return interaction.editReply('❌ Application not found.');
    }

    if (app.status !== 'pending') {
      return interaction.editReply(`❌ Already ${app.status}.`);
    }

    // Update database
    await supabase
      .from('applications')
      .update({
        status: 'accepted',
        reviewed_by: interaction.user.tag,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', appId);

    // Update original message
    if (interaction.message?.embeds.length) {
      const embed = interaction.message.embeds[0].toJSON();
      embed.color = 0x10b981;
      embed.fields.push({
        name: '✅ Accepted By',
        value: interaction.user.tag,
        inline: true
      });
      await interaction.message.edit({ embeds: [embed], components: [] });
    }

    // ===== CRITICAL: ACTUALLY ASSIGN ROLES =====
    let roleResult = null;
    try {
      // Force cache bypass for mobile users
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      await guild.members.fetch({ force: true }); // Force refresh cache
      
      roleResult = await helpers.assignModRole(discordId, app.discord_username);
      logger.success(`✅ Role assignment result:`, roleResult);
    } catch (roleError) {
      logger.error("❌ Role assignment error:", roleError);
    }

    // Send success message
    let reply = `✅ Application accepted!`;
    if (roleResult?.assigned?.length) {
      reply += `\n✅ Roles assigned: ${roleResult.assigned.map(r => r.name).join(', ')}`;
    }
    if (roleResult?.failed?.length) {
      reply += `\n⚠️ Failed roles: ${roleResult.failed.map(r => r.reason).join(', ')}`;
    }

    await interaction.editReply(reply);

  } catch (error) {
    logger.error("❌ Accept error:", error);
    await interaction.editReply(`❌ Error: ${error.message}`).catch(() => {});
  }
}

// ==================== REJECT HANDLER ====================
async function handleReject(interaction, appId, discordId, helpers) {
  try {
    const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

    const modal = new ModalBuilder()
      .setCustomId(`reject_modal_${appId}`)
      .setTitle('Reject Application');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Rejection Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Enter reason for rejection...')
      .setRequired(true)
      .setValue('Insufficient score or protocol knowledge');

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    
    // Show modal (we already deferred, so this is fine)
    await interaction.showModal(modal);

    const modalSubmit = await interaction.awaitModalSubmit({
      filter: i => i.customId === `reject_modal_${appId}`,
      time: 60000
    });

    await modalSubmit.deferUpdate();
    const reason = modalSubmit.fields.getTextInputValue('reason');

    // Get application
    const { data: app, error } = await supabase
      .from('applications')
      .select('*')
      .eq('id', appId)
      .single();

    if (error || !app) {
      return modalSubmit.editReply('❌ Application not found.');
    }

    if (app.status !== 'pending') {
      return modalSubmit.editReply(`❌ Already ${app.status}.`);
    }

    // Update database
    await supabase
      .from('applications')
      .update({
        status: 'rejected',
        rejection_reason: reason,
        reviewed_by: interaction.user.tag,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', appId);

    // Update original message
    if (interaction.message?.embeds.length) {
      const embed = interaction.message.embeds[0].toJSON();
      embed.color = 0xed4245;
      embed.fields.push(
        { name: '❌ Rejected By', value: interaction.user.tag, inline: true },
        { name: '📝 Reason', value: reason, inline: false }
      );
      await interaction.message.edit({ embeds: [embed], components: [] });
    }

    // ===== CRITICAL: ACTUALLY SEND DM =====
    let dmSent = false;
    try {
      dmSent = await helpers.sendRejectionDM(discordId, app.discord_username, reason);
      logger.success(`✅ Rejection DM sent: ${dmSent}`);
    } catch (dmError) {
      logger.error("❌ DM error:", dmError);
    }

    await modalSubmit.editReply(
      `✅ Application rejected.\nReason: ${reason}\n${dmSent ? '✅ DM sent' : '⚠️ DM failed (user may have DMs disabled)'}`
    );

  } catch (error) {
    if (error.code === 'InteractionCollectorError') {
      await interaction.followUp({ content: '⏰ Timed out. Try again.', ephemeral: true });
    } else {
      logger.error("❌ Reject modal error:", error);
    }
  }
}

// ==================== CONVERSATION HANDLER ====================
async function handleConvo(interaction, appId) {
  try {
    const { data: app, error } = await supabase
      .from('applications')
      .select('conversation_log, answers')
      .eq('id', appId)
      .single();

    if (error || !app) {
      return interaction.editReply('❌ Application not found.');
    }

    const log = app.conversation_log || app.answers || 'No conversation log available.';

    if (log.length > 1900) {
      const buffer = Buffer.from(log, 'utf-8');
      await interaction.editReply({
        content: `📋 Conversation Log for #${appId}`,
        files: [{ attachment: buffer, name: `conversation_${appId}.txt` }]
      });
    } else {
      await interaction.editReply({
        content: `📋 **Conversation Log**\n\`\`\`\n${log}\n\`\`\``
      });
    }
  } catch (error) {
    logger.error("❌ Convo error:", error);
    await interaction.editReply(`❌ Error: ${error.message}`);
  }
}

// ==================== LOGIN ====================
async function login() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.error("❌ DISCORD_BOT_TOKEN not set");
    return false;
  }

  try {
    await client.login(process.env.DISCORD_BOT_TOKEN);
    return true;
  } catch (error) {
    logger.error("❌ Login failed:", error.message);
    return false;
  }
}

async function startWithRetry() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.warn("⚠️ DISCORD_BOT_TOKEN missing - bot disabled");
    return;
  }

  loginAttempts++;
  logger.info(`🤖 Starting bot (attempt ${loginAttempts})...`);

  try {
    await login();
  } catch (error) {
    logger.error(`❌ Attempt ${loginAttempts} failed:`, error.message);
    if (loginAttempts < 3) {
      logger.info("⏳ Retrying in 10s...");
      setTimeout(startWithRetry, 10000);
    }
  }
}

// Initialize
function initialize() {
  startWithRetry();
}

// Helper function to get bot (fixes "getBot is not a function" error)
function getBot() {
  return client;
}

module.exports = {
  client,
  getClient: () => client,
  getBot, // Add this alias
  botReady: () => botReady,
  ensureReady: async () => {
    if (botReady && client.isReady()) return true;
    logger.info("🔄 Bot not ready, waiting...");
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      if (botReady && client.isReady()) return true;
    }
    return false;
  },
  initialize
};
