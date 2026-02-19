const { Client, GatewayIntentBits, ActivityType, Partials, EmbedBuilder } = require("discord.js");
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

// ==================== DISCORD.JS READY EVENT ====================
client.once('ready', async () => {
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
      slashCommands.helpCommand.data.toJSON()
    ];

    logger.info(`🚀 Registering ${commands.length} application (/) commands...`);

    let data;
    if (process.env.DISCORD_GUILD_ID && process.env.DISCORD_CLIENT_ID) {
      // Register to specific guild (faster, instant)
      data = await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      logger.success(`✅ Successfully registered ${data.length} guild commands to ${process.env.DISCORD_GUILD_ID}`);
    } else if (process.env.DISCORD_CLIENT_ID) {
      // Register globally (takes up to 1 hour to propagate)
      data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      logger.success(`✅ Successfully registered ${data.length} global commands`);
    } else {
      logger.warn("⚠️ DISCORD_CLIENT_ID not set - cannot register commands");
    }
  } catch (error) {
    logger.error("❌ Error registering slash commands:", error);
    logger.error("Error details:", error.message);
    if (error.stack) logger.error("Stack:", error.stack);
    
    // Log each command being registered for debugging
    logger.info("Commands being registered:");
    commands.forEach((cmd, idx) => {
      logger.info(`  ${idx + 1}. ${cmd.name} - ${cmd.description}`);
    });
  }
}

// ==================== INTERACTION HANDLERS ====================
client.on('interactionCreate', async (interaction) => {
  // Handle slash commands
  if (interaction.isChatInputCommand()) {
    logger.info(`🔧 Slash command: ${interaction.commandName} by ${interaction.user.tag}`);

    // CRITICAL: Defer reply immediately to prevent timeout
    try {
      await interaction.deferReply({ ephemeral: true });
    } catch (deferError) {
      logger.error("Failed to defer reply:", deferError);
      try {
        await interaction.reply({ 
          content: '❌ Error: Could not process command.', 
          ephemeral: true 
        });
      } catch {}
      return;
    }

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
        'cert-help': slashCommands.helpCommand
      };

      const commandHandler = commandMap[commandName];
      if (commandHandler) {
        await commandHandler.execute(interaction);
      } else {
        // Unknown command - show help
        await slashCommands.helpCommand.execute(interaction);
      }
    } catch (error) {
      logger.error("❌ Slash command error:", error);
      logger.error("Stack:", error.stack);
      try {
        await interaction.editReply({ 
          content: `❌ Error processing command: ${error.message}\n\nCheck server logs for details.`, 
          ephemeral: true 
        }).catch(() => {
          // If edit fails, try followUp
          interaction.followUp({ 
            content: `❌ Error: ${error.message}`, 
            ephemeral: true 
          }).catch(() => {});
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
    // IMMEDIATELY defer the interaction to prevent timeout
    await interaction.deferUpdate().catch(err => {
      logger.error(`Failed to defer interaction: ${err.message}`);
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

    // Get the raw log or create one from answers
    let rawLog = app.conversation_log || app.answers || '';
    
    // If no log exists, try to parse from test_results
    if (!rawLog && app.test_results) {
      try {
        const testResults = typeof app.test_results === 'string' 
          ? JSON.parse(app.test_results) 
          : app.test_results;
        
        if (testResults && testResults.questions) {
          rawLog = formatQuestionsIntoLog(testResults.questions);
        }
      } catch (e) {
        logger.error('Error parsing test_results:', e);
      }
    }

    // If still no log, create a minimal one
    if (!rawLog || rawLog.length < 10) {
      const score = app.score || `${app.correct_answers || 0}/${app.total_questions || 8}`;
      rawLog = createMinimalLog(app.discord_username, app.discord_id, score);
    }

    // Clean up the log - remove any weird characters but preserve formatting
    const cleanLog = rawLog
      .replace(/\r\n/g, '\n')
      .replace(/[^\x20-\x7E\u2500-\u257F\n]/g, '') // Allow box drawing characters
      .trim();

    // Create the formatted transcript exactly as requested
    const transcript = formatTranscript(cleanLog, app);

    // Split into chunks if needed (Discord limit is 2000 chars)
    if (transcript.length <= 1900) {
      // Send as a single message
      await interaction.editReply({
        content: `\`\`\`\n${transcript}\n\`\`\``,
        ephemeral: true
      });
    } else {
      // Send as file attachment
      const buffer = Buffer.from(transcript, 'utf-8');
      await interaction.editReply({
        content: `📋 **Complete Test Transcript**`,
        files: [{
          attachment: buffer,
          name: `transcript_${app.discord_username}_${appId}.txt`
        }],
        ephemeral: true
      });
    }

    logger.success(`✅ Conversation log sent for app ${appId}`);

  } catch (error) {
    logger.error("❌ Convo error:", error);
    await interaction.editReply(`❌ Error loading conversation log: ${error.message}`);
  }
}

// Helper function to format questions into log
function formatQuestionsIntoLog(questions) {
  if (!Array.isArray(questions)) return '';
  
  let log = '';
  questions.forEach((q, index) => {
    log += `┌──────────────────────────────────────────────────────────────────────────┐\n`;
    log += `│ QUESTION ${index + 1} of ${questions.length}${q.correct ? ' ✓ PASS' : ' ✗ FAIL'}\n`;
    log += `├──────────────────────────────────────────────────────────────────────────┤\n`;
    log += `│ USER: ${q.question || 'Unknown'}\n`;
    log += `├──────────────────────────────────────────────────────────────────────────┤\n`;
    log += `│ MOD RESPONSE:\n`;
    log += `│ ${q.answer || 'No answer provided'}\n`;
    log += `├──────────────────────────────────────────────────────────────────────────┤\n`;
    log += `│ EVALUATION:\n`;
    log += `│ Matches: ${q.matchCount || 0}/${q.requiredMatches || 2}\n`;
    log += `│ Keywords: ${q.matchedKeywords ? q.matchedKeywords.join(', ') : 'None'}\n`;
    log += `├──────────────────────────────────────────────────────────────────────────┤\n`;
    log += `│ CORRECT RESPONSE:\n`;
    log += `│ ${q.feedback || 'Follow protocol'}\n`;
    log += `└──────────────────────────────────────────────────────────────────────────┘\n\n`;
  });
  return log;
}

// Helper function to create minimal log
function createMinimalLog(username, userId, score) {
  const date = new Date().toLocaleString();
  const separator = '══════════════════════════════════════════════════════════════════════════════';
  
  let log = `${separator}\n`;
  log += `VOID ESPORTS MODERATOR CERTIFICATION TEST - COMPLETE TRANSCRIPT\n`;
  log += `${separator}\n`;
  log += `User: ${username} (${userId})\n`;
  log += `Date: ${date}\n`;
  log += `Final Score: ${score}\n`;
  log += `${separator}\n\n`;
  log += `No detailed question log available.\n`;
  log += `${separator}\n`;
  
  return log;
}

// Helper function to format the final transcript
function formatTranscript(log, app) {
  const separator = '══════════════════════════════════════════════════════════════════════════════';
  const score = app.score || `${app.correct_answers || 0}/${app.total_questions || 8}`;
  const passed = app.correct_answers >= 6 ? 'PASSED ✓' : 'FAILED ✗';
  const date = app.created_at ? new Date(app.created_at).toLocaleString() : new Date().toLocaleString();
  
  // Extract just the Q&A part if it exists, otherwise use the whole log
  let qaSection = log;
  
  // If the log already has the header, remove it to avoid duplication
  if (log.includes(separator)) {
    const parts = log.split(separator);
    if (parts.length >= 3) {
      // Take everything after the second separator
      qaSection = parts.slice(2).join(separator).trim();
    }
  }
  
  // Build the complete transcript exactly as requested
  let transcript = `${separator}\n`;
  transcript += `VOID ESPORTS MODERATOR CERTIFICATION TEST - COMPLETE TRANSCRIPT\n`;
  transcript += `${separator}\n`;
  transcript += `User: ${app.discord_username} (${app.discord_id})\n`;
  transcript += `Date: ${date}\n`;
  transcript += `Final Score: ${score}\n`;
  transcript += `Result: ${passed}\n`;
  transcript += `${separator}\n\n`;
  
  // Add the Q&A section
  transcript += qaSection;
  
  // Ensure it ends with the separator
  if (!transcript.endsWith(separator)) {
    transcript += `\n${separator}\n`;
    transcript += `END OF TRANSCRIPT - ${score} CORRECT\n`;
    transcript += `${separator}`;
  }
  
  return transcript;
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

module.exports = {
  client,
  getClient: () => client,
  getBot,
  botReady: () => botReady,
  ensureReady: async () => {
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
  },
  initialize
};
