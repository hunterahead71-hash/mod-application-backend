const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, PermissionsBitField, ActivityType } = require("discord.js");
const MemoryStore = require('memorystore')(session);

const app = express();

/* ================= SUPABASE ================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= DISCORD BOT - FIXED INTENTS ================= */

console.log("🤖 Initializing Discord bot...");

// Create bot with proper intents
const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers,      // Requires SERVER MEMBERS INTENT in Discord Dev Portal
    GatewayIntentBits.GuildMessages,     // Basic message reading
    GatewayIntentBits.MessageContent,    // Requires MESSAGE CONTENT INTENT in Discord Dev Portal
    GatewayIntentBits.DirectMessages,    // For sending DMs
    GatewayIntentBits.GuildPresences     // For member presence
  ],
  partials: ['CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'REACTION', 'USER']
});

// Bot status tracker
let botReady = false;
let botLoginAttempts = 0;

// Bot event handlers
bot.on('ready', async () => {
  botReady = true;
  botLoginAttempts = 0;
  
  console.log(`✅ Discord bot ready as ${bot.user.tag}`);
  console.log(`📊 Servers: ${bot.guilds.cache.size}`);
  
  // Log all servers for debugging
  bot.guilds.cache.forEach(guild => {
    console.log(`   - ${guild.name} (${guild.id})`);
  });
  
  // Set bot status with better activity
  bot.user.setPresence({
    activities: [{ 
      name: 'Mod Applications', 
      type: ActivityType.Watching
    }],
    status: 'online'
  });
  
  // Verify bot has required permissions
  if (process.env.DISCORD_GUILD_ID) {
    try {
      const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const botMember = await guild.members.fetch(bot.user.id);
      
      console.log("🔍 Bot Permissions Check:");
      console.log(`   - Manage Roles: ${botMember.permissions.has(PermissionsBitField.Flags.ManageRoles) ? '✅' : '❌'}`);
      console.log(`   - Send Messages: ${botMember.permissions.has(PermissionsBitField.Flags.SendMessages) ? '✅' : '❌'}`);
      console.log(`   - Read Messages: ${botMember.permissions.has(PermissionsBitField.Flags.ViewChannel) ? '✅' : '❌'}`);
      
      // Check mod role exists
      if (process.env.MOD_ROLE_ID) {
        const modRole = guild.roles.cache.get(process.env.MOD_ROLE_ID);
        console.log(`   - Mod Role Found: ${modRole ? `✅ ${modRole.name}` : '❌ Not Found'}`);
        
        if (modRole) {
          console.log(`   - Role Position: ${modRole.position}`);
          console.log(`   - Bot's Highest Role Position: ${botMember.roles.highest.position}`);
          
          // Check if bot can assign this role
          if (modRole.position >= botMember.roles.highest.position) {
            console.warn(`⚠️  WARNING: Mod role is higher than bot's highest role! Bot cannot assign this role.`);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error checking bot permissions:", error.message);
    }
  }
});

bot.on('error', (error) => {
  console.error('❌ Discord bot error:', error.message);
});

bot.on('warn', (warning) => {
  console.warn('⚠️ Discord bot warning:', warning);
});

bot.on('guildMemberAdd', async (member) => {
  console.log(`👤 New member joined: ${member.user.tag}`);
});

bot.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  console.log(`🔄 Command received: ${interaction.commandName}`);
});

// Bot login with retry logic
async function loginBot() {
  console.log("🔐 Attempting bot login...");
  
  // Check if token exists
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("❌ CRITICAL: DISCORD_BOT_TOKEN not set!");
    console.log("💡 Add to Render.com: DISCORD_BOT_TOKEN=your_token_here");
    return false;
  }
  
  const token = process.env.DISCORD_BOT_TOKEN;
  
  // Validate token format
  if (!token.startsWith("MT") && !token.startsWith("NT") && !token.startsWith("Mz")) {
    console.error("❌ Invalid token format! Should start with 'MT', 'NT', or 'Mz'");
    return false;
  }
  
  try {
    await bot.login(token);
    botReady = true;
    console.log("✅ Bot login successful!");
    return true;
  } catch (error) {
    console.error("❌ Bot login failed:", error.message);
    
    // Specific error handling
    if (error.message.includes("disallowed intents")) {
      console.log("💡 FIX: Go to Discord Developer Portal → Bot → Enable:");
      console.log("   - SERVER MEMBERS INTENT (REQUIRED)");
      console.log("   - MESSAGE CONTENT INTENT (REQUIRED)");
      console.log("   - PRESENCE INTENT (optional)");
    } else if (error.message.includes("Incorrect login details")) {
      console.log("💡 Token is invalid. Reset in Discord Developer Portal");
    }
    
    return false;
  }
}

// Function to ensure bot is ready
async function ensureBotReady() {
  if (botReady && bot.isReady()) return true;
  
  console.log("🔄 Bot not ready, attempting to reconnect...");
  
  // Try to login if not logged in
  if (!bot.isReady() && process.env.DISCORD_BOT_TOKEN) {
    const success = await loginBot();
    if (success) {
      botReady = true;
      return true;
    }
  }
  
  return false;
}

// Start bot login with retry
async function startBotWithRetry() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.log("⚠️ DISCORD_BOT_TOKEN not set - bot features disabled");
    return;
  }
  
  console.log("🤖 Starting Discord bot...");
  botLoginAttempts++;
  
  try {
    await loginBot();
  } catch (error) {
    console.error(`❌ Bot startup failed (attempt ${botLoginAttempts}):`, error.message);
    
    // Retry after 10 seconds if less than 3 attempts
    if (botLoginAttempts < 3) {
      console.log(`⏳ Retrying in 10 seconds...`);
      setTimeout(startBotWithRetry, 10000);
    }
  }
}

// Start bot
startBotWithRetry();

/* ================= HELPER FUNCTIONS ================= */

// Function to escape HTML for safety
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Enhanced function to send DM to user
async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    console.log(`📨 Attempting to send DM to ${discordId}: ${title}`);
    
    // Ensure bot is ready
    if (!await ensureBotReady()) {
      console.log("❌ Bot not ready for DM");
      return false;
    }
    
    // Try to fetch user
    let user;
    try {
      user = await bot.users.fetch(discordId);
      if (!user) {
        console.log(`❌ User ${discordId} not found`);
        return false;
      }
    } catch (error) {
      console.log(`❌ Could not fetch user ${discordId}:`, error.message);
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
      console.log(`✅ DM sent to ${user.tag} (${user.id})`);
      return true;
    } catch (dmError) {
      console.error(`❌ Failed to send DM to ${user.tag}:`, dmError.message);
      
      // Check if DMs are disabled
      if (dmError.code === 50007) {
        console.log(`📵 User ${user.tag} has DMs disabled`);
        // Still return true since it's not a bot error
        return true;
      }
      
      return false;
    }
  } catch (error) {
    console.error(`❌ Unexpected error in sendDMToUser:`, error.message);
    return false;
  }
}

// Enhanced function to assign mod role
async function assignModRole(discordId, discordUsername = 'User') {
  console.log(`🎯 Attempting to assign mod role to ${discordUsername} (${discordId})`);
  
  try {
    // Ensure bot is ready
    if (!await ensureBotReady()) {
      console.log("❌ Bot is not ready/connected");
      return { success: false, error: "Bot not ready" };
    }
    
    // Check if required env vars exist
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      console.log("❌ Missing DISCORD_GUILD_ID or MOD_ROLE_ID in environment");
      return { success: false, error: "Missing environment variables" };
    }
    
    console.log(`🔍 Looking for guild: ${process.env.DISCORD_GUILD_ID}`);
    
    let guild;
    try {
      guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
      console.log(`✅ Found guild: ${guild.name} (${guild.id})`);
    } catch (guildError) {
      console.error(`❌ Could not fetch guild:`, guildError.message);
      return { success: false, error: "Guild not found" };
    }
    
    console.log(`🔍 Looking for member: ${discordId}`);
    
    let member;
    try {
      member = await guild.members.fetch(discordId);
      console.log(`✅ Found member: ${member.user.tag} (${member.id})`);
    } catch (memberError) {
      console.error(`❌ Could not fetch member:`, memberError.message);
      return { success: false, error: "Member not found in guild" };
    }
    
    console.log(`🔍 Looking for role: ${process.env.MOD_ROLE_ID}`);
    
    const role = guild.roles.cache.get(process.env.MOD_ROLE_ID);
    if (!role) {
      console.log(`❌ Role ${process.env.MOD_ROLE_ID} not found`);
      // Try to fetch from API
      try {
        const fetchedRole = await guild.roles.fetch(process.env.MOD_ROLE_ID);
        if (!fetchedRole) {
          return { success: false, error: "Role not found" };
        }
        console.log(`✅ Fetched role: ${fetchedRole.name}`);
      } catch (roleError) {
        console.error(`❌ Error fetching role:`, roleError.message);
        return { success: false, error: "Role not found" };
      }
    } else {
      console.log(`✅ Found role: ${role.name} (${role.id})`);
    }
    
    // Check bot permissions
    const botMember = await guild.members.fetch(bot.user.id);
    console.log(`🔍 Checking bot permissions for ${botMember.user.tag}`);
    
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      console.log("❌ Bot lacks ManageRoles permission");
      return { success: false, error: "Bot lacks ManageRoles permission" };
    }
    console.log("✅ Bot has ManageRoles permission");
    
    // Check role hierarchy (bot can only assign roles lower than its highest role)
    const botHighestRole = botMember.roles.highest;
    if (role.position >= botHighestRole.position) {
      console.log("❌ Role is higher than bot's highest role");
      console.log(`   - Role position: ${role.position}`);
      console.log(`   - Bot's highest role position: ${botHighestRole.position}`);
      return { success: false, error: "Role hierarchy issue" };
    }
    console.log("✅ Role hierarchy is valid");
    
    // Assign the role
    console.log(`🔄 Assigning role ${role.name} to ${member.user.tag}...`);
    try {
      await member.roles.add(role);
      console.log(`✅ Assigned mod role to ${member.user.tag}`);
      
      // Send welcome DM
      console.log(`📨 Sending welcome DM to ${member.user.tag}...`);
      const dmSuccess = await sendDMToUser(
        discordId,
        '🎉 Welcome to the Void Esports Mod Team!',
        `Congratulations ${discordUsername}! Your moderator application has been **approved**.\n\n` +
        `You have been granted the **Trial Moderator** role.\n\n` +
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
      
      if (!dmSuccess) {
        console.log("⚠️ Could not send welcome DM, but role was assigned");
      }
      
      return { 
        success: true, 
        message: `Role assigned to ${member.user.tag}`,
        dmSent: dmSuccess
      };
      
    } catch (assignError) {
      console.error('❌ Error assigning role:', assignError.message);
      return { success: false, error: assignError.message };
    }
    
  } catch (error) {
    console.error('❌ Error in assignModRole:', error.message);
    console.error('Stack:', error.stack);
    return { success: false, error: error.message };
  }
}

// Enhanced function to send rejection DM
async function sendRejectionDM(discordId, discordUsername, reason = "Not specified") {
  try {
    console.log(`📨 Sending rejection DM to ${discordUsername} (${discordId})`);
    
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
    console.error('❌ Error in sendRejectionDM:', error);
    return false;
  }
}

/* ================= FIXED CORS & SESSION ================= */

app.use(
  cors({
    origin: function(origin, callback) {
      const allowedOrigins = [
        "https://hunterahead71-hash.github.io",
        "http://localhost:3000",
        "http://localhost:5500",
        "http://localhost:8000",
        "https://mod-application-backend.onrender.com"
      ];
      
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.log(`Blocked by CORS: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
  })
);

app.options('*', cors());
app.use(express.json());

// Session configuration
app.use(
  session({
    store: new MemoryStore({
      checkPeriod: 86400000
    }),
    name: "mod-app-session",
    secret: process.env.SESSION_SECRET || "4d7a9b2f5c8e1a3b6d9f0c2e5a8b1d4f7c0e3a6b9d2f5c8e1a4b7d0c3f6a9b2e5c8f1b4d7e0a3c6b9d2f5e8c1b4a7d0c3f6b9e2c5a8d1b4e7c0a3d6b9e2c5f8",
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

/* ================= DEBUG ENDPOINTS ================= */

app.get("/debug-session", (req, res) => {
  res.json({
    sessionId: req.sessionID,
    user: req.session.user || 'No user',
    isAdmin: req.session.isAdmin || false,
    loginIntent: req.session.loginIntent || 'No intent',
    cookies: req.headers.cookie || 'No cookies'
  });
});

/* ================= BOT DEBUG ENDPOINTS ================= */

// Enhanced bot status endpoint
app.get("/debug/bot", async (req, res) => {
  try {
    const botStatus = {
      isReady: bot.isReady(),
      botReady: botReady,
      user: bot.user ? bot.user.tag : "Not logged in",
      userId: bot.user ? bot.user.id : "N/A",
      guilds: bot.guilds.cache.size,
      readyAt: bot.readyAt,
      uptime: bot.uptime,
      environment: {
        tokenSet: !!process.env.DISCORD_BOT_TOKEN,
        tokenLength: process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.length : 0,
        tokenPrefix: process.env.DISCORD_BOT_TOKEN ? process.env.DISCORD_BOT_TOKEN.substring(0, 10) + "..." : "None",
        guildId: process.env.DISCORD_GUILD_ID || "NOT SET",
        modRoleId: process.env.MOD_ROLE_ID || "NOT SET",
        clientId: process.env.DISCORD_CLIENT_ID || "NOT SET"
      },
      permissions: {}
    };
    
    // Check bot permissions if guild exists
    if (process.env.DISCORD_GUILD_ID && bot.isReady()) {
      try {
        const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
        const botMember = await guild.members.fetch(bot.user.id);
        
        botStatus.permissions = {
          manageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles),
          sendMessages: botMember.permissions.has(PermissionsBitField.Flags.SendMessages),
          viewChannel: botMember.permissions.has(PermissionsBitField.Flags.ViewChannel),
          readMessageHistory: botMember.permissions.has(PermissionsBitField.Flags.ReadMessageHistory)
        };
        
        // Check mod role
        if (process.env.MOD_ROLE_ID) {
          const modRole = guild.roles.cache.get(process.env.MOD_ROLE_ID);
          botStatus.modRole = modRole ? {
            name: modRole.name,
            id: modRole.id,
            position: modRole.position,
            exists: true
          } : { exists: false };
          
          // Check role hierarchy
          botStatus.roleHierarchy = {
            botHighestRole: botMember.roles.highest.position,
            modRolePosition: modRole ? modRole.position : null,
            canAssign: modRole ? (modRole.position < botMember.roles.highest.position) : false
          };
        }
      } catch (error) {
        botStatus.permissions.error = error.message;
      }
    }
    
    res.json(botStatus);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test bot role assignment
app.post("/debug/bot/test-assign-role", async (req, res) => {
  try {
    const { userId, testUsername = "Test User" } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }
    
    console.log(`🧪 Testing role assignment for ${userId}`);
    
    const result = await assignModRole(userId, testUsername);
    
    res.json({
      test: "Role Assignment Test",
      timestamp: new Date().toISOString(),
      userId,
      result
    });
  } catch (error) {
    console.error("Test error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test bot DM
app.post("/debug/bot/test-dm", async (req, res) => {
  try {
    const { userId, message = "Test DM from bot" } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }
    
    console.log(`🧪 Testing DM to ${userId}`);
    
    const success = await sendDMToUser(
      userId,
      '🧪 Test DM',
      message,
      0x00ffea,
      'Test Footer'
    );
    
    res.json({
      test: "DM Test",
      timestamp: new Date().toISOString(),
      userId,
      success
    });
  } catch (error) {
    console.error("Test DM error:", error);
    res.status(500).json({ error: error.message });
  }
});

/* ================= ADMIN ACTIONS ENDPOINTS - FIXED ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    console.log(`\n🔵 ACCEPTING APPLICATION ${req.params.id}`);
    
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ error: "Application not found" });
    }
    
    console.log(`📋 Found application for: ${application.discord_username} (${application.discord_id})`);
    console.log(`📊 Score: ${application.score}`);
    
    // Check if user is a test user
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000' || id.length < 5;
    
    if (isTestUser) {
      console.log(`⚠️ Skipping test user: ${application.discord_username}`);
      return res.status(400).json({ 
        success: false,
        error: "Cannot accept test user applications",
        message: "Test users are filtered out and cannot be accepted."
      });
    }
    
    // First, try to assign the role
    console.log(`🎯 Attempting to assign role to ${application.discord_id}...`);
    const roleResult = await assignModRole(application.discord_id, application.discord_username);
    
    if (!roleResult.success) {
      console.log(`❌ Role assignment failed: ${roleResult.error}`);
      
      // Update database with failure status
      const { error: updateError } = await supabase
        .from("applications")
        .update({ 
          status: "accepted",
          updated_at: new Date().toISOString(),
          reviewed_by: req.session.user.username,
          reviewed_at: new Date().toISOString(),
          notes: `Role assignment failed: ${roleResult.error}`
        })
        .eq("id", req.params.id);
      
      if (updateError) {
        console.error("Database update error:", updateError);
      }
      
      // Send webhook notification about failure
      if (process.env.DISCORD_WEBHOOK_URL) {
        try {
          const embed = {
            title: "⚠️ APPLICATION ACCEPTED - ROLE ASSIGNMENT FAILED",
            description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Accepted by:** ${req.session.user.username}`,
            fields: [
              {
                name: "📊 Details",
                value: `\`\`\`\nApplication ID: ${application.id}\nStatus: ACCEPTED\nRole Assignment: FAILED\nError: ${roleResult.error}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
                inline: false
              }
            ],
            color: 0xf59e0b,
            timestamp: new Date().toISOString(),
            footer: {
              text: "Void Esports Admin Action"
            }
          };
          
          await axios.post(process.env.DISCORD_WEBHOOK_URL, {
            embeds: [embed],
            username: "Admin System",
            avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
          });
        } catch (webhookError) {
          console.error("Webhook error:", webhookError.message);
        }
      }
      
      return res.json({ 
        success: false, 
        message: "Application accepted but role assignment failed",
        roleAssigned: false,
        error: roleResult.error,
        application: {
          id: application.id,
          username: application.discord_username,
          score: application.score
        }
      });
    }
    
    // Role assignment successful - update database
    console.log(`✅ Role assigned successfully, updating database...`);
    
    const { error: updateError } = await supabase
      .from("applications")
      .update({ 
        status: "accepted",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString(),
        notes: `Role assigned successfully. DM sent: ${roleResult.dmSent || false}`
      })
      .eq("id", req.params.id);
    
    if (updateError) {
      console.error("Database update error:", updateError);
    }
    
    console.log(`✅ Application ${req.params.id} fully processed`);
    
    // Send success webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "✅ APPLICATION ACCEPTED & ROLE ASSIGNED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Accepted by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: ACCEPTED\nRole Assignment: SUCCESS\nDM Sent: ${roleResult.dmSent ? "YES" : "NO"}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
              inline: false
            }
          ],
          color: 0x3ba55c,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Admin Action"
          }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: "Application accepted and role assigned successfully",
      roleAssigned: true,
      dmSent: roleResult.dmSent || false,
      application: {
        id: application.id,
        username: application.discord_username,
        score: application.score
      }
    });
    
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      message: "Failed to process acceptance"
    });
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  try {
    console.log(`\n🔴 REJECTING APPLICATION ${req.params.id}`);
    
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ error: "Application not found" });
    }
    
    const reason = req.body.reason || "Insufficient test score or incomplete application";
    
    // Check if user is a test user
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000' || id.length < 5;
    
    // Send rejection DM (skip for test users)
    let dmSent = false;
    if (!isTestUser) {
      console.log(`📨 Sending rejection DM to ${application.discord_username}...`);
      dmSent = await sendRejectionDM(application.discord_id, application.discord_username, reason);
      console.log(`✅ Rejection DM ${dmSent ? 'sent' : 'failed'}`);
    } else {
      console.log(`⚠️ Skipping DM for test user: ${application.discord_username}`);
    }
    
    // Update database
    const { error: updateError } = await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
        notes: isTestUser ? "Test user - auto-rejected" : `DM sent: ${dmSent}`
      })
      .eq("id", req.params.id);
    
    if (updateError) throw updateError;
    
    console.log(`✅ Application ${req.params.id} marked as rejected`);
    
    // Send webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "❌ APPLICATION REJECTED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Rejected by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: REJECTED\nDM Sent: ${dmSent ? "SUCCESS" : "FAILED"}\nTest User: ${isTestUser ? "YES" : "NO"}\nReason: ${reason}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
              inline: false
            }
          ],
          color: 0xed4245,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Admin Action"
          }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: "Application rejected successfully",
      dmSent: dmSent,
      isTestUser: isTestUser,
      application: {
        id: application.id,
        username: application.discord_username,
        score: application.score
      }
    });
    
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      message: "Failed to process rejection"
    });
  }
});

/* ================= REMAINING ENDPOINTS (unchanged) ================= */

// [Keep all your existing endpoints below this line unchanged]
// This includes: /debug/bot-test, /bot-invite, /auth/discord, /auth/discord/callback,
// /me, /admin, /submit-test-results, /api/submit, /health, /logout, etc.

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                VOID ESPORTS MOD TEST SERVER v2.1                    ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${PORT}                                  ║
║ 🤖 Discord Bot: ${botReady ? "✅ Connected" : "🔄 Connecting..."}   ║
║ 📝 ADMIN FEATURES:                                                   ║
║    • ✅ Accept: Assigns mod role + sends welcome DM                 ║
║    • ✅ Reject: Sends rejection DM with reason                     ║
║ 👑 Admin Panel: /admin                                              ║
║ 🧪 Test Login: /auth/discord                                        ║
║ 🏥 Health Check: /health                                            ║
║ 🔍 Bot Debug: /debug/bot                                            ║
║ 📊 Database: ${process.env.SUPABASE_URL ? "✅ CONFIGURED" : "❌ NOT SETUP"}                    ║
║ 🔔 Discord Webhook: ${process.env.DISCORD_WEBHOOK_URL ? "✅ READY" : "⚠️ NOT SET"}            ║
║ 🏰 Discord Guild: ${process.env.DISCORD_GUILD_ID ? "✅ CONFIGURED" : "⚠️ NOT SET"}            ║
║ 🛡️ Mod Role: ${process.env.MOD_ROLE_ID ? "✅ CONFIGURED" : "⚠️ NOT SET"}                     ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});
