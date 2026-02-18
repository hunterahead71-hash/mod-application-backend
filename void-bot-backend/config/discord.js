const { Client, GatewayIntentBits, ActivityType, Partials } = require("discord.js");
const { logger } = require("../utils/logger");
const { supabase } = require("./supabase");
const { assignModRole, sendRejectionDM } = require("../utils/discordHelpers");

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

    bot.guilds.cache.forEach(guild => {
      logger.info(`   - ${guild.name} (${guild.id})`);
    });

    bot.user.setPresence({
      activities: [{ name: 'Mod Applications', type: ActivityType.Watching }],
      status: 'online'
    });

    if (process.env.DISCORD_GUILD_ID) {
      try {
        const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const botMember = await guild.members.fetch(bot.user.id);
        logger.info("🔍 Bot Permissions Check:");
        logger.info(`   - Manage Roles: ${botMember.permissions.has('ManageRoles') ? '✅' : '❌'}`);
        logger.info(`   - Send Messages: ${botMember.permissions.has('SendMessages') ? '✅' : '❌'}`);
        logger.info(`   - Read Messages: ${botMember.permissions.has('ViewChannel') ? '✅' : '❌'}`);

        if (process.env.MOD_ROLE_ID) {
          const roleIds = process.env.MOD_ROLE_ID.split(',').map(id => id.trim());
          roleIds.forEach(roleId => {
            const role = guild.roles.cache.get(roleId);
            logger.info(`   - Mod Role ${roleId}: ${role ? `✅ ${role.name}` : '❌ Not Found'}`);
            if (role) {
              logger.info(`      - Role Position: ${role.position}`);
              logger.info(`      - Bot's Highest Role Position: ${botMember.roles.highest.position}`);
              if (role.position >= botMember.roles.highest.position) {
                logger.warn(`⚠️  Role ${role.name} is higher than bot's highest role!`);
              }
            }
          });
        }
      } catch (error) {
        logger.error("❌ Error checking bot permissions:", error.message);
      }
    }
  });

  bot.on('error', (error) => logger.error('❌ Discord bot error:', error.message));
  bot.on('warn', (warning) => logger.warn('⚠️ Discord bot warning:', warning));

  bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    logger.info(`🔘 Button pressed: ${interaction.customId} by ${interaction.user.tag}`);

    try {
      const [action, appId, discordId] = interaction.customId.split('_');
      if (action === 'accept') await handleAcceptButton(interaction, appId, discordId);
      else if (action === 'reject') await handleRejectButton(interaction, appId, discordId);
      else if (action === 'convo') await handleConversationButton(interaction, appId, discordId);
    } catch (error) {
      logger.error("❌ Button error:", error.message);
      await interaction.reply({ content: 'Error processing action.', ephemeral: true }).catch(() => {});
    }
  });
}

async function handleAcceptButton(interaction, appId, discordId) {
  await interaction.deferReply({ ephemeral: true });
  try {
    logger.info(`✅ Accepting application ${appId}`);
    const { data: application, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", appId)
      .single();

    if (error || !application) {
      return await interaction.editReply({ content: `❌ Application not found.` });
    }
    if (application.status !== 'pending') {
      return await interaction.editReply({ content: `❌ Already ${application.status}.` });
    }

    // Update database
    await supabase
      .from("applications")
      .update({
        status: "accepted",
        updated_at: new Date().toISOString(),
        reviewed_by: interaction.user.tag,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", appId);

    // Update message embed
    if (interaction.message?.embeds.length) {
      const embed = interaction.message.embeds[0];
      const updatedEmbed = {
        ...embed.toJSON(),
        color: 0x10b981,
        fields: [...embed.fields, { name: "✅ Accepted By", value: interaction.user.tag, inline: true }]
      };
      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
    }

    // ACTUALLY ASSIGN ROLES
    let roleResult = null;
    try {
      roleResult = await assignModRole(discordId, application.discord_username);
      logger.success(`Role assignment result: ${JSON.stringify(roleResult)}`);
    } catch (roleError) {
      logger.error("Role assignment error:", roleError.message);
    }

    let reply = `✅ Application accepted!`;
    if (roleResult?.success) {
      reply += `\n✅ Assigned: ${roleResult.assigned.map(r => r.name).join(', ')}`;
    } else if (roleResult) {
      reply += `\n⚠️ Role issues: ${roleResult.error || 'Check logs'}`;
    }
    await interaction.editReply({ content: reply });

  } catch (error) {
    logger.error("Accept error:", error.message);
    await interaction.editReply({ content: `❌ Error: ${error.message}` }).catch(() => {});
  }
}

async function handleRejectButton(interaction, appId, discordId) {
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  const modal = new ModalBuilder()
    .setCustomId(`reject_reason_${appId}_${discordId}`)
    .setTitle('Reject Application');
  const reasonInput = new TextInputBuilder()
    .setCustomId('rejectReason')
    .setLabel('Rejection Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter the reason...')
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
  await interaction.showModal(modal);

  try {
    const modalInteraction = await interaction.awaitModalSubmit({
      filter: i => i.customId === `reject_reason_${appId}_${discordId}`,
      time: 60000
    });
    await modalInteraction.deferReply({ ephemeral: true });
    const reason = modalInteraction.fields.getTextInputValue('rejectReason');
    logger.info(`❌ Rejecting ${appId}: ${reason}`);

    const { data: application, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", appId)
      .single();

    if (error || !application) {
      return await modalInteraction.editReply({ content: `❌ Application not found.` });
    }
    if (application.status !== 'pending') {
      return await modalInteraction.editReply({ content: `❌ Already ${application.status}.` });
    }

    await supabase
      .from("applications")
      .update({
        status: "rejected",
        updated_at: new Date().toISOString(),
        reviewed_by: interaction.user.tag,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason
      })
      .eq("id", appId);

    // ACTUALLY SEND REJECTION DM
    let dmResult = false;
    try {
      dmResult = await sendRejectionDM(discordId, application.discord_username, reason);
      logger.success(`Rejection DM sent: ${dmResult}`);
    } catch (dmError) {
      logger.error("DM error:", dmError.message);
    }

    if (interaction.message?.embeds.length) {
      const embed = interaction.message.embeds[0];
      const updatedEmbed = {
        ...embed.toJSON(),
        color: 0xed4245,
        fields: [
          ...embed.fields,
          { name: "❌ Rejected By", value: interaction.user.tag, inline: true },
          { name: "📝 Reason", value: reason, inline: false }
        ]
      };
      await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
    }

    await modalInteraction.editReply({
      content: `✅ Rejected: "${reason}"\n${dmResult ? '✅ DM sent' : '⚠️ DM failed (user may have DMs off)'}`
    });

  } catch (error) {
    logger.error("Reject modal error:", error.message);
    if (error.message.includes('time')) {
      await interaction.followUp({ content: '❌ Timed out. Try again.', ephemeral: true }).catch(() => {});
    }
  }
}

async function handleConversationButton(interaction, appId, discordId) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const { data: application, error } = await supabase
      .from("applications")
      .select("conversation_log, answers")
      .eq("id", appId)
      .single();

    if (error || !application) {
      return await interaction.editReply({ content: `❌ Application not found.` });
    }

    const conversation = application.conversation_log || application.answers || "No log available.";
    if (conversation.length > 1900) {
      const buffer = Buffer.from(conversation, 'utf-8');
      await interaction.editReply({
        content: `📋 Conversation Log for #${appId}`,
        files: [{ attachment: buffer, name: `conversation_${appId}.txt` }]
      });
    } else {
      await interaction.editReply({ content: `📋 **Conversation Log**\n\`\`\`\n${conversation}\n\`\`\`` });
    }
  } catch (error) {
    logger.error("Convo button error:", error.message);
    await interaction.editReply({ content: `❌ Error: ${error.message}` }).catch(() => {});
  }
}

async function loginBot() {
  logger.info("🔐 Attempting bot login...");
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.error("❌ DISCORD_BOT_TOKEN not set!");
    return false;
  }
  try {
    await botInstance.login(process.env.DISCORD_BOT_TOKEN);
    botReady = true;
    logger.success("✅ Bot login successful!");
    return true;
  } catch (error) {
    logger.error("❌ Bot login failed:", error.message);
    if (error.message.includes("disallowed intents")) {
      logger.info("💡 Enable SERVER MEMBERS INTENT and MESSAGE CONTENT INTENT in Discord Developer Portal.");
    }
    return false;
  }
}

async function ensureBotReady() {
  if (!botInstance) return false;
  if (botReady && botInstance.isReady()) return true;
  logger.info("🔄 Bot not ready, reconnecting...");
  if (!botInstance.isReady() && process.env.DISCORD_BOT_TOKEN) {
    return await loginBot();
  }
  return false;
}

async function startBotWithRetry() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.warn("⚠️ DISCORD_BOT_TOKEN not set - bot disabled");
    return;
  }
  logger.info("🤖 Starting Discord bot...");
  botLoginAttempts++;
  try {
    await loginBot();
  } catch (error) {
    logger.error(`❌ Bot startup failed (attempt ${botLoginAttempts}):`, error.message);
    if (botLoginAttempts < 3) {
      logger.info("⏳ Retrying in 10 seconds...");
      setTimeout(startBotWithRetry, 10000);
    }
  }
}

function initializeBot() {
  botInstance = createBot();
  setupBotEvents(botInstance);
  startBotWithRetry();
}

module.exports = {
  bot: botInstance,
  getBot: () => botInstance,
  botReady,
  ensureBotReady,
  initializeBot
};
