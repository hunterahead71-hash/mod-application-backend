const express = require("express");
const session = require("express-session");
const MemoryStore = require('memorystore')(session);
const path = require('path');

// Config
const { supabase } = require("./config/supabase");
const { initialize: initBot, getClient, ensureReady } = require("./config/discord");

// Logger
const { logger } = require("./utils/logger");

// Discord helpers
const { assignModRole, sendRejectionDM } = require("./utils/discordHelpers");

// Routes
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const submissionRoutes = require("./routes/submissions");
const debugRoutes = require("./routes/debug");
const healthRoutes = require("./routes/health");

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CORS ====================
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// ==================== SESSION ====================
app.use(
  session({
    store: new MemoryStore({ checkPeriod: 86400000 }),
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "super-secret-key-change-me",
    resave: true,
    saveUninitialized: true,
    proxy: true,
    cookie: {
      secure: true,
      sameSite: 'none',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
    }
  })
);

// Request logger
app.use((req, res, next) => {
  logger.request(req.method, req.path);
  next();
});

// ==================== INIT BOT ====================
initBot();

// ==================== FUNCTION TO UPDATE DISCORD MESSAGE ====================
async function updateDiscordMessage(appId, status, adminName, reason = '') {
  try {
    const client = getClient();
    if (!client || !await ensureReady() || !process.env.DISCORD_CHANNEL_ID) {
      logger.warn("Cannot update Discord message: Bot not ready or channel not configured");
      return false;
    }

    // Get the channel
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) {
      logger.error(`Channel ${process.env.DISCORD_CHANNEL_ID} not found`);
      return false;
    }

    // Fetch recent messages (limit 100 to find the one with matching app ID)
    const messages = await channel.messages.fetch({ limit: 100 });
    
    for (const [msgId, msg] of messages) {
      // Check if this message has our app ID in footer or content
      if (msg.embeds && msg.embeds.length > 0) {
        const embed = msg.embeds[0];
        const footerText = embed.footer?.text || '';
        
        // Look for app ID in footer (format: "ID: 123")
        if (footerText.includes(appId.toString())) {
          logger.info(`Found Discord message ${msgId} for app ${appId}`);
          
          // Create updated embed
          const updatedEmbed = {
            ...embed.toJSON(),
            color: status === 'accepted' ? 0x10b981 : 0xed4245,
          };

          // Remove any existing review fields
          const fields = embed.fields?.filter(f => 
            !f.name.includes('Accepted') && 
            !f.name.includes('Rejected') &&
            !f.name.includes('Reason')
          ) || [];

          // Add new review field
          fields.push({
            name: status === 'accepted' ? "✅ Accepted By" : "❌ Rejected By",
            value: adminName,
            inline: true
          });

          // Add reason if rejection
          if (status === 'rejected' && reason) {
            fields.push({
              name: "📝 Reason",
              value: reason.substring(0, 100), // Limit length
              inline: false
            });
          }

          updatedEmbed.fields = fields;

          // Update the message (remove buttons)
          await msg.edit({ 
            embeds: [updatedEmbed], 
            components: [] // This removes all buttons
          });

          logger.success(`✅ Updated Discord message ${msgId} to ${status}`);
          
          // Also store the message ID in database for future reference
          try {
            await supabase
              .from("applications")
              .update({ discord_message_id: msgId })
              .eq("id", appId);
          } catch (dbError) {
            // Non-critical, ignore
          }

          return true;
        }
      }
    }

    logger.warn(`No Discord message found for app ${appId} in last 100 messages`);
    return false;
  } catch (error) {
    logger.error("❌ Error updating Discord message:", error.message);
    return false;
  }
}

// ==================== DISCORD BUTTON INTERACTION HANDLER ====================
function setupDiscordInteractions() {
  const trySetup = async () => {
    const client = getClient();
    if (!client) {
      setTimeout(trySetup, 1000);
      return;
    }
    if (!client.isReady()) {
      client.once('clientReady', () => registerInteractionHandler(client));
      client.once('ready', () => registerInteractionHandler(client));
      return;
    }
    registerInteractionHandler(client);
  };
  setTimeout(trySetup, 2000);
}

function registerInteractionHandler(client) {
  logger.success('🎮 Registering Discord button interaction handler');

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    const { customId, user } = interaction;
    logger.info(`🔘 Button: ${customId} clicked by ${user.tag}`);

    // ===== ✅ ACCEPT BUTTON =====
    if (customId.startsWith('accept_')) {
      try {
        await interaction.deferUpdate();

        const [, appId, discordId] = customId.split('_');

        // Fetch application
        const { data: app, error } = await supabase
          .from('applications')
          .select('*')
          .eq('id', appId)
          .single();

        if (error || !app) {
          logger.error(`❌ App not found: ${appId}`);
          await editReviewedEmbed(interaction, 'accepted', user.username, '⚠️ DB record not found', appId);
          return;
        }

        // Check if already processed
        if (app.status !== 'pending') {
          await interaction.followUp({ 
            content: `⚠️ This application was already ${app.status} on ${new Date(app.reviewed_at).toLocaleString()}`, 
            ephemeral: true 
          });
          
          // Still update the embed to show current state
          await editReviewedEmbed(interaction, app.status, app.reviewed_by || 'System', 
            app.status === 'rejected' ? `\n📝 Reason: ${app.rejection_reason || 'Not specified'}` : '', 
            appId);
          return;
        }

        // Update DB
        await supabase
          .from('applications')
          .update({
            status: 'accepted',
            reviewed_by: user.username,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', appId);

        // Assign mod role + send welcome DM
        logger.info(`🎯 Assigning role to ${app.discord_username} (${app.discord_id})`);
        const result = await assignModRole(app.discord_id, app.discord_username);
        logger.info(`Result: ${JSON.stringify(result)}`);

        // Build status note
        let note = '';
        if (result.success) {
          if (result.assigned?.length > 0) {
            note = `\n🎭 Role: ${result.assigned.map(r => r.name).join(', ')}`;
          }
          note += result.dmSent
            ? '\n📨 Welcome DM: Sent ✅'
            : '\n📨 Welcome DM: Failed (DMs disabled)';
        } else {
          note = `\n❗ Role error: ${result.error}`;
        }

        await editReviewedEmbed(interaction, 'accepted', user.username, note, appId);

      } catch (err) {
        logger.error('❌ Accept button error:', err.message);
      }
    }

    // ===== ❌ REJECT BUTTON =====
    else if (customId.startsWith('reject_')) {
      try {
        const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

        const [, appId, discordId] = customId.split('_');

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
        await interaction.showModal(modal);

        const modalSubmit = await interaction.awaitModalSubmit({
          filter: i => i.customId === `reject_modal_${appId}`,
          time: 60000
        });

        await modalSubmit.deferUpdate();
        const reason = modalSubmit.fields.getTextInputValue('reason');

        // Fetch application
        const { data: app, error } = await supabase
          .from('applications')
          .select('*')
          .eq('id', appId)
          .single();

        if (error || !app) {
          logger.error(`❌ App not found: ${appId}`);
          await editReviewedEmbed(interaction, 'rejected', user.username, '⚠️ DB record not found', appId);
          return;
        }

        // Check if already processed
        if (app.status !== 'pending') {
          await modalSubmit.followUp({ 
            content: `⚠️ This application was already ${app.status} on ${new Date(app.reviewed_at).toLocaleString()}`, 
            ephemeral: true 
          });
          
          await editReviewedEmbed(interaction, app.status, app.reviewed_by || 'System', 
            app.status === 'rejected' ? `\n📝 Reason: ${app.rejection_reason || 'Not specified'}` : '', 
            appId);
          return;
        }

        // Update DB
        await supabase
          .from('applications')
          .update({
            status: 'rejected',
            rejection_reason: reason,
            reviewed_by: user.username,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', appId);

        // Send rejection DM
        logger.info(`📨 Sending rejection DM to ${app.discord_username} (${app.discord_id})`);
        const dmResult = await sendRejectionDM(app.discord_id, app.discord_username, reason);
        logger.info(`DM result: ${dmResult}`);

        const note = `\n📝 Reason: ${reason}` +
          (dmResult
            ? '\n📨 DM: Sent ✅'
            : '\n📨 DM: Failed (user may have DMs disabled)');

        await editReviewedEmbed(interaction, 'rejected', user.username, note, appId);

      } catch (err) {
        if (err.code === 'InteractionCollectorError') {
          await interaction.followUp({ content: '⏰ Timed out. Try again.', ephemeral: true });
        } else {
          logger.error('❌ Reject button error:', err.message);
        }
      }
    }

    // ===== 📋 CONVERSATION LOG BUTTON =====
    else if (customId.startsWith('convo_')) {
      try {
        await interaction.deferReply({ ephemeral: true });

        const [, appId] = customId.split('_');

        logger.info(`📋 Convo log requested for ${appId} by ${user.tag}`);

        const { data: app, error } = await supabase
          .from('applications')
          .select('discord_username, score, correct_answers, total_questions, created_at, conversation_log, answers')
          .eq('id', appId)
          .single();

        if (error || !app) {
          await interaction.editReply({ content: '❌ Could not find this application in the database.' });
          return;
        }

        const score = app.score || `${app.correct_answers ?? 0}/${app.total_questions ?? 8}`;
        const submittedAt = app.created_at
          ? new Date(app.created_at).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC'
          : 'Unknown';

        const rawLog = app.conversation_log || app.answers || 'No log available.';
        const cleanLog = rawLog
          .replace(/[═╔╗╠╣╚╝║]/g, '-')
          .replace(/[┌┤├└│┐]/g, '|')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        const preview = cleanLog.length > 900
          ? cleanLog.substring(0, 900) + '\n[...truncated]'
          : cleanLog;

        await interaction.editReply({
          embeds: [{
            title: `📋 Test Log — ${app.discord_username}`,
            description: `**Score:** ${score} | **Submitted:** ${submittedAt}\n\n⚠️ *Only you can see this*`,
            color: 0x5865f2,
            fields: [
              {
                name: '📄 Preview',
                value: `\`\`\`\n${preview}\n\`\`\``,
                inline: false
              },
              {
                name: '🔗 Full Log',
                value: `View complete conversation in the **Admin Portal** under Application ID \`${appId}\``,
                inline: false
              }
            ],
            footer: { text: `App ID: ${appId}` }
          }]
        });

      } catch (err) {
        logger.error('❌ Convo button error:', err.message);
        try {
          await interaction.editReply({ content: '❌ Error loading conversation log.' });
        } catch {}
      }
    }
  });
}

// Helper to update embed after review
async function editReviewedEmbed(interaction, status, adminName, note, appId) {
  try {
    const originalEmbed = interaction.message?.embeds?.[0]?.toJSON();
    if (!originalEmbed) return;

    const embed = { ...originalEmbed };
    embed.color = status === 'accepted' ? 0x10b981 : 0xed4245;
    
    // Filter out old review fields
    embed.fields = (embed.fields || []).filter(f =>
      !f.name.includes('Accepted') && !f.name.includes('Rejected') && !f.name.includes('Reason')
    );
    
    embed.fields.push({
      name: status === 'accepted' ? '✅ Accepted By' : '❌ Rejected By',
      value: `${adminName}${note || ''}`,
      inline: false
    });

    await interaction.editReply({ embeds: [embed], components: [] });
    logger.success(`✅ Discord embed updated to ${status} for app ${appId}`);
  } catch (err) {
    logger.error('❌ editReviewedEmbed error:', err.message);
  }
}

// Boot interaction setup
setupDiscordInteractions();

// ==================== TEST ENDPOINTS ====================
app.get("/ping", (req, res) => {
  res.json({ success: true, message: "pong", time: new Date().toISOString() });
});

// Simple root status endpoint
app.get("/", (req, res) => {
  res.send("Void Esports Mod Backend is running ✅");
});

app.get("/set-test-intent", (req, res) => {
  if (req.session) {
    req.session.loginIntent = "test";
  }
  res.json({ success: true, message: "Intent set" });
});

app.get("/set-admin-intent", (req, res) => {
  if (req.session) {
    req.session.loginIntent = "admin";
  }
  res.json({ success: true, message: "Intent set" });
});

// ==================== STATIC PAGES ====================
app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'test.html'));
});

app.get("/bot-invite", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.send("DISCORD_CLIENT_ID not set");
  const link = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=268435456&scope=bot%20applications.commands`;
  res.send(`<a href="${link}">Invite Bot</a>`);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("https://hunterahead71-hash.github.io/void.training/");
  });
});

// ==================== ROUTES ====================
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/", submissionRoutes);
app.use("/debug", debugRoutes);
app.use("/", healthRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found", path: req.path });
});

// ==================== START ====================
app.listen(PORT, () => {
  logger.info(`
╔════════════════════════════════════════════════════════════════╗
║        VOID ESPORTS MOD TEST SERVER v3.2 — ALL FIXES          ║
╠════════════════════════════════════════════════════════════════╣
║ 🚀 Port: ${String(PORT).padEnd(52)}║
║ 📊 DB: ${(process.env.SUPABASE_URL ? '✅ CONFIGURED' : '❌ MISSING').padEnd(55)}║
║ 🏰 Guild: ${(process.env.DISCORD_GUILD_ID ? '✅ CONFIGURED' : '❌ MISSING').padEnd(53)}║
║ 🛡️  Mod Role: ${(process.env.MOD_ROLE_ID ? '✅ CONFIGURED' : '❌ MISSING').padEnd(49)}║
║ 🎮 Discord Buttons: ✅ Fixed with modal for reject            ║
║ 🔄 Discord/Portal Sync: ✅ Messages update on both sides      ║
║ 📱 Mobile Welcome: ✅ Fixed with extra delays                 ║
╚════════════════════════════════════════════════════════════════╝
  `);
});
