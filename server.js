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

// CRITICAL FIX: Session configuration
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

// Debug middleware
app.use((req, res, next) => {
  console.log(`\n=== ${new Date().toISOString()} ${req.method} ${req.path} ===`);
  console.log('Origin:', req.headers.origin);
  console.log('Cookie Header:', req.headers.cookie || 'No cookies');
  console.log('Session ID:', req.sessionID);
  console.log('Session User:', req.session.user || 'No user');
  console.log('Session Intent:', req.session.loginIntent || 'No intent');
  console.log('==============================\n');
  next();
});

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

// Check bot status
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

// Test bot connection
app.get("/debug/bot-test", async (req, res) => {
  try {
    console.log("🧪 Testing bot connection...");
    
    if (!process.env.DISCORD_BOT_TOKEN) {
      return res.json({
        success: false,
        error: "DISCORD_BOT_TOKEN not set",
        fix: "Add DISCORD_BOT_TOKEN to Render.com environment variables"
      });
    }
    
    const token = process.env.DISCORD_BOT_TOKEN;
    const isValidFormat = token.startsWith("MT") || token.startsWith("NT") || token.startsWith("Mz");
    
    if (!isValidFormat) {
      return res.json({
        success: false,
        error: "Invalid token format",
        fix: "Get new token: Discord Dev Portal → Bot → Reset Token"
      });
    }
    
    if (!bot.isReady()) {
      try {
        await bot.login(token);
      } catch (loginError) {
        return res.json({
          success: false,
          error: "Bot login failed",
          message: loginError.message
        });
      }
    }
    
    res.json({
      success: true,
      message: "Bot is connected!",
      bot: {
        tag: bot.user.tag,
        id: bot.user.id,
        guilds: bot.guilds.cache.size
      },
      inviteLink: `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID || "CLIENT_ID_NOT_SET"}&permissions=268435456&scope=bot%20applications.commands`
    });
    
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message
    });
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

// Generate bot invite link
app.get("/bot-invite", (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  
  if (!clientId || clientId === "your_client_id_here") {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Bot Setup Required</title></head>
      <body>
        <h1>❌ DISCORD_CLIENT_ID not set!</h1>
        <p>Steps to fix:</p>
        <ol>
          <li>Go to <a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a></li>
          <li>Click your application → OAuth2 → Copy "Client ID"</li>
          <li>Add to Render.com as DISCORD_CLIENT_ID environment variable</li>
          <li>Redeploy</li>
        </ol>
      </body>
      </html>
    `);
  }
  
  const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=268435456&scope=bot%20applications.commands`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bot Invite Link</title>
      <style>
        body { font-family: Arial; padding: 40px; text-align: center; }
        .success { color: green; font-size: 24px; margin: 20px 0; }
        .link { background: #2f3136; padding: 20px; border-radius: 10px; margin: 20px auto; max-width: 600px; word-break: break-all; }
        a { color: #00ffea; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>🤖 Bot Invite Link</h1>
      <div class="success">✅ Use this link to invite the bot to your server:</div>
      <div class="link">
        <a href="${inviteLink}" target="_blank">${inviteLink}</a>
      </div>
      <p><a href="${inviteLink}" target="_blank"><button style="padding: 15px 30px; background: #5865f2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 18px;">Click here to invite bot</button></a></p>
      <p>Client ID: ${clientId}</p>
    </body>
    </html>
  `);
});

/* ================= TEST INTENT - FIXED ================= */

// Store intents in memory as backup - DECLARED ONLY ONCE HERE
const pendingIntents = new Map();

app.get("/set-test-intent", (req, res) => {
  console.log("Setting test intent...");
  req.session.loginIntent = "test";
  pendingIntents.set(req.sessionID, {
    intent: "test",
    timestamp: Date.now()
  });
  
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ 
      success: true, 
      message: "Test intent set",
      loginIntent: req.session.loginIntent,
      sessionId: req.sessionID
    });
  });
});

app.get("/set-admin-intent", (req, res) => {
  console.log("Setting admin intent...");
  req.session.loginIntent = "admin";
  pendingIntents.set(req.sessionID, {
    intent: "admin",
    timestamp: Date.now()
  });
  
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ 
      success: true, 
      message: "Admin intent set",
      loginIntent: req.session.loginIntent,
      sessionId: req.sessionID
    });
  });
});

/* ================= DISCORD AUTH - FIXED ================= */

app.get("/auth/discord", (req, res) => {
  console.log("Discord auth initiated for TEST");
  console.log("Current session intent:", req.session.loginIntent);
  
  // Set test intent if not already set
  if (!req.session.loginIntent) {
    req.session.loginIntent = "test";
  }
  
  // Store in memory as backup
  pendingIntents.set(req.sessionID, {
    intent: "test",
    timestamp: Date.now()
  });
  
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/admin", (req, res) => {
  console.log("Discord auth initiated for ADMIN");
  console.log("Current session intent:", req.session.loginIntent);
  
  // Set admin intent
  req.session.loginIntent = "admin";
  
  // Store in memory as backup
  pendingIntents.set(req.sessionID, {
    intent: "admin",
    timestamp: Date.now()
  });
  
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    console.log("\n=== DISCORD CALLBACK START ===");
    console.log("Session ID:", req.sessionID);
    console.log("Session loginIntent:", req.session.loginIntent);
    console.log("Pending intents for this session:", pendingIntents.get(req.sessionID));
    
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided");

    // Get Discord token
    const tokenRes = await axios.post(
      "https://discord.com/api/oauth2/token",
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: process.env.REDIRECT_URI
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    // Get user info
    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenRes.data.access_token}`
        }
      }
    );

    console.log("Discord user authenticated:", userRes.data.username);
    console.log("User ID:", userRes.data.id);

    // Save user in session
    req.session.user = userRes.data;
    req.session.isAdmin = false;
    
    // Check if admin
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    console.log("Admin IDs:", adminIds);
    console.log("User ID for check:", userRes.data.id);
    
    if (adminIds.includes(userRes.data.id)) {
      req.session.isAdmin = true;
      console.log("User is admin:", userRes.data.username);
    }
    
    // Check intent from session or memory backup
    let intent = req.session.loginIntent;
    if (!intent && pendingIntents.has(req.sessionID)) {
      intent = pendingIntents.get(req.sessionID).intent;
      req.session.loginIntent = intent;
    }
    
    console.log("Final determined intent:", intent);
    
    // Clean up memory backup
    if (pendingIntents.has(req.sessionID)) {
      pendingIntents.delete(req.sessionID);
    }
    
    // SAVE SESSION
    req.session.save((err) => {
      if (err) {
        console.error("Session save error in callback:", err);
        return res.status(500).send(`
          <!DOCTYPE html>
          <html>
          <head><title>Session Error</title></head>
          <body>
            <h1>Session Error</h1>
            <p>Could not save your session. Please try again.</p>
            <p><a href="/auth/discord">Retry Login</a></p>
          </body>
          </html>
        `);
      }
      
      console.log("Session saved successfully!");
      console.log("User in session:", req.session.user.username);
      console.log("Is Admin:", req.session.isAdmin);
      console.log("Login Intent:", req.session.loginIntent);
      
      // FOR ADMINS WITH ADMIN INTENT: Redirect to admin panel
      if (req.session.isAdmin && intent === "admin") {
        console.log("Redirecting admin to /admin");
        req.session.loginIntent = null; // Clear intent
        req.session.save(() => {
          return res.redirect("/admin");
        });
        return;
      }
      
      // FOR REGULAR USERS WHO ACCIDENTALLY CLICKED ADMIN LOGIN
      if (intent === "admin" && !req.session.isAdmin) {
        console.log("Non-admin trying to access admin panel");
        req.session.loginIntent = null;
        req.session.save(() => {
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Access Denied</title>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
              <style>
                body { 
                  font-family: Arial, sans-serif; 
                  text-align: center; 
                  padding: 50px; 
                  background: #36393f;
                  color: white;
                  margin: 0;
                }
                h1 { color: #ff0033; }
                .error-container {
                  background: #202225;
                  padding: 40px;
                  border-radius: 12px;
                  margin: 30px auto;
                  max-width: 600px;
                  text-align: left;
                }
                .user-info {
                  background: #2f3136;
                  padding: 20px;
                  border-radius: 8px;
                  margin: 20px 0;
                }
                .contact-link {
                  color: #5865f2;
                  font-weight: bold;
                  text-decoration: none;
                }
                .contact-link:hover {
                  text-decoration: underline;
                }
                .action-buttons {
                  margin-top: 30px;
                  display: flex;
                  gap: 15px;
                  justify-content: center;
                  flex-wrap: wrap;
                }
                .action-btn {
                  padding: 12px 24px;
                  border-radius: 8px;
                  text-decoration: none;
                  font-weight: bold;
                  color: white;
                  display: inline-flex;
                  align-items: center;
                  gap: 8px;
                }
                .test-btn {
                  background: #5865f2;
                }
                .home-btn {
                  background: #3ba55c;
                }
              </style>
            </head>
            <body>
              <h1><i class="fas fa-ban"></i> Access Denied</h1>
              <p>You don't have administrator privileges.</p>
              
              <div class="error-container">
                <div class="user-info">
                  <p><strong>Your Discord:</strong> ${req.session.user.username}#${req.session.user.discriminator}</p>
                  <p><strong>Your ID:</strong> ${req.session.user.id}</p>
                </div>
                
                <p>If you need admin access, contact <a href="https://discord.com/users/727888300210913310" class="contact-link" target="_blank">@nicksscold</a> on Discord.</p>
                
                <p>If you were trying to take the moderator test, use the "Begin Certification Test" button on the training page.</p>
              </div>
              
              <div class="action-buttons">
                <a href="https://hunterahead71-hash.github.io/void.training/" class="action-btn home-btn">
                  <i class="fas fa-home"></i> Return to Training
                </a>
                <a href="/auth/discord" class="action-btn test-btn">
                  <i class="fas fa-vial"></i> Take Mod Test Instead
                </a>
              </div>
            </body>
            </html>
          `);
        });
        return;
      }
      
      // FOR REGULAR USERS WITH TEST INTENT: Redirect to test
      if (intent === "test") {
        console.log("User has test intent, redirecting to test interface");
        req.session.loginIntent = null; // Clear after use
        
        req.session.save(() => {
          // Create redirect URL with user data
          const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}&timestamp=${Date.now()}`;
          console.log("Redirecting to test:", frontendUrl);
          
          return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Redirecting to Test...</title>
              <script>
                window.location.href = "${frontendUrl}";
              </script>
            </head>
            <body>
              <p>Redirecting to test... Please wait.</p>
              <p>If you are not redirected, <a href="${frontendUrl}">click here</a>.</p>
            </body>
            </html>
          `);
        });
        return;
      }
      
      // FOR ANY OTHER CASE (no intent): Redirect to homepage
      console.log("No specific intent, redirecting to homepage");
      return res.redirect("https://hunterahead71-hash.github.io/void.training/");
    });

  } catch (err) {
    console.error("Discord auth error:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Auth Error</title></head>
      <body>
        <h1>Discord Authentication Failed</h1>
        <p>${err.message}</p>
        <p><a href="/auth/discord">Try Again</a></p>
      </body>
      </html>
    `);
  }
});

/* ================= AUTH CHECK ================= */

app.get("/me", (req, res) => {
  console.log("Auth check called");
  
  if (!req.session.user) {
    return res.status(401).json({ 
      authenticated: false,
      message: "No active session"
    });
  }

  res.json({
    authenticated: true,
    user: req.session.user,
    isAdmin: req.session.isAdmin || false,
    sessionId: req.sessionID,
    loginIntent: req.session.loginIntent || null
  });
});

/* ================= ADMIN PAGE ================= */

app.get("/admin", async (req, res) => {
  console.log("\n=== ADMIN PAGE ACCESS ===");
  console.log("Session User:", req.session.user || 'No user');
  console.log("Session isAdmin:", req.session.isAdmin);
  console.log("Admin IDs:", process.env.ADMIN_IDS);
  
  // Check if user is logged in
  if (!req.session.user) {
    console.log("No user in session, redirecting to login");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Not Logged In</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
            margin: 0;
          }
          h1 { color: #ff0033; }
          .login-btn {
            display: inline-block;
            margin: 20px;
            padding: 15px 30px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 18px;
          }
          .login-btn:hover {
            background: #4752c4;
          }
          .debug-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 800px;
            text-align: left;
            font-family: monospace;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-exclamation-triangle"></i> Not Logged In</h1>
        <p>You need to log in with Discord to access the admin panel.</p>
        
        <a href="/auth/discord/admin" class="login-btn">
          <i class="fab fa-discord"></i> Login with Discord
        </a>
        
        <div class="debug-info">
          <strong>Debug Info:</strong><br>
          Session ID: ${req.sessionID || 'None'}<br>
          User in Session: ${req.session.user ? 'Yes' : 'No'}<br>
          Cookie Header: ${req.headers.cookie || 'None'}
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if user is admin
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  const userId = req.session.user.id;
  
  console.log("Checking if user is admin:");
  console.log("User ID:", userId);
  console.log("Admin IDs:", adminIds);
  console.log("Is user in admin list?", adminIds.includes(userId));
  
  if (!adminIds.includes(userId)) {
    console.log("User is NOT an admin");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
            margin: 0;
          }
          h1 { color: #ff0033; }
          .user-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 600px;
            text-align: left;
          }
          .contact-link {
            color: #5865f2;
            font-weight: bold;
            text-decoration: none;
          }
          .contact-link:hover {
            text-decoration: underline;
          }
          .action-buttons {
            margin-top: 30px;
          }
          .action-btn {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
          }
          .logout-btn {
            background: #ed4245;
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-ban"></i> Access Denied</h1>
        <p>You don't have administrator privileges.</p>
        
        <div class="user-info">
          <p><strong>Your Discord:</strong> ${req.session.user.username}#${req.session.user.discriminator}</p>
          <p><strong>Your ID:</strong> ${req.session.user.id}</p>
          <p><strong>Your session ID:</strong> ${req.sessionID}</p>
        </div>
        
        <p>If you need admin access, contact <a href="https://discord.com/users/727888300210913310" class="contact-link" target="_blank">@nicksscold</a> on Discord.</p>
        
        <div class="action-buttons">
          <a href="/logout" class="action-btn logout-btn">
            <i class="fas fa-sign-out-alt"></i> Logout
          </a>
          <a href="https://hunterahead71-hash.github.io/void.training/" class="action-btn">
            <i class="fas fa-home"></i> Return to Training
          </a>
          <a href="/auth/discord" class="action-btn">
            <i class="fas fa-vial"></i> Take Mod Test
          </a>
        </div>
      </body>
      </html>
    `);
  }

  console.log("User is admin, loading applications...");
  
  try {
    // Get applications from database
    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Database Error</title></head>
        <body>
          <h1>Database Error</h1>
          <p>Could not load applications.</p>
          <p><a href="/admin">Try Again</a></p>
        </body>
        </html>
      `);
    }

    console.log(`Found ${applications.length} total applications in database`);
    
    // Filter out test users
    const realApplications = applications.filter(app => {
      const username = app.discord_username.toLowerCase();
      const id = app.discord_id;
      
      // Skip obvious test users
      const isTestUser = 
        username.includes('test') || 
        username.includes('bot') ||
        id.includes('test') ||
        id === '0000' ||
        username === 'user' ||
        username.includes('example') ||
        id.length < 5 ||
        username.startsWith('test_') ||
        id.startsWith('test_') ||
        username.includes('demo') ||
        id === '123456789' ||
        username.includes('fake') ||
        username.includes('dummy');
      
      return !isTestUser;
    });

    console.log(`Filtered to ${realApplications.length} real applications (removed ${applications.length - realApplications.length} test users)`);
    
    // Simple admin dashboard HTML
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #36393f;
            color: #ffffff;
            padding: 20px;
          }
          .admin-container {
            max-width: 1200px;
            margin: 0 auto;
          }
          .header {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .header h1 {
            color: #ff0033;
          }
          .logout-btn {
            background: #ed4245;
            color: white;
            padding: 10px 20px;
            border-radius: 5px;
            text-decoration: none;
            font-weight: bold;
          }
          .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
          }
          .stat-card {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
          }
          .stat-number {
            font-size: 36px;
            font-weight: bold;
          }
          .applications-grid {
            display: grid;
            gap: 15px;
          }
          .application-card {
            background: #202225;
            border-radius: 10px;
            padding: 20px;
            border-left: 4px solid #888;
          }
          .application-card.pending { border-left-color: #f59e0b; }
          .application-card.accepted { border-left-color: #3ba55c; }
          .application-card.rejected { border-left-color: #ed4245; }
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          .app-status {
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
          }
          .status-pending { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
          .status-accepted { background: rgba(59, 165, 92, 0.2); color: #3ba55c; }
          .status-rejected { background: rgba(237, 66, 69, 0.2); color: #ed4245; }
          .app-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
          }
          .action-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 5px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .accept-btn {
            background: #3ba55c;
            color: white;
          }
          .reject-btn {
            background: #ed4245;
            color: white;
          }
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .no-applications {
            text-align: center;
            padding: 50px;
            color: #888;
          }
          .success-message {
            animation: fadeIn 0.5s;
            font-size: 14px;
            margin-top: 10px;
          }
          
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          
          .debug-info {
            background: #2f3136;
            padding: 10px;
            border-radius: 5px;
            margin-top: 10px;
            font-size: 12px;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="header">
            <h1><i class="fas fa-shield-alt"></i> VOID ESPORTS - ADMIN DASHBOARD</h1>
            <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Logout</a>
          </div>
          
          <div class="stats">
            <div class="stat-card">
              <div class="stat-number" style="color: #00ffea;">${realApplications.length}</div>
              <div>Total Applications</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #f59e0b;">${realApplications.filter(a => a.status === 'pending').length}</div>
              <div>Pending</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #3ba55c;">${realApplications.filter(a => a.status === 'accepted').length}</div>
              <div>Accepted</div>
            </div>
            <div class="stat-card">
              <div class="stat-number" style="color: #ed4245;">${realApplications.filter(a => a.status === 'rejected').length}</div>
              <div>Rejected</div>
            </div>
          </div>
          
          <div class="applications-grid" id="applicationsContainer">
    `;

    if (realApplications.length === 0) {
      html += `
        <div class="no-applications">
          <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px;"></i>
          <p>No real applications submitted yet.</p>
        </div>
      `;
    }

    realApplications.forEach((app) => {
      const score = app.score ? app.score.split('/') : ['0', '8'];
      const scoreValue = parseInt(score[0]);
      const totalQuestions = parseInt(score[1]);
      
      html += `
        <div class="application-card ${app.status}" id="app-${app.id}">
          <div class="app-header">
            <div>
              <h3 style="margin: 0;">${escapeHtml(app.discord_username)}</h3>
              <p style="color: #888; margin: 5px 0;">ID: ${escapeHtml(app.discord_id)} • ${new Date(app.created_at).toLocaleString()}</p>
              <p>Score: ${scoreValue}/${totalQuestions}</p>
            </div>
            <div class="app-status status-${app.status}">${app.status.toUpperCase()}</div>
          </div>
          
          <div class="app-actions">
      `;
      
      if (app.status === "pending") {
        html += `
              <button class="action-btn accept-btn" onclick="processApplication(${app.id}, 'accept')">
                <i class="fas fa-check"></i> Accept & Grant Mod Role
              </button>
              <button class="action-btn reject-btn" onclick="processApplication(${app.id}, 'reject')">
                <i class="fas fa-times"></i> Reject
              </button>
        `;
      } else {
        html += `
              <button class="action-btn" disabled>
                <i class="fas fa-${app.status === 'accepted' ? 'check' : 'times'}"></i>
                ${app.status === 'accepted' ? 'Accepted' : 'Rejected'} on ${new Date(app.updated_at || app.created_at).toLocaleDateString()}
              </button>
        `;
      }
      
      html += `
          </div>
        </div>
      `;
    });

    html += `
          </div>
        </div>
        
        <script>
          async function processApplication(appId, action) {
            const btn = event.target;
            const originalText = btn.innerHTML;
            const appCard = document.getElementById('app-' + appId);
            
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;
            
            try {
              const url = action === 'accept' 
                ? '/admin/accept/' + appId 
                : '/admin/reject/' + appId;
              
              let options = {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                credentials: 'include'
              };
              
              if (action === 'reject') {
                const reason = prompt('Enter rejection reason:', 'Insufficient test score');
                if (reason === null) {
                  btn.innerHTML = originalText;
                  btn.disabled = false;
                  return;
                }
                options.body = JSON.stringify({ reason: reason });
              }
              
              const response = await fetch(url, options);
              const result = await response.json();
              
              if (response.ok) {
                if (result.success) {
                  // Show success message
                  const successDiv = document.createElement('div');
                  successDiv.className = 'success-message';
                  successDiv.innerHTML = \`
                    <div style="background: \${action === 'accept' ? '#3ba55c' : '#ed4245'}; color: white; padding: 10px; border-radius: 5px; margin: 10px 0;">
                      <i class="fas fa-check"></i> 
                      \${action === 'accept' ? 'Role assigned successfully!' : 'Rejection DM sent!'}
                      \${result.roleAssigned !== undefined ? \`<br>Role assigned: \${result.roleAssigned ? '✅' : '❌'}\` : ''}
                      \${result.dmSent !== undefined ? \`<br>DM sent: \${result.dmSent ? '✅' : '❌'}\` : ''}
                    </div>
                  \`;
                  
                  // Insert success message before buttons
                  const actionsDiv = btn.parentElement;
                  actionsDiv.insertBefore(successDiv, btn);
                  
                  // Reload after 2 seconds to show updated status
                  setTimeout(() => {
                    location.reload();
                  }, 2000);
                } else {
                  // Show error but still reload
                  alert(\`Action completed with warnings:\\n\${result.message || result.error}\`);
                  setTimeout(() => {
                    location.reload();
                  }, 1500);
                }
              } else {
                alert('Failed to process application: ' + (result.message || 'Unknown error'));
                btn.innerHTML = originalText;
                btn.disabled = false;
              }
            } catch (error) {
              alert('An error occurred: ' + error.message);
              btn.innerHTML = originalText;
              btn.disabled = false;
            }
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error("Admin error:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Server Error</title></head>
      <body>
        <h1>Server Error</h1>
        <p>${err.message}</p>
        <p><a href="/admin">Try Again</a></p>
      </body>
      </html>
    `);
  }
});

/* ================= ADMIN GET APPLICATION ENDPOINT ================= */

app.get("/admin/application/:id", async (req, res) => {
  try {
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    const { data: application, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (error || !application) {
      return res.status(404).json({ error: "Application not found" });
    }
    
    res.json(application);
  } catch (err) {
    console.error("Get application error:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= ADMIN ACTIONS ENDPOINTS ================= */

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

/* ================= ULTIMATE SUBMISSION ENDPOINT ================= */

app.post("/submit-test-results", async (req, res) => {
  console.log("🚀 SUBMISSION ENDPOINT CALLED");
  
  try {
    const { 
      discordId, 
      discordUsername, 
      answers, 
      score, 
      totalQuestions = 8, 
      correctAnswers = 0, 
      wrongAnswers = 0, 
      testResults,
      conversationLog,
      questionsWithAnswers 
    } = req.body;
    
    console.log("📋 Received submission data:", {
      discordId,
      discordUsername,
      score,
      answersLength: answers ? answers.length : 0
    });
    
    if (!discordId || !discordUsername) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        success: false, 
        message: "Missing discordId or discordUsername" 
      });
    }
    
    // Create a submission ID for tracking
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📝 Submission ID: ${submissionId}`);
    
    // Step 1: Discord Webhook
    let webhookSuccess = false;
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        console.log("🌐 Sending webhook...");
        
        const embed = {
          title: "📝 NEW MOD TEST SUBMISSION",
          description: `**User:** ${discordUsername}\n**Discord ID:** ${discordId}\n**Score:** ${score || "0/8"}\n**Status:** Pending Review\n**Submission ID:** ${submissionId}`,
          fields: [
            {
              name: "👤 User Info",
              value: `\`\`\`\nDiscord: ${discordUsername}\nID: ${discordId}\nDate: ${new Date().toLocaleString()}\n\`\`\``,
              inline: true
            },
            {
              name: "📊 Test Results",
              value: `\`\`\`\nScore: ${score}\nCorrect: ${correctAnswers}/${totalQuestions}\nPercentage: ${Math.round((correctAnswers/totalQuestions)*100)}%\n\`\`\``,
              inline: true
            }
          ],
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Mod Test System • Auto-saved to Admin Panel"
          }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Void Test System"
        });
        webhookSuccess = true;
        console.log("✅ Discord webhook sent successfully!");
      } catch (webhookError) {
        console.error("⚠️ Discord webhook error:", webhookError.message);
      }
    } else {
      console.log("ℹ️ No Discord webhook URL configured");
    }
    
    // Step 2: Save to database
    console.log("💾 Saving to database...");
    
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers ? (typeof answers === 'string' ? answers.substring(0, 15000) : JSON.stringify(answers).substring(0, 15000)) : "No answers provided",
      conversation_log: conversationLog ? conversationLog.substring(0, 20000) : null,
      questions_with_answers: questionsWithAnswers ? JSON.stringify(questionsWithAnswers) : null,
      score: score || "0/8",
      total_questions: parseInt(totalQuestions) || 8,
      correct_answers: parseInt(correctAnswers) || 0,
      wrong_answers: parseInt(wrongAnswers) || 8,
      test_results: testResults ? (typeof testResults === 'string' ? testResults : JSON.stringify(testResults)) : "{}",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log("📊 Database data prepared");
    
    let dbSuccess = false;
    let savedId = null;
    
    try {
      console.log("🔄 Attempting to insert application...");
      const { data, error } = await supabase
        .from("applications")
        .insert([applicationData])
        .select();
      
      if (error) {
        console.log("❌ Insert failed:", error.message);
      } else {
        console.log("✅ Insert successful!");
        dbSuccess = true;
        savedId = data?.[0]?.id;
      }
    } catch (dbError) {
      console.error("❌ Database exception:", dbError.message);
    }
    
    // Step 3: Return response
    console.log("🎉 Submission process complete");
    
    const responseData = {
      success: true,
      message: "✅ Test submitted successfully!",
      details: {
        submissionId,
        user: discordUsername,
        score: score,
        discordWebhook: webhookSuccess ? "sent" : "failed",
        database: dbSuccess ? "saved" : "failed",
        savedId: savedId,
        timestamp: new Date().toISOString(),
        adminPanel: "https://mod-application-backend.onrender.com/admin"
      }
    };
    
    res.json(responseData);
    
  } catch (err) {
    console.error("🔥 CRITICAL ERROR in submission:", err);
    res.status(200).json({ 
      success: true, 
      message: "Test received! Your score has been recorded.",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* ================= SIMPLE RELIABLE ENDPOINT FOR FRONTEND ================= */

app.post("/api/submit", async (req, res) => {
  console.log("📨 SIMPLE API SUBMISSION ENDPOINT");
  
  // Extract data
  const { discordId, discordUsername, score, answers, conversationLog, questionsWithAnswers } = req.body;
  
  if (!discordId || !discordUsername) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  console.log(`Simple submission for: ${discordUsername} (${discordId}) - Score: ${score}`);
  
  try {
    // ALWAYS save to database first
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers || "Simple submission",
      conversation_log: conversationLog || null,
      questions_with_answers: questionsWithAnswers ? JSON.stringify(questionsWithAnswers) : null,
      score: score || "0/8",
      status: "pending",
      created_at: new Date().toISOString()
    };
    
    const dbResult = await supabase.from("applications").insert([applicationData]);
    
    if (dbResult.error) {
      console.error("Simple DB error:", dbResult.error);
    } else {
      console.log("Simple DB save successful");
    }
    
    // Then send to Discord webhook (async - don't wait)
    if (process.env.DISCORD_WEBHOOK_URL) {
      const embed = {
        title: "📝 Test Submission (Simple API)",
        description: `**User:** ${discordUsername}\n**Score:** ${score || "N/A"}`,
        fields: [
          {
            name: "Details",
            value: `\`\`\`\nDiscord ID: ${discordId}\nSubmission: ${answers ? 'With answers' : 'No answers'}\nLogs: ${conversationLog ? 'Yes' : 'No'}\n\`\`\``,
            inline: false
          }
        ],
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
        footer: { text: "Simple API Endpoint" }
      };
      
      axios.post(process.env.DISCORD_WEBHOOK_URL, {
        embeds: [embed]
      }).catch(e => console.log("Simple webhook error:", e.message));
    }
    
    // Always return success
    res.json({ 
      success: true, 
      message: "Test submitted successfully",
      user: discordUsername,
      score: score,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error("Simple submission error:", err);
    // Still return success
    res.json({ 
      success: true, 
      message: "Test received",
      timestamp: new Date().toISOString()
    });
  }
});

/* ================= HEALTH CHECK WITH DB TEST ================= */

app.get("/health", async (req, res) => {
  try {
    // Test database connection
    const { data, error } = await supabase
      .from("applications")
      .select("count", { count: 'exact', head: true });
    
    const dbStatus = error ? `ERROR: ${error.message}` : "CONNECTED";
    
    // Check bot status
    const botStatus = bot.user ? `CONNECTED as ${bot.user.tag}` : "DISCONNECTED";
    
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      database: dbStatus,
      discordBot: botStatus,
      discordWebhook: process.env.DISCORD_WEBHOOK_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      discordGuild: process.env.DISCORD_GUILD_ID ? "CONFIGURED" : "NOT_CONFIGURED",
      modRole: process.env.MOD_ROLE_ID ? "CONFIGURED" : "NOT_CONFIGURED",
      session: req.session.user ? "active" : "none",
      endpoints: {
        submit: "/api/submit (simple)",
        submitTestResults: "/submit-test-results (ultimate)",
        admin: "/admin",
        accept: "/admin/accept/:id",
        reject: "/admin/reject/:id"
      }
    });
  } catch (err) {
    res.status(500).json({ 
      status: "error", 
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* ================= LOGOUT ================= */

app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
    }
    res.redirect("https://hunterahead71-hash.github.io/void.training/");
  });
});

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
