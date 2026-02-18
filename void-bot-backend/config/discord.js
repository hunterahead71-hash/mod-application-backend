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
      activities: [{ 
        name: 'Mod Applications', 
        type: ActivityType.Watching
      }],
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
          const modRole = guild.roles.cache.get(process.env.MOD_ROLE_ID);
          logger.info(`   - Mod Role Found: ${modRole ? `✅ ${modRole.name}` : '❌ Not Found'}`);
          
          if (modRole) {
            logger.info(`   - Role Position: ${modRole.position}`);
            logger.info(`   - Bot's Highest Role Position: ${botMember.roles.highest.position}`);
            
            if (modRole.position >= botMember.roles.highest.position) {
              logger.warn(`⚠️  WARNING: Mod role is higher than bot's highest role! Bot cannot assign this role.`);
            }
          }
        }
      } catch (error) {
        logger.error("❌ Error checking bot permissions:", error.message);
      }
    }
  });

  bot.on('error', (error) => {
    logger.error('❌ Discord bot error:', error.message);
  });

  bot.on('warn', (warning) => {
    logger.warn('⚠️ Discord bot warning:', warning);
  });

  // Handle button interactions
  bot.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    logger.info(`🔘 Button pressed: ${interaction.customId} by ${interaction.user.tag}`);
    
    try {
      // Parse custom ID: action_applicationId_discordId
      const [action, appId, discordId] = interaction.customId.split('_');
      
      if (action === 'accept') {
        await handleAcceptButton(interaction, appId, discordId);
      } else if (action === 'reject') {
        await handleRejectButton(interaction, appId, discordId);
      } else if (action === 'convo') {
        await handleConversationButton(interaction, appId, discordId);
      }
      
    } catch (error) {
      logger.error("❌ Error handling button interaction:", error.message);
      await interaction.reply({ 
        content: 'There was an error processing this action.', 
        ephemeral: true 
      }).catch(() => {});
    }
  });
}

// Handle accept button
async function handleAcceptButton(interaction, appId, discordId) {
  // Defer reply to give us time to process
  await interaction.deferReply({ ephemeral: true });
  
  try {
    logger.info(`✅ Accept button pressed for application ${appId}`);
    
    // Get application from database
    const { data: application, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", appId)
      .single();
    
    if (error || !application) {
      return await interaction.editReply({ 
        content: `❌ Application not found in database.` 
      });
    }
    
    if (application.status !== 'pending') {
      return await interaction.editReply({ 
        content: `❌ This application has already been ${application.status}.` 
      });
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
    
    // Assign role
    let roleResult = null;
    try {
      roleResult = await assignModRole(discordId, application.discord_username);
    } catch (roleError) {
      logger.error("Role assignment error:", roleError.message);
    }
    
    // Update the original message
    if (interaction.message && interaction.message.embeds.length > 0) {
      const embed = interaction.message.embeds[0];
      const updatedEmbed = {
        ...embed.toJSON(),
        color: 0x10b981,
        fields: [
          ...embed.fields,
          {
            name: "✅ Accepted By",
            value: interaction.user.tag,
            inline: true
          }
        ]
      };
      
      await interaction.message.edit({ 
        embeds: [updatedEmbed], 
        components: [] // Remove buttons
      });
    }
    
    // Send success message
    let replyMessage = `✅ Application accepted!`;
    if (roleResult && roleResult.success) {
      replyMessage += `\nRoles assigned: ${roleResult.assigned.map(r => r.name).join(', ')}`;
    } else if (roleResult) {
      replyMessage += `\n⚠️ Role assignment had issues: ${roleResult.error || 'Check logs'}`;
    }
    
    await interaction.editReply({ content: replyMessage });
    
  } catch (error) {
    logger.error("Accept handler error:", error.message);
    await interaction.editReply({ 
      content: `❌ Error: ${error.message}` 
    }).catch(() => {});
  }
}

// Handle reject button
async function handleRejectButton(interaction, appId, discordId) {
  // Create modal for rejection reason
  const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
  
  const modal = new ModalBuilder()
    .setCustomId(`reject_reason_${appId}_${discordId}`)
    .setTitle('Reject Application');
  
  const reasonInput = new TextInputBuilder()
    .setCustomId('rejectReason')
    .setLabel('Rejection Reason')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter the reason for rejection...')
    .setValue('Insufficient test score')
    .setRequired(true);
  
  const actionRow = new ActionRowBuilder().addComponents(reasonInput);
  modal.addComponents(actionRow);
  
  await interaction.showModal(modal);
  
  // Handle modal submission
  const filter = (i) => i.customId === `reject_reason_${appId}_${discordId}`;
  try {
    const modalInteraction = await interaction.awaitModalSubmit({ filter, time: 60000 });
    
    await modalInteraction.deferReply({ ephemeral: true });
    
    const reason = modalInteraction.fields.getTextInputValue('rejectReason');
    
    logger.info(`❌ Reject button pressed for application ${appId} with reason: ${reason}`);
    
    // Get application from database
    const { data: application, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", appId)
      .single();
    
    if (error || !application) {
      return await modalInteraction.editReply({ 
        content: `❌ Application not found in database.` 
      });
    }
    
    if (application.status !== 'pending') {
      return await modalInteraction.editReply({ 
        content: `❌ This application has already been ${application.status}.` 
      });
    }
    
    // Update database
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
    
    // Send DM
    let dmResult = false;
    try {
      dmResult = await sendRejectionDM(discordId, application.discord_username, reason);
    } catch (dmError) {
      logger.error("DM error:", dmError.message);
    }
    
    // Update the original message
    if (interaction.message && interaction.message.embeds.length > 0) {
      const embed = interaction.message.embeds[0];
      const updatedEmbed = {
        ...embed.toJSON(),
        color: 0xed4245,
        fields: [
          ...embed.fields,
          {
            name: "❌ Rejected By",
            value: interaction.user.tag,
            inline: true
          },
          {
            name: "📝 Reason",
            value: reason,
            inline: false
          }
        ]
      };
      
      await interaction.message.edit({ 
        embeds: [updatedEmbed], 
        components: [] // Remove buttons
      });
    }
    
    await modalInteraction.editReply({ 
      content: `✅ Application rejected with reason: "${reason}"\n${dmResult ? 'DM sent to user.' : '⚠️ Could not send DM (user may have DMs disabled).'}` 
    });
    
  } catch (error) {
    logger.error("Reject modal error:", error.message);
    if (error.message.includes('time')) {
      await interaction.followUp({ 
        content: '❌ You took too long to respond. Please try again.', 
        ephemeral: true 
      }).catch(() => {});
    }
  }
}

// Handle conversation log button
async function handleConversationButton(interaction, appId, discordId) {
  await interaction.deferReply({ ephemeral: true });
  
  try {
    logger.info(`📋 Conversation button pressed for application ${appId}`);
    
    // Get application from database
    const { data: application, error } = await supabase
      .from("applications")
      .select("conversation_log, answers")
      .eq("id", appId)
      .single();
    
    if (error || !application) {
      return await interaction.editReply({ 
        content: `❌ Application not found in database.` 
      });
    }
    
    const conversationLog = application.conversation_log || application.answers || "No conversation log available.";
    
    // Send as file if too long, otherwise as message
    if (conversationLog.length > 1900) {
      const buffer = Buffer.from(conversationLog, 'utf-8');
      const attachment = { files: [{ attachment: buffer, name: `conversation_${appId}.txt` }] };
      
      await interaction.editReply({ 
        content: `📋 **Conversation Log for Application #${appId}**`,
        files: [{ attachment: buffer, name: `conversation_${appId}.txt` }]
      });
    } else {
      await interaction.editReply({ 
        content: `📋 **Conversation Log for Application #${appId}**\n\`\`\`\n${conversationLog}\n\`\`\``
      });
    }
    
  } catch (error) {
    logger.error("Conversation button error:", error.message);
    await interaction.editReply({ 
      content: `❌ Error: ${error.message}` 
    }).catch(() => {});
  }
}

async function loginBot() {
  logger.info("🔐 Attempting bot login...");
  
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.error("❌ CRITICAL: DISCORD_BOT_TOKEN not set!");
    return false;
  }
  
  const token = process.env.DISCORD_BOT_TOKEN;
  
  try {
    await botInstance.login(token);
    botReady = true;
    logger.success("✅ Bot login successful!");
    return true;
  } catch (error) {
    logger.error("❌ Bot login failed:", error.message);
    
    if (error.message.includes("disallowed intents")) {
      logger.info("💡 FIX: Go to Discord Developer Portal → Bot → Enable:");
      logger.info("   - SERVER MEMBERS INTENT (REQUIRED)");
      logger.info("   - MESSAGE CONTENT INTENT (REQUIRED)");
    }
    
    return false;
  }
}

async function ensureBotReady() {
  if (!botInstance) {
    logger.error("❌ Bot instance is null!");
    return false;
  }
  
  if (botReady && botInstance.isReady()) return true;
  
  logger.info("🔄 Bot not ready, attempting to reconnect...");
  
  if (!botInstance.isReady() && process.env.DISCORD_BOT_TOKEN) {
    const success = await loginBot();
    if (success) {
      botReady = true;
      return true;
    }
  }
  
  return false;
}

async function startBotWithRetry() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    logger.warn("⚠️ DISCORD_BOT_TOKEN not set - bot features disabled");
    return;
  }
  
  logger.info("🤖 Starting Discord bot...");
  botLoginAttempts++;
  
  try {
    await loginBot();
  } catch (error) {
    logger.error(`❌ Bot startup failed (attempt ${botLoginAttempts}):`, error.message);
    
    if (botLoginAttempts < 3) {
      logger.info(`⏳ Retrying in 10 seconds...`);
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
