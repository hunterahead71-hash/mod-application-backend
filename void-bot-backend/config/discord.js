const { Client, GatewayIntentBits, ActivityType, Partials, EmbedBuilder, MessageFlags } = require("discord.js");
const { logger } = require("../utils/logger");
const { supabase } = require("./supabase");
const { setClient: setChannelLoggerClient } = require("../utils/channelLogger");
const { setDiscordRefs } = require("../utils/clientHolder");

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

// ==================== DISCORD.JS READY EVENT ====================
client.once('ready', async () => {
  botReady = true;
  loginAttempts = 0;
  setChannelLoggerClient(client);
  setDiscordRefs(client, ensureReady);
  
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

  // Register slash commands with retry logic
  let retries = 0;
  const maxRetries = 3;
  
  const registerWithRetry = async () => {
    try {
      await registerSlashCommands();
    } catch (error) {
      retries++;
      logger.error(`❌ Failed to register commands (attempt ${retries}/${maxRetries}):`, error);
      if (retries < maxRetries) {
        logger.info(`⏳ Retrying in 5 seconds...`);
        setTimeout(registerWithRetry, 5000);
      } else {
        logger.error("❌ Max retries reached. Commands may not be registered.");
      }
    }
  };
  
  await registerWithRetry();

  // Check guild and roles (use Void Esports guild as fallback: 1351362266246680626)
  const guildIdToCheck = process.env.DISCORD_GUILD_ID || '1351362266246680626';
  if (guildIdToCheck) {
    try {
      const guild = await client.guilds.fetch(guildIdToCheck).catch(() => null) || client.guilds.cache.find(g => g.name?.toLowerCase().includes('void')) || client.guilds.cache.first();
      if (!guild) throw new Error('Unknown Guild');
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

// ==================== SLASH COMMAND HANDLERS ====================
const slashCommands = require('../commands/slashCommands');

// Register slash commands using REST API
async function registerSlashCommands() {
  try {
    const { REST, Routes } = require('discord.js');
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

    const commands = [
      slashCommands.testQuestionCommand.data.toJSON(),
      slashCommands.certRoleCommand.data.toJSON(),
      slashCommands.analyticsCommand.data.toJSON(),
      slashCommands.bulkCommand.data.toJSON(),
      slashCommands.simulateCommand.data.toJSON(),
      slashCommands.questionStatsCommand.data.toJSON(),
      slashCommands.quickActionsCommand.data.toJSON(),
      slashCommands.botStatusCommand.data.toJSON(),
      slashCommands.helpCommand.data.toJSON(),
      slashCommands.dmTemplateCommand.data.toJSON(),
      slashCommands.addAdminRoleCommand.data.toJSON(),
      slashCommands.deleteAdminRoleCommand.data.toJSON(),
      slashCommands.showAdminRoleCommand.data.toJSON()
    ];

    logger.info(`🚀 Registering ${commands.length} application (/) commands...`);

    let data;
    if (process.env.DISCORD_CLIENT_ID) {
      // Use same target as deploy-commands.js to avoid duplicates: guild if set, else global
      if (process.env.DISCORD_GUILD_ID) {
        data = await rest.put(
          Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
          { body: commands }
        );
        logger.success(`✅ Successfully registered ${data.length} guild commands`);
        // Clear global commands so only guild commands show (prevents duplicate list)
        await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] });
        logger.info(`🧹 Cleared global commands to prevent duplicates`);
      } else {
        data = await rest.put(
          Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
          { body: commands }
        );
        logger.success(`✅ Successfully registered ${data.length} global commands`);
      }
    } else {
      logger.warn("⚠️ DISCORD_CLIENT_ID not set - cannot register commands");
    }
  } catch (error) {
    logger.error("❌ Error registering slash commands:", error);
    logger.error("Error details:", error.message);
    if (error.stack) logger.error("Stack:", error.stack);
    
    // Avoid referencing commands if they failed to build
    if (Array.isArray(slashCommands) && slashCommands.length) {
      logger.info("Commands being registered (build-time):");
      try {
        const preview = [
          slashCommands.testQuestionCommand,
          slashCommands.certRoleCommand,
          slashCommands.analyticsCommand,
          slashCommands.bulkCommand,
          slashCommands.simulateCommand,
          slashCommands.questionStatsCommand,
          slashCommands.quickActionsCommand,
          slashCommands.botStatusCommand,
          slashCommands.helpCommand,
          slashCommands.dmTemplateCommand,
          slashCommands.addAdminRoleCommand,
          slashCommands.deleteAdminRoleCommand,
          slashCommands.showAdminRoleCommand
        ].filter(Boolean);
        preview.forEach((cmd, idx) => {
          logger.info(`  ${idx + 1}. ${cmd.data.name} - ${cmd.data.description}`);
        });
      } catch {
        // If anything goes wrong here, just skip detailed logging
      }
    }
  }
}

// ==================== INTERACTION HANDLERS ====================
client.on('interactionCreate', async (interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    // CRITICAL: Defer FIRST (3 sec limit) - no awaits before this
    try {
      await interaction.deferReply({ flags: [] });
    } catch (deferError) {
      logger.error("Failed to defer reply:", deferError);
      try {
        await interaction.reply({ content: '❌ Error: Could not process command.', flags: [] });
      } catch {}
      return;
    }
    logger.info(`🔧 Slash command: ${interaction.commandName} by ${interaction.user.tag}`);

    try {
      const commandName = interaction.commandName;

      // Route commands to their handlers
      const commandMap = {
        'test-question': slashCommands.testQuestionCommand,
        'cert-role': slashCommands.certRoleCommand,
        'cert-analytics': slashCommands.analyticsCommand,
        'cert-bulk': slashCommands.bulkCommand,
        'cert-simulate': slashCommands.simulateCommand,
        'cert-question-stats': slashCommands.questionStatsCommand,
        'cert-quick': slashCommands.quickActionsCommand,
        'cert-status': slashCommands.botStatusCommand,
        'cert-help': slashCommands.helpCommand,
        'cert-dm': slashCommands.dmTemplateCommand,
        'add-admin-role': slashCommands.addAdminRoleCommand,
        'delete-admin-role': slashCommands.deleteAdminRoleCommand,
        'show-admin-role': slashCommands.showAdminRoleCommand
      };

      const commandHandler = commandMap[commandName];
      
      if (!commandHandler) {
        logger.warn(`⚠️ Unknown command: ${commandName} - This might be an old command that needs to be deleted`);
        logger.info(`Available commands: ${Object.keys(commandMap).join(', ')}`);
        return interaction.editReply({ 
          content: `❌ Unknown command: \`/${commandName}\`\n\nThis command doesn't exist. Use \`/cert-help\` to see all available commands.\n\n**Note:** Old commands like \`/addquestion\`, \`/deletequestion\` etc. have been replaced. Please use the new commands shown in \`/cert-help\`.` 
        });
      }
      
      if (!commandHandler.execute) {
        logger.error(`❌ Command ${commandName} has no execute function`);
        return interaction.editReply({ 
          content: `❌ Error: Command handler not found for \`/${commandName}\`` 
        });
      }
      
      logger.info(`📋 Executing command: ${commandName}`);
      await commandHandler.execute(interaction);
    } catch (error) {
      logger.error("❌ Slash command error:", error);
      logger.error("Stack:", error.stack);
      try {
        await interaction.editReply({ 
          content: `❌ Error processing command: ${error.message}\n\nCheck server logs for details.`, 
          flags: []
        }).catch(() => {
          interaction.followUp({ content: `❌ Error: ${error.message}`, flags: [] }).catch(() => {});
        });
      } catch (replyError) {
        logger.error("Failed to send error reply:", replyError);
      }
    }
    return;
  }

  // Handle button interactions
  if (!interaction.isButton()) return;
  
  logger.info(`🔘 Button clicked: ${interaction.customId} by ${interaction.user.tag}`);

  try {
    // Lazy load helpers to avoid circular dependency
    if (!discordHelpers) {
      discordHelpers = require("../utils/discordHelpers");
    }

    const [action, appId, discordId] = interaction.customId.split('_');

    if (action === 'accept') {
      // Defer immediately for accept
      await interaction.deferUpdate().catch(err => {
        logger.error(`Failed to defer interaction: ${err.message}`);
      });
      await handleAccept(interaction, appId, discordId, discordHelpers);
    } else if (action === 'reject') {
      // Don't defer for reject - we need to show modal first
      await handleReject(interaction, appId, discordId, discordHelpers);
    } else if (action === 'convo') {
      await interaction.deferUpdate().catch(err => {
        logger.error(`Failed to defer interaction: ${err.message}`);
      });
      await handleConvo(interaction, appId);
    }
  } catch (error) {
    logger.error("❌ Button handler error:", error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: '❌ Error processing button. Check logs.', 
          ephemeral: true 
        }).catch(() => {});
      } else {
        await interaction.followUp({ 
          content: '❌ Error processing button. Check logs.', 
          ephemeral: true 
        }).catch(() => {});
      }
    } catch {}
  }
});

// ==================== ACCEPT HANDLER ====================
async function handleAccept(interaction, appId, discordId, helpers) {
  try {
    // Atomic update: only one caller (Discord or web) wins - prevents double DM/role assign
    const { data: app, error } = await supabase
      .from('applications')
      .update({
        status: 'accepted',
        reviewed_by: interaction.user.tag,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', appId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error || !app) {
      return interaction.editReply('❌ Application not found or already accepted.');
    }

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
      // Use Void Esports guild ID directly (1351362266246680626) - ignore env if wrong
      const voidGuildId = '1351362266246680626';
      let guild = client.guilds.cache.get(voidGuildId);
      if (!guild) {
        // Try to fetch Void guild first
        guild = await client.guilds.fetch(voidGuildId).catch(() => null);
      }
      if (!guild) {
        // Fallback: find any guild with "void" in name
        guild = client.guilds.cache.find(g => g.name?.toLowerCase().includes('void'));
      }
      if (!guild) {
        // Last resort: use first available guild
        guild = client.guilds.cache.first();
      }
      
      if (guild) {
        await guild.members.fetch({ force: true });
        logger.info(`Using guild: ${guild.name} (${guild.id}) for role assignment`);
      }
      
      roleResult = await helpers.assignModRole(discordId, app.discord_username);
      logger.success(`✅ Role assignment result:`, roleResult);
    } catch (roleError) {
      logger.error("❌ Role assignment error:", roleError);
    }

    // Log to channel
    try {
      const { logToChannel } = require("../utils/channelLogger");
      await logToChannel(
        '✅ Application Accepted',
        `Application #${appId} was accepted by ${interaction.user.tag}`,
        0x10b981,
        [
          { name: '👤 User', value: app.discord_username, inline: true },
          { name: '📊 Score', value: app.score || 'N/A', inline: true },
          { name: '🎭 Roles Assigned', value: roleResult?.assigned?.length ? roleResult.assigned.map(r => r.name).join(', ') : 'None', inline: false }
        ]
      );
    } catch (e) { logger.warn("Log to channel failed:", e.message); }

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
    
    // Show modal FIRST before deferring
    await interaction.showModal(modal);

    const modalSubmit = await interaction.awaitModalSubmit({
      filter: i => i.customId === `reject_modal_${appId}` && i.user.id === interaction.user.id,
      time: 60000
    });

    // Defer the modal submission
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

    // Log to channel
    try {
      const { logToChannel } = require("../utils/channelLogger");
      await logToChannel(
        '❌ Application Rejected',
      `Application #${appId} was rejected by ${interaction.user.tag}`,
      0xed4245,
      [
        { name: '👤 User', value: app.discord_username, inline: true },
        { name: '📊 Score', value: app.score || 'N/A', inline: true },
        { name: '📝 Reason', value: reason.substring(0, 1000), inline: false },
        { name: '📨 DM Sent', value: dmSent ? 'Yes' : 'No (DMs may be disabled)', inline: true }
      ]
      );
    } catch (e) { logger.warn("Log to channel failed:", e.message); }

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

// ==================== FIXED CONVERSATION HANDLER - SENDS ONLY FORMATTED LOG ====================
async function handleConvo(interaction, appId) {
  try {
    logger.info(`📋 Conversation log requested for app ${appId} by ${interaction.user.tag}`);

    // Get application with conversation log
    const { data: app, error } = await supabase
      .from('applications')
      .select('discord_username, discord_id, score, correct_answers, total_questions, created_at, conversation_log, answers, test_results')
      .eq('id', appId)
      .single();

    if (error || !app) {
      return interaction.editReply('❌ Application not found.');
    }

    // Build a concise Q&A style log: only questions and user replies
    let qaPairs = [];
    if (app.test_results) {
      try {
        const parsed = typeof app.test_results === 'string'
          ? JSON.parse(app.test_results)
          : app.test_results;
        if (parsed && Array.isArray(parsed.questions)) {
          qaPairs = parsed.questions.map((q, index) => ({
            index: index + 1,
            question: q.question || q.prompt || 'Unknown question',
            answer: q.answer || 'No answer provided'
          }));
        }
      } catch (e) {
        logger.error('Error parsing test_results for convo log:', e);
      }
    }

    // Fallback: try to use conversation_log if Q&A not available
    if (qaPairs.length === 0 && app.conversation_log) {
      qaPairs.push({
        index: 1,
        question: 'Conversation',
        answer: app.conversation_log.substring(0, 900)
      });
    }

    if (qaPairs.length === 0) {
      return interaction.editReply({
        content: '📋 No detailed conversation log is available for this application.',
        ephemeral: true
      });
    }

    let content = '';
    qaPairs.forEach(pair => {
      content += `Q${pair.index}: ${pair.question}\n`;
      content += `A${pair.index}: ${pair.answer}\n\n`;
    });

    if (content.length > 1900) {
      content = content.substring(0, 1900) + '\n[...truncated]';
    }

    await interaction.editReply({
      content: '```txt\n' + content.trim() + '\n```',
      ephemeral: true
    });

    logger.success(`✅ Conversation log sent for app ${appId}`);

  } catch (error) {
    logger.error("❌ Convo error:", error);
    await interaction.editReply(`❌ Error loading conversation log: ${error.message}`);
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

// Helper function to get bot
function getBot() {
  return client;
}

async function ensureReady() {
  if (botReady && client.isReady()) return true;
  logger.info("🔄 Bot not ready, waiting...");
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (botReady && client.isReady()) {
      logger.success("✅ Bot is now ready!");
      return true;
    }
  }
  logger.warn("⚠️ Bot ready check timed out after 30 seconds");
  return false;
}

module.exports = {
  client,
  getClient: () => client,
  getBot,
  botReady: () => botReady,
  ensureReady,
  initialize
};
