
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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences
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
            console.warn(`💡 FIX: Move the bot's role higher than the mod role in Discord Server Settings → Roles`);
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

// FIXED function to assign mod role - COMPLETELY REWRITTEN
async function assignModRole(discordId, discordUsername = 'User') {
  console.log(`\n🎯 ATTEMPTING TO ASSIGN MOD ROLE`);
  console.log(`   User: ${discordUsername} (${discordId})`);
  
  try {
    // 1. Check if bot is ready
    if (!await ensureBotReady()) {
      console.log("❌ Bot is not ready/connected");
      return { success: false, error: "Bot not ready. Please check if bot is online and has proper intents enabled." };
    }
    
    // 2. Check if required environment variables exist
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      console.log("❌ Missing environment variables");
      console.log(`   DISCORD_GUILD_ID: ${process.env.DISCORD_GUILD_ID ? "Set" : "NOT SET"}`);
      console.log(`   MOD_ROLE_ID: ${process.env.MOD_ROLE_ID ? "Set" : "NOT SET"}`);
      return { success: false, error: "Missing Discord configuration. Check DISCORD_GUILD_ID and MOD_ROLE_ID environment variables." };
    }
    
    const guildId = process.env.DISCORD_GUILD_ID;
    const roleId = process.env.MOD_ROLE_ID;
    
    console.log(`🔍 Guild ID: ${guildId}`);
    console.log(`🔍 Role ID: ${roleId}`);
    
    // 3. Fetch guild
    let guild;
    try {
      guild = await bot.guilds.fetch(guildId);
      console.log(`✅ Found guild: ${guild.name} (${guild.id})`);
    } catch (guildError) {
      console.error(`❌ Could not fetch guild:`, guildError.message);
      return { success: false, error: `Guild not found. Bot might not be in this server. Error: ${guildError.message}` };
    }
    
    // 4. Fetch member (user in the guild)
    let member;
    try {
      member = await guild.members.fetch(discordId);
      console.log(`✅ Found member: ${member.user.tag} (${member.id})`);
    } catch (memberError) {
      console.error(`❌ Could not fetch member:`, memberError.message);
      return { success: false, error: `User not found in the server. Make sure ${discordUsername} is in ${guild.name}. Error: ${memberError.message}` };
    }
    
    // 5. Fetch role
    let role;
    try {
      role = await guild.roles.fetch(roleId);
      if (!role) {
        console.log(`❌ Role ${roleId} not found`);
        return { success: false, error: `Mod role not found. Check MOD_ROLE_ID environment variable.` };
      }
      console.log(`✅ Found role: ${role.name} (${role.id})`);
    } catch (roleError) {
      console.error(`❌ Error fetching role:`, roleError.message);
      return { success: false, error: `Could not fetch role. Error: ${roleError.message}` };
    }
    
    // 6. Check bot permissions
    const botMember = await guild.members.fetch(bot.user.id);
    console.log(`🔍 Bot member: ${botMember.user.tag}`);
    console.log(`🔍 Bot permissions:`, botMember.permissions.toArray());
    
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      console.log("❌ Bot lacks ManageRoles permission");
      return { success: false, error: "Bot lacks 'Manage Roles' permission. Grant this permission in Discord server settings." };
    }
    console.log("✅ Bot has ManageRoles permission");
    
    // 7. Check role hierarchy - CRITICAL FIX
    const botHighestRole = botMember.roles.highest;
    console.log(`🔍 Bot's highest role: ${botHighestRole.name} (position: ${botHighestRole.position})`);
    console.log(`🔍 Mod role position: ${role.position}`);
    
    if (role.position >= botHighestRole.position) {
      console.log("❌ Role hierarchy issue: Mod role is higher than or equal to bot's highest role");
      console.log(`💡 FIX: In Discord Server Settings → Roles, drag the bot's role ABOVE the mod role`);
      return { success: false, error: "Role hierarchy issue. Bot's role must be higher than the mod role in Discord server settings." };
    }
    console.log("✅ Role hierarchy is valid");
    
    // 8. Check if member already has the role
    if (member.roles.cache.has(role.id)) {
      console.log(`ℹ️ Member already has the role`);
      return { success: true, message: "Member already has the role", dmSent: false };
    }
    
    // 9. Assign the role - FINAL STEP
    console.log(`🔄 Assigning role "${role.name}" to ${member.user.tag}...`);
    try {
      await member.roles.add(role);
      console.log(`✅ SUCCESS: Assigned mod role to ${member.user.tag}`);
      
      // 10. Send welcome DM
      console.log(`📨 Attempting to send welcome DM...`);
      const dmSuccess = await sendDMToUser(
        discordId,
        '🎉 Welcome to the Void Esports Mod Team!',
        `Congratulations ${discordUsername}! Your moderator application has been **approved**.\n\n` +
        `You have been granted the **${role.name}** role.\n\n` +
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
      
      if (dmSuccess) {
        console.log(`✅ Welcome DM sent to ${member.user.tag}`);
      } else {
        console.log(`⚠️ Could not send welcome DM (user may have DMs disabled)`);
      }
      
      return { 
        success: true, 
        message: `Successfully assigned ${role.name} to ${member.user.tag}`,
        dmSent: dmSuccess,
        details: {
          username: member.user.tag,
          role: role.name,
          guild: guild.name
        }
      };
      
    } catch (assignError) {
      console.error('❌ ERROR assigning role:', assignError.message);
      console.error('Full error:', assignError);
      
      // Specific error handling
      if (assignError.message.includes("Missing Permissions")) {
        return { success: false, error: "Bot lacks permissions. Make sure bot has 'Manage Roles' permission and its role is above the mod role." };
      } else if (assignError.message.includes("Invalid Form Body")) {
        return { success: false, error: "Invalid role ID. Check MOD_ROLE_ID environment variable." };
      } else if (assignError.message.includes("rate limited")) {
        return { success: false, error: "Rate limited by Discord. Please try again in a few seconds." };
      } else {
        return { success: false, error: `Failed to assign role: ${assignError.message}` };
      }
    }
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR in assignModRole:', error.message);
    console.error('Stack trace:', error.stack);
    return { success: false, error: `Unexpected error: ${error.message}` };
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

/* ================= ADVANCED ADMIN PORTAL ================= */

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
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
            color: white;
            margin: 0;
          }
          h1 { color: #ff0033; }
          .login-btn {
            display: inline-block;
            margin: 20px;
            padding: 15px 30px;
            background: linear-gradient(135deg, #5865f2, #4752c4);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 18px;
            box-shadow: 0 4px 15px rgba(88, 101, 242, 0.3);
            transition: all 0.3s ease;
          }
          .login-btn:hover {
            background: linear-gradient(135deg, #4752c4, #5865f2);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(88, 101, 242, 0.4);
          }
          .debug-info {
            background: rgba(32, 34, 37, 0.8);
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 800px;
            text-align: left;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
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
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
            color: white;
            margin: 0;
          }
          h1 { color: #ff0033; }
          .user-info {
            background: rgba(32, 34, 37, 0.8);
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 600px;
            text-align: left;
            border: 1px solid rgba(255, 255, 255, 0.1);
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
            background: linear-gradient(135deg, #5865f2, #4752c4);
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            transition: all 0.3s ease;
          }
          .logout-btn {
            background: linear-gradient(135deg, #ed4245, #c03939);
          }
          .action-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
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
    
    // Calculate statistics
    const pendingApplications = realApplications.filter(app => app.status === 'pending');
    const acceptedApplications = realApplications.filter(app => app.status === 'accepted');
    const rejectedApplications = realApplications.filter(app => app.status === 'rejected');
    
    // Advanced admin dashboard HTML
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Advanced Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          :root {
            --void-abyss: #000010;
            --void-blood: #ff0033;
            --void-neon: #00ffea;
            --void-purple: #8b5cf6;
            --discord-bg: #36393f;
            --discord-primary: #202225;
            --discord-secondary: #2f3136;
            --discord-tertiary: #40444b;
            --discord-green: #3ba55c;
            --discord-red: #ed4245;
            --discord-yellow: #f59e0b;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, var(--void-abyss) 0%, #0a0a1a 50%, #1a002a 100%);
            color: #ffffff;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
          
          .admin-container {
            max-width: 1600px;
            margin: 0 auto;
            padding: 20px;
          }
          
          /* Header */
          .header {
            background: linear-gradient(135deg, rgba(255, 0, 51, 0.1), rgba(0, 255, 234, 0.05));
            border: 1px solid rgba(255, 0, 51, 0.2);
            border-radius: 20px;
            padding: 30px;
            margin-bottom: 30px;
            backdrop-filter: blur(10px);
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          }
          
          .header-top {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
          }
          
          .header-title {
            font-size: 32px;
            font-weight: 800;
            background: linear-gradient(135deg, #ff0033, #00ffea);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            text-shadow: 0 0 30px rgba(255, 0, 51, 0.3);
          }
          
          .header-user {
            display: flex;
            align-items: center;
            gap: 15px;
            background: rgba(32, 34, 37, 0.8);
            padding: 12px 20px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          
          .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, #ff0033, #8b5cf6);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 18px;
          }
          
          .user-info {
            display: flex;
            flex-direction: column;
          }
          
          .username {
            font-weight: 600;
            font-size: 16px;
          }
          
          .user-role {
            font-size: 12px;
            color: #00ffea;
            background: rgba(0, 255, 234, 0.1);
            padding: 2px 8px;
            border-radius: 10px;
            display: inline-block;
            margin-top: 2px;
          }
          
          .header-actions {
            display: flex;
            gap: 12px;
          }
          
          .header-btn {
            padding: 10px 20px;
            background: linear-gradient(135deg, #5865f2, #4752c4);
            color: white;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: all 0.3s ease;
            text-decoration: none;
            font-size: 14px;
          }
          
          .header-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(88, 101, 242, 0.4);
          }
          
          .logout-btn {
            background: linear-gradient(135deg, #ed4245, #c03939);
          }
          
          /* Stats Grid */
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          
          .stat-card {
            background: linear-gradient(135deg, rgba(32, 34, 37, 0.9), rgba(47, 49, 54, 0.9));
            border-radius: 16px;
            padding: 25px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            transition: all 0.3s ease;
            cursor: pointer;
          }
          
          .stat-card:hover {
            transform: translateY(-5px);
            border-color: rgba(0, 255, 234, 0.3);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
          }
          
          .stat-card.pending { border-left: 5px solid var(--discord-yellow); }
          .stat-card.accepted { border-left: 5px solid var(--discord-green); }
          .stat-card.rejected { border-left: 5px solid var(--discord-red); }
          .stat-card.total { border-left: 5px solid var(--void-purple); }
          
          .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .stat-icon {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
          }
          
          .stat-card.pending .stat-icon { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
          .stat-card.accepted .stat-icon { background: rgba(59, 165, 92, 0.2); color: #3ba55c; }
          .stat-card.rejected .stat-icon { background: rgba(237, 66, 69, 0.2); color: #ed4245; }
          .stat-card.total .stat-icon { background: rgba(139, 92, 246, 0.2); color: #8b5cf6; }
          
          .stat-title {
            font-size: 14px;
            color: #888;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .stat-number {
            font-size: 36px;
            font-weight: 800;
            margin: 10px 0;
          }
          
          .stat-trend {
            font-size: 12px;
            color: #888;
            display: flex;
            align-items: center;
            gap: 5px;
          }
          
          /* Bot Status */
          .bot-status {
            background: linear-gradient(135deg, rgba(32, 34, 37, 0.9), rgba(47, 49, 54, 0.9));
            border-radius: 16px;
            padding: 25px;
            margin-bottom: 30px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
          }
          
          .status-item {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          
          .status-icon {
            width: 50px;
            height: 50px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            background: rgba(0, 255, 234, 0.1);
            color: #00ffea;
          }
          
          .status-info {
            flex: 1;
          }
          
          .status-label {
            font-size: 12px;
            color: #888;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .status-value {
            font-size: 18px;
            font-weight: 600;
            margin-top: 5px;
          }
          
          .status-good { color: #3ba55c; }
          .status-bad { color: #ed4245; }
          .status-warning { color: #f59e0b; }
          
          /* Tabs Navigation */
          .tabs-container {
            margin-bottom: 30px;
          }
          
          .tabs-nav {
            display: flex;
            gap: 10px;
            background: rgba(32, 34, 37, 0.8);
            padding: 10px;
            border-radius: 12px;
            margin-bottom: 20px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          
          .tab-btn {
            padding: 12px 24px;
            background: transparent;
            color: #888;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            gap: 8px;
            position: relative;
          }
          
          .tab-btn:hover {
            color: white;
            background: rgba(255, 255, 255, 0.1);
          }
          
          .tab-btn.active {
            background: linear-gradient(135deg, #5865f2, #4752c4);
            color: white;
          }
          
          .tab-badge {
            background: var(--void-blood);
            color: white;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            margin-left: 5px;
          }
          
          /* Applications Container */
          .applications-container {
            display: none;
          }
          
          .applications-container.active {
            display: block;
            animation: fadeIn 0.5s ease;
          }
          
          .applications-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
            gap: 20px;
          }
          
          @media (max-width: 768px) {
            .applications-grid {
              grid-template-columns: 1fr;
            }
          }
          
          /* Application Card */
          .application-card {
            background: linear-gradient(135deg, rgba(32, 34, 37, 0.9), rgba(47, 49, 54, 0.9));
            border-radius: 16px;
            padding: 25px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
          }
          
          .application-card:hover {
            transform: translateY(-5px);
            border-color: rgba(0, 255, 234, 0.3);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
          }
          
          .application-card.pending { border-left: 5px solid var(--discord-yellow); }
          .application-card.accepted { border-left: 5px solid var(--discord-green); }
          .application-card.rejected { border-left: 5px solid var(--discord-red); }
          
          .card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
          }
          
          .user-avatar-small {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: linear-gradient(135deg, #ff0033, #8b5cf6);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 20px;
            margin-right: 15px;
          }
          
          .user-details {
            flex: 1;
          }
          
          .username {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 5px;
          }
          
          .user-id {
            font-size: 12px;
            color: #888;
            font-family: 'JetBrains Mono', monospace;
          }
          
          .application-status {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          
          .status-pending {
            background: rgba(245, 158, 11, 0.2);
            color: #f59e0b;
          }
          
          .status-accepted {
            background: rgba(59, 165, 92, 0.2);
            color: #3ba55c;
          }
          
          .status-rejected {
            background: rgba(237, 66, 69, 0.2);
            color: #ed4245;
          }
          
          .application-info {
            margin: 20px 0;
            padding: 15px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.05);
          }
          
          .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 14px;
          }
          
          .info-label {
            color: #888;
          }
          
          .info-value {
            font-weight: 600;
          }
          
          .score-display {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 10px;
          }
          
          .score-value {
            font-size: 24px;
            font-weight: 800;
            color: #00ffea;
          }
          
          .score-total {
            color: #888;
            font-size: 14px;
          }
          
          .progress-bar {
            height: 6px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 3px;
            margin-top: 10px;
            overflow: hidden;
          }
          
          .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00ffea, #8b5cf6);
            border-radius: 3px;
            transition: width 0.8s ease;
          }
          
          .card-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
          }
          
          .action-btn {
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.3s ease;
            font-size: 14px;
          }
          
          .accept-btn {
            background: linear-gradient(135deg, #3ba55c, #2d8b4f);
            color: white;
          }
          
          .reject-btn {
            background: linear-gradient(135deg, #ed4245, #c03939);
            color: white;
          }
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
          }
          
          .action-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
          }
          
          .action-btn.accept-btn:hover:not(:disabled) {
            box-shadow: 0 8px 25px rgba(59, 165, 92, 0.4);
          }
          
          .action-btn.reject-btn:hover:not(:disabled) {
            box-shadow: 0 8px 25px rgba(237, 66, 69, 0.4);
          }
          
          /* No Applications */
          .no-applications {
            text-align: center;
            padding: 60px 20px;
            color: #888;
          }
          
          .no-applications-icon {
            font-size: 60px;
            margin-bottom: 20px;
            opacity: 0.3;
          }
          
          /* Success Messages */
          .success-message {
            background: linear-gradient(135deg, rgba(59, 165, 92, 0.2), rgba(59, 165, 92, 0.1));
            border: 1px solid rgba(59, 165, 92, 0.3);
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            animation: fadeIn 0.5s ease;
          }
          
          .error-message {
            background: linear-gradient(135deg, rgba(237, 66, 69, 0.2), rgba(237, 66, 69, 0.1));
            border: 1px solid rgba(237, 66, 69, 0.3);
            border-radius: 10px;
            padding: 15px;
            margin-top: 15px;
            animation: fadeIn 0.5s ease;
          }
          
          /* Modal */
          .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(5px);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 1000;
            padding: 20px;
          }
          
          .modal-overlay.active {
            display: flex;
            animation: fadeIn 0.3s ease;
          }
          
          .modal-content {
            background: linear-gradient(135deg, rgba(32, 34, 37, 0.95), rgba(47, 49, 54, 0.95));
            border-radius: 20px;
            padding: 30px;
            max-width: 500px;
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
          }
          
          .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
          }
          
          .modal-title {
            font-size: 24px;
            font-weight: 600;
          }
          
          .modal-close {
            background: transparent;
            border: none;
            color: #888;
            font-size: 24px;
            cursor: pointer;
            transition: color 0.3s ease;
          }
          
          .modal-close:hover {
            color: white;
          }
          
          .modal-textarea {
            width: 100%;
            min-height: 120px;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 15px;
            color: white;
            font-family: inherit;
            font-size: 14px;
            margin-bottom: 20px;
            resize: vertical;
          }
          
          .modal-textarea:focus {
            outline: none;
            border-color: #00ffea;
          }
          
          .modal-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
          }
          
          .modal-btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
          }
          
          .modal-btn.cancel {
            background: rgba(255, 255, 255, 0.1);
            color: white;
          }
          
          .modal-btn.confirm {
            background: linear-gradient(135deg, #ed4245, #c03939);
            color: white;
          }
          
          .modal-btn.cancel:hover {
            background: rgba(255, 255, 255, 0.2);
          }
          
          .modal-btn.confirm:hover {
            box-shadow: 0 8px 25px rgba(237, 66, 69, 0.4);
          }
          
          /* Animations */
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          
          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(0, 255, 234, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(0, 255, 234, 0); }
            100% { box-shadow: 0 0 0 0 rgba(0, 255, 234, 0); }
          }
          
          .pulse {
            animation: pulse 2s infinite;
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <!-- Header -->
          <div class="header">
            <div class="header-top">
              <h1 class="header-title">
                <i class="fas fa-shield-alt"></i> VOID ESPORTS ADMIN DASHBOARD
              </h1>
              <div class="header-user">
                <div class="user-avatar">
                  ${req.session.user.username.charAt(0).toUpperCase()}
                </div>
                <div class="user-info">
                  <div class="username">${req.session.user.username}</div>
                  <div class="user-role">ADMINISTRATOR</div>
                </div>
              </div>
            </div>
            
            <div class="header-actions">
              <a href="/debug/bot" class="header-btn" target="_blank">
                <i class="fas fa-robot"></i> Bot Status
              </a>
              <a href="/bot-invite" class="header-btn" target="_blank">
                <i class="fas fa-link"></i> Invite Bot
              </a>
              <a href="https://discord.gg/dqHF9HPucf" class="header-btn" target="_blank">
                <i class="fab fa-discord"></i> Discord Server
              </a>
              <a href="/logout" class="header-btn logout-btn">
                <i class="fas fa-sign-out-alt"></i> Logout
              </a>
            </div>
          </div>
          
          <!-- Statistics -->
          <div class="stats-grid">
            <div class="stat-card total" onclick="showTab('all')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Total Applications</div>
                  <div class="stat-number">${realApplications.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-layer-group"></i>
                </div>
              </div>
              <div class="stat-trend">
                <i class="fas fa-chart-line"></i> All real applications
              </div>
            </div>
            
            <div class="stat-card pending" onclick="showTab('pending')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Pending Review</div>
                  <div class="stat-number">${pendingApplications.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-clock"></i>
                </div>
              </div>
              <div class="stat-trend">
                <i class="fas fa-exclamation-circle"></i> Requires attention
              </div>
            </div>
            
            <div class="stat-card accepted" onclick="showTab('accepted')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Accepted</div>
                  <div class="stat-number">${acceptedApplications.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-check-circle"></i>
                </div>
              </div>
              <div class="stat-trend">
                <i class="fas fa-user-check"></i> Role assigned
              </div>
            </div>
            
            <div class="stat-card rejected" onclick="showTab('rejected')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Rejected</div>
                  <div class="stat-number">${rejectedApplications.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-times-circle"></i>
                </div>
              </div>
              <div class="stat-trend">
                <i class="fas fa-user-slash"></i> DM sent
              </div>
            </div>
          </div>
          
          <!-- Bot Status -->
          <div class="bot-status">
            <div class="status-item">
              <div class="status-icon pulse">
                <i class="fas fa-robot"></i>
              </div>
              <div class="status-info">
                <div class="status-label">Bot Status</div>
                <div class="status-value ${botReady ? 'status-good' : 'status-bad'}">
                  ${botReady ? '✅ Connected' : '❌ Disconnected'}
                </div>
              </div>
            </div>
            
            <div class="status-item">
              <div class="status-icon">
                <i class="fas fa-server"></i>
              </div>
              <div class="status-info">
                <div class="status-label">Discord Server</div>
                <div class="status-value ${process.env.DISCORD_GUILD_ID ? 'status-good' : 'status-bad'}">
                  ${process.env.DISCORD_GUILD_ID ? '✅ Configured' : '❌ Not Set'}
                </div>
              </div>
            </div>
            
            <div class="status-item">
              <div class="status-icon">
                <i class="fas fa-user-tag"></i>
              </div>
              <div class="status-info">
                <div class="status-label">Mod Role</div>
                <div class="status-value ${process.env.MOD_ROLE_ID ? 'status-good' : 'status-bad'}">
                  ${process.env.MOD_ROLE_ID ? '✅ Configured' : '❌ Not Set'}
                </div>
              </div>
            </div>
            
            <div class="status-item">
              <div class="status-icon">
                <i class="fas fa-bell"></i>
              </div>
              <div class="status-info">
                <div class="status-label">Webhook</div>
                <div class="status-value ${process.env.DISCORD_WEBHOOK_URL ? 'status-good' : 'status-warning'}">
                  ${process.env.DISCORD_WEBHOOK_URL ? '✅ Active' : '⚠️ Not Set'}
                </div>
              </div>
            </div>
          </div>
          
          <!-- Tabs Navigation -->
          <div class="tabs-container">
            <div class="tabs-nav">
              <button class="tab-btn active" onclick="showTab('pending')">
                <i class="fas fa-clock"></i> Pending
                <span class="tab-badge">${pendingApplications.length}</span>
              </button>
              <button class="tab-btn" onclick="showTab('accepted')">
                <i class="fas fa-check-circle"></i> Accepted
                <span class="tab-badge">${acceptedApplications.length}</span>
              </button>
              <button class="tab-btn" onclick="showTab('rejected')">
                <i class="fas fa-times-circle"></i> Rejected
                <span class="tab-badge">${rejectedApplications.length}</span>
              </button>
              <button class="tab-btn" onclick="showTab('all')">
                <i class="fas fa-layer-group"></i> All Applications
                <span class="tab-badge">${realApplications.length}</span>
              </button>
            </div>
            
            <!-- Pending Applications -->
            <div id="tab-pending" class="applications-container active">
              <div class="applications-grid">
    `;
    
    // Render pending applications
    if (pendingApplications.length === 0) {
      html += `
                <div class="no-applications">
                  <div class="no-applications-icon">
                    <i class="fas fa-inbox"></i>
                  </div>
                  <h3>No Pending Applications</h3>
                  <p>All applications have been reviewed.</p>
                </div>
      `;
    } else {
      pendingApplications.forEach((app) => {
        const score = app.score ? app.score.split('/') : ['0', '8'];
        const scoreValue = parseInt(score[0]);
        const totalQuestions = parseInt(score[1]);
        const percentage = (scoreValue / totalQuestions) * 100;
        const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
        
        html += `
                <div class="application-card pending" id="app-${app.id}">
                  <div class="card-header">
                    <div style="display: flex; align-items: flex-start;">
                      <div class="user-avatar-small">${usernameInitial}</div>
                      <div class="user-details">
                        <div class="username">${escapeHtml(app.discord_username)}</div>
                        <div class="user-id">ID: ${escapeHtml(app.discord_id)}</div>
                      </div>
                    </div>
                    <div class="application-status status-pending">PENDING</div>
                  </div>
                  
                  <div class="application-info">
                    <div class="info-row">
                      <span class="info-label">Submitted:</span>
                      <span class="info-value">${new Date(app.created_at).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Score:</span>
                      <div class="score-display">
                        <span class="score-value">${scoreValue}</span>
                        <span class="score-total">/ ${totalQuestions}</span>
                        <span style="color: #888; font-size: 14px;">(${Math.round(percentage)}%)</span>
                      </div>
                    </div>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                  </div>
                  
                  <div class="card-actions">
                    <button class="action-btn accept-btn" onclick="processApplication(${app.id}, 'accept', '${escapeHtml(app.discord_username)}')">
                      <i class="fas fa-check"></i> Accept & Assign Role
                    </button>
                    <button class="action-btn reject-btn" onclick="showRejectModal(${app.id}, '${escapeHtml(app.discord_username)}')">
                      <i class="fas fa-times"></i> Reject
                    </button>
                  </div>
                </div>
        `;
      });
    }
    
    html += `
              </div>
            </div>
            
            <!-- Accepted Applications -->
            <div id="tab-accepted" class="applications-container">
              <div class="applications-grid">
    `;
    
    // Render accepted applications
    if (acceptedApplications.length === 0) {
      html += `
                <div class="no-applications">
                  <div class="no-applications-icon">
                    <i class="fas fa-check-circle"></i>
                  </div>
                  <h3>No Accepted Applications</h3>
                  <p>No applications have been accepted yet.</p>
                </div>
      `;
    } else {
      acceptedApplications.forEach((app) => {
        const score = app.score ? app.score.split('/') : ['0', '8'];
        const scoreValue = parseInt(score[0]);
        const totalQuestions = parseInt(score[1]);
        const percentage = (scoreValue / totalQuestions) * 100;
        const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
        const reviewedDate = app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : 'Not reviewed';
        const reviewer = app.reviewed_by || 'Unknown';
        
        html += `
                <div class="application-card accepted" id="app-${app.id}">
                  <div class="card-header">
                    <div style="display: flex; align-items: flex-start;">
                      <div class="user-avatar-small">${usernameInitial}</div>
                      <div class="user-details">
                        <div class="username">${escapeHtml(app.discord_username)}</div>
                        <div class="user-id">ID: ${escapeHtml(app.discord_id)}</div>
                      </div>
                    </div>
                    <div class="application-status status-accepted">ACCEPTED</div>
                  </div>
                  
                  <div class="application-info">
                    <div class="info-row">
                      <span class="info-label">Reviewed by:</span>
                      <span class="info-value">${reviewer}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Reviewed at:</span>
                      <span class="info-value">${reviewedDate}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Score:</span>
                      <div class="score-display">
                        <span class="score-value">${scoreValue}</span>
                        <span class="score-total">/ ${totalQuestions}</span>
                        <span style="color: #888; font-size: 14px;">(${Math.round(percentage)}%)</span>
                      </div>
                    </div>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                  </div>
                  
                  <div class="card-actions">
                    <button class="action-btn" disabled style="background: rgba(59, 165, 92, 0.3);">
                      <i class="fas fa-user-check"></i> Role Assigned
                    </button>
                  </div>
                </div>
        `;
      });
    }
    
    html += `
              </div>
            </div>
            
            <!-- Rejected Applications -->
            <div id="tab-rejected" class="applications-container">
              <div class="applications-grid">
    `;
    
    // Render rejected applications
    if (rejectedApplications.length === 0) {
      html += `
                <div class="no-applications">
                  <div class="no-applications-icon">
                    <i class="fas fa-times-circle"></i>
                  </div>
                  <h3>No Rejected Applications</h3>
                  <p>No applications have been rejected yet.</p>
                </div>
      `;
    } else {
      rejectedApplications.forEach((app) => {
        const score = app.score ? app.score.split('/') : ['0', '8'];
        const scoreValue = parseInt(score[0]);
        const totalQuestions = parseInt(score[1]);
        const percentage = (scoreValue / totalQuestions) * 100;
        const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
        const reviewedDate = app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : 'Not reviewed';
        const reviewer = app.reviewed_by || 'Unknown';
        const reason = app.rejection_reason || 'No reason provided';
        
        html += `
                <div class="application-card rejected" id="app-${app.id}">
                  <div class="card-header">
                    <div style="display: flex; align-items: flex-start;">
                      <div class="user-avatar-small">${usernameInitial}</div>
                      <div class="user-details">
                        <div class="username">${escapeHtml(app.discord_username)}</div>
                        <div class="user-id">ID: ${escapeHtml(app.discord_id)}</div>
                      </div>
                    </div>
                    <div class="application-status status-rejected">REJECTED</div>
                  </div>
                  
                  <div class="application-info">
                    <div class="info-row">
                      <span class="info-label">Reviewed by:</span>
                      <span class="info-value">${reviewer}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Reviewed at:</span>
                      <span class="info-value">${reviewedDate}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Reason:</span>
                      <span class="info-value" style="color: #ed4245; font-size: 13px;">${escapeHtml(reason.substring(0, 100))}${reason.length > 100 ? '...' : ''}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Score:</span>
                      <div class="score-display">
                        <span class="score-value">${scoreValue}</span>
                        <span class="score-total">/ ${totalQuestions}</span>
                        <span style="color: #888; font-size: 14px;">(${Math.round(percentage)}%)</span>
                      </div>
                    </div>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                  </div>
                  
                  <div class="card-actions">
                    <button class="action-btn" disabled style="background: rgba(237, 66, 69, 0.3);">
                      <i class="fas fa-comment-slash"></i> Rejection DM Sent
                    </button>
                  </div>
                </div>
        `;
      });
    }
    
    html += `
              </div>
            </div>
            
            <!-- All Applications -->
            <div id="tab-all" class="applications-container">
              <div class="applications-grid">
    `;
    
    // Render all applications
    if (realApplications.length === 0) {
      html += `
                <div class="no-applications">
                  <div class="no-applications-icon">
                    <i class="fas fa-inbox"></i>
                  </div>
                  <h3>No Applications</h3>
                  <p>No applications have been submitted yet.</p>
                </div>
      `;
    } else {
      realApplications.forEach((app) => {
        const score = app.score ? app.score.split('/') : ['0', '8'];
        const scoreValue = parseInt(score[0]);
        const totalQuestions = parseInt(score[1]);
        const percentage = (scoreValue / totalQuestions) * 100;
        const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
        const statusClass = app.status === 'pending' ? 'status-pending' : app.status === 'accepted' ? 'status-accepted' : 'status-rejected';
        const statusText = app.status === 'pending' ? 'PENDING' : app.status === 'accepted' ? 'ACCEPTED' : 'REJECTED';
        
        html += `
                <div class="application-card ${app.status}" id="app-${app.id}">
                  <div class="card-header">
                    <div style="display: flex; align-items: flex-start;">
                      <div class="user-avatar-small">${usernameInitial}</div>
                      <div class="user-details">
                        <div class="username">${escapeHtml(app.discord_username)}</div>
                        <div class="user-id">ID: ${escapeHtml(app.discord_id)}</div>
                      </div>
                    </div>
                    <div class="application-status ${statusClass}">${statusText}</div>
                  </div>
                  
                  <div class="application-info">
                    <div class="info-row">
                      <span class="info-label">Status:</span>
                      <span class="info-value" style="color: ${app.status === 'pending' ? '#f59e0b' : app.status === 'accepted' ? '#3ba55c' : '#ed4245'}">
                        ${statusText}
                      </span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Submitted:</span>
                      <span class="info-value">${new Date(app.created_at).toLocaleString()}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">Score:</span>
                      <div class="score-display">
                        <span class="score-value">${scoreValue}</span>
                        <span class="score-total">/ ${totalQuestions}</span>
                        <span style="color: #888; font-size: 14px;">(${Math.round(percentage)}%)</span>
                      </div>
                    </div>
                    <div class="progress-bar">
                      <div class="progress-fill" style="width: ${percentage}%"></div>
                    </div>
                  </div>
                  
                  ${app.status === 'pending' ? `
                  <div class="card-actions">
                    <button class="action-btn accept-btn" onclick="processApplication(${app.id}, 'accept', '${escapeHtml(app.discord_username)}')">
                      <i class="fas fa-check"></i> Accept
                    </button>
                    <button class="action-btn reject-btn" onclick="showRejectModal(${app.id}, '${escapeHtml(app.discord_username)}')">
                      <i class="fas fa-times"></i> Reject
                    </button>
                  </div>
                  ` : `
                  <div class="card-actions">
                    <button class="action-btn" disabled style="background: rgba(255, 255, 255, 0.1);">
                      <i class="fas fa-${app.status === 'accepted' ? 'user-check' : 'comment-slash'}"></i>
                      ${app.status === 'accepted' ? 'Role Assigned' : 'Rejection DM Sent'}
                    </button>
                  </div>
                  `}
                </div>
        `;
      });
    }
    
    html += `
              </div>
            </div>
          </div>
        </div>
        
        <!-- Rejection Modal -->
        <div class="modal-overlay" id="rejectModal">
          <div class="modal-content">
            <div class="modal-header">
              <h2 class="modal-title">
                <i class="fas fa-times-circle" style="color: #ed4245;"></i> Reject Application
              </h2>
              <button class="modal-close" onclick="closeRejectModal()">×</button>
            </div>
            <p style="margin-bottom: 20px; color: #888;">Please provide a reason for rejection. This will be sent to the user via DM.</p>
            <textarea class="modal-textarea" id="rejectReason" placeholder="Enter rejection reason...">Insufficient test score or incomplete application</textarea>
            <div class="modal-actions">
              <button class="modal-btn cancel" onclick="closeRejectModal()">Cancel</button>
              <button class="modal-btn confirm" id="confirmReject">Confirm Rejection</button>
            </div>
          </div>
        </div>
        
        <script>
          let currentAppId = null;
          let currentAppUsername = '';
          
          // Tab navigation
          function showTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.applications-container').forEach(tab => {
              tab.classList.remove('active');
            });
            
            // Remove active class from all buttons
            document.querySelectorAll('.tab-btn').forEach(btn => {
              btn.classList.remove('active');
            });
            
            // Show selected tab
            document.getElementById('tab-' + tabName).classList.add('active');
            
            // Activate button
            document.querySelectorAll('.tab-btn').forEach(btn => {
              if (btn.textContent.includes(tabName.charAt(0).toUpperCase() + tabName.slice(1)) || 
                  (tabName === 'all' && btn.textContent.includes('All'))) {
                btn.classList.add('active');
              }
            });
          }
          
          // Rejection modal
          function showRejectModal(appId, username) {
            currentAppId = appId;
            currentAppUsername = username;
            document.getElementById('rejectModal').classList.add('active');
            document.getElementById('rejectReason').focus();
          }
          
          function closeRejectModal() {
            document.getElementById('rejectModal').classList.remove('active');
            currentAppId = null;
            currentAppUsername = '';
          }
          
          // Process application
          async function processApplication(appId, action, username = '') {
            const appCard = document.getElementById('app-' + appId);
            if (!appCard) return;
            
            const buttons = appCard.querySelectorAll('.action-btn');
            buttons.forEach(btn => {
              btn.disabled = true;
              if (btn.classList.contains('accept-btn')) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
              } else if (btn.classList.contains('reject-btn')) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
              }
            });
            
            try {
              let url, options;
              
              if (action === 'accept') {
                url = '/admin/accept/' + appId;
                options = {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include'
                };
              } else if (action === 'reject') {
                const reason = document.getElementById('rejectReason').value;
                url = '/admin/reject/' + appId;
                options = {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ reason: reason })
                };
                closeRejectModal();
              }
              
              const response = await fetch(url, options);
              const result = await response.json();
              
              console.log('Action result:', result);
              
              if (response.ok) {
                // Remove success/error messages if they exist
                const existingMessage = appCard.querySelector('.success-message, .error-message');
                if (existingMessage) existingMessage.remove();
                
                // Create success message
                const messageDiv = document.createElement('div');
                messageDiv.className = result.success ? 'success-message' : 'error-message';
                
                if (action === 'accept') {
                  if (result.success) {
                    messageDiv.innerHTML = \`
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-check-circle" style="color: #3ba55c; font-size: 20px;"></i>
                        <div>
                          <strong style="color: #3ba55c;">✓ Application Accepted!</strong><br>
                          <small>Role assigned: \${result.roleAssigned ? '✅' : '❌'} | DM sent: \${result.dmSent ? '✅' : '❌'}</small>
                        </div>
                      </div>
                    \`;
                  } else {
                    messageDiv.innerHTML = \`
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-exclamation-triangle" style="color: #ed4245; font-size: 20px;"></i>
                        <div>
                          <strong style="color: #ed4245;">✗ Failed to accept</strong><br>
                          <small>\${result.error || 'Unknown error'}</small>
                        </div>
                      </div>
                    \`;
                    
                    // Re-enable buttons on error
                    setTimeout(() => {
                      buttons.forEach(btn => {
                        btn.disabled = false;
                        if (btn.classList.contains('accept-btn')) {
                          btn.innerHTML = '<i class="fas fa-check"></i> Accept & Assign Role';
                        } else if (btn.classList.contains('reject-btn')) {
                          btn.innerHTML = '<i class="fas fa-times"></i> Reject';
                        }
                      });
                    }, 3000);
                  }
                } else if (action === 'reject') {
                  if (result.success) {
                    messageDiv.innerHTML = \`
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-check-circle" style="color: #3ba55c; font-size: 20px;"></i>
                        <div>
                          <strong style="color: #3ba55c;">✓ Application Rejected!</strong><br>
                          <small>Rejection DM sent: \${result.dmSent ? '✅' : '❌'}</small>
                        </div>
                      </div>
                    \`;
                  } else {
                    messageDiv.innerHTML = \`
                      <div style="display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-exclamation-triangle" style="color: #ed4245; font-size: 20px;"></i>
                        <div>
                          <strong style="color: #ed4245;">✗ Failed to reject</strong><br>
                          <small>\${result.error || 'Unknown error'}</small>
                        </div>
                      </div>
                    \`;
                  }
                }
                
                appCard.appendChild(messageDiv);
                
                // If success, remove card from DOM and refresh tab counts after delay
                if (result.success) {
                  setTimeout(() => {
                    appCard.remove();
                    // Refresh the page to update counts and tabs
                    location.reload();
                  }, 2000);
                }
                
              } else {
                throw new Error(result.message || 'Failed to process application');
              }
              
            } catch (error) {
              console.error('Action failed:', error);
              
              const existingMessage = appCard.querySelector('.success-message, .error-message');
              if (existingMessage) existingMessage.remove();
              
              const errorDiv = document.createElement('div');
              errorDiv.className = 'error-message';
              errorDiv.innerHTML = \`
                <div style="display: flex; align-items: center; gap: 10px;">
                  <i class="fas fa-exclamation-triangle" style="color: #ed4245; font-size: 20px;"></i>
                  <div>
                    <strong style="color: #ed4245;">✗ Error</strong><br>
                    <small>\${error.message}</small>
                  </div>
                </div>
              \`;
              
              appCard.appendChild(errorDiv);
              
              // Re-enable buttons on error
              setTimeout(() => {
                buttons.forEach(btn => {
                  btn.disabled = false;
                  if (btn.classList.contains('accept-btn')) {
                    btn.innerHTML = '<i class="fas fa-check"></i> Accept & Assign Role';
                  } else if (btn.classList.contains('reject-btn')) {
                    btn.innerHTML = '<i class="fas fa-times"></i> Reject';
                  }
                });
              }, 3000);
            }
          }
          
          // Confirm rejection
          document.getElementById('confirmReject').addEventListener('click', function() {
            if (currentAppId) {
              processApplication(currentAppId, 'reject', currentAppUsername);
            }
          });
          
          // Close modal on escape key
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              closeRejectModal();
            }
          });
          
          // Auto-refresh bot status every 30 seconds
          setInterval(() => {
            fetch('/debug/bot').then(r => r.json()).then(data => {
              const botStatus = document.querySelector('.status-value');
              if (botStatus) {
                if (data.isReady) {
                  botStatus.textContent = '✅ Connected';
                  botStatus.className = 'status-value status-good';
                } else {
                  botStatus.textContent = '❌ Disconnected';
                  botStatus.className = 'status-value status-bad';
                }
              }
            });
          }, 30000);
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

/* ================= ADMIN ACTIONS ENDPOINTS - FIXED REJECTION ERROR ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    console.log(`\n🔵 ========== ACCEPTING APPLICATION ${req.params.id} ==========`);
    
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }
    
    console.log(`📋 Application found:`);
    console.log(`   - Username: ${application.discord_username}`);
    console.log(`   - Discord ID: ${application.discord_id}`);
    console.log(`   - Score: ${application.score}`);
    console.log(`   - Current Status: ${application.status}`);
    
    // Check if already processed
    if (application.status !== 'pending') {
      console.log(`⚠️ Application already ${application.status}, skipping`);
      return res.json({ 
        success: true, 
        message: `Application was already ${application.status}`,
        alreadyProcessed: true,
        application: application
      });
    }
    
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
    
    console.log(`🎯 Step 1: Attempting to assign mod role...`);
    
    // Call the FIXED assignModRole function
    const roleResult = await assignModRole(application.discord_id, application.discord_username);
    
    console.log(`📊 Role assignment result:`, roleResult);
    
    // Update database based on role assignment result
    let databaseUpdateResult;
    if (roleResult.success) {
      // Role assigned successfully
      console.log(`✅ Role assignment successful, updating database...`);
      
      const { error: updateError } = await supabase
        .from("applications")
        .update({ 
          status: "accepted",
          updated_at: new Date().toISOString(),
          reviewed_by: req.session.user.username,
          reviewed_at: new Date().toISOString(),
          notes: `Role assigned: ${roleResult.details?.role || 'Mod Role'}. DM sent: ${roleResult.dmSent || false}`
        })
        .eq("id", req.params.id);
      
      databaseUpdateResult = updateError;
      
      if (updateError) {
        console.error("Database update error:", updateError);
      } else {
        console.log(`✅ Database updated successfully`);
      }
    } else {
      // Role assignment failed
      console.log(`❌ Role assignment failed, updating database with failure status...`);
      
      const { error: updateError } = await supabase
        .from("applications")
        .update({ 
          status: "accepted", // Still mark as accepted even if role assignment failed
          updated_at: new Date().toISOString(),
          reviewed_by: req.session.user.username,
          reviewed_at: new Date().toISOString(),
          notes: `ROLE ASSIGNMENT FAILED: ${roleResult.error || 'Unknown error'}`
        })
        .eq("id", req.params.id);
      
      databaseUpdateResult = updateError;
      
      if (updateError) {
        console.error("Database update error:", updateError);
      }
    }
    
    // Send webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embedColor = roleResult.success ? 0x3ba55c : 0xf59e0b;
        const embedTitle = roleResult.success 
          ? "✅ APPLICATION ACCEPTED & ROLE ASSIGNED" 
          : "⚠️ APPLICATION ACCEPTED - ROLE ASSIGNMENT FAILED";
        
        const embed = {
          title: embedTitle,
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Accepted by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: ACCEPTED\nRole Assignment: ${roleResult.success ? "SUCCESS" : "FAILED"}\nError: ${roleResult.error || "None"}\nDM Sent: ${roleResult.dmSent ? "YES" : "NO"}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
              inline: false
            }
          ],
          color: embedColor,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Admin Action"
          }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System"
        });
        console.log(`✅ Webhook notification sent`);
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    // Return appropriate response
    if (roleResult.success) {
      res.json({ 
        success: true, 
        message: "Application accepted and role assigned successfully!",
        roleAssigned: true,
        dmSent: roleResult.dmSent || false,
        application: {
          id: application.id,
          username: application.discord_username,
          score: application.score,
          role: roleResult.details?.role || 'Mod Role'
        }
      });
    } else {
      res.json({ 
        success: false, 
        message: "Application accepted but role assignment failed",
        error: roleResult.error || "Unknown error",
        roleAssigned: false,
        dmSent: false,
        application: {
          id: application.id,
          username: application.discord_username,
          score: application.score
        }
      });
    }
    
    console.log(`✅ ========== APPLICATION ${req.params.id} PROCESSING COMPLETE ==========\n`);
    
  } catch (err) {
    console.error("❌ CRITICAL ERROR in accept endpoint:", err.message);
    console.error("Stack trace:", err.stack);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      message: "Failed to process acceptance"
    });
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  try {
    console.log(`\n🔴 ========== REJECTING APPLICATION ${req.params.id} ==========`);
    
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }
    
    console.log(`📋 Application found:`);
    console.log(`   - Username: ${application.discord_username}`);
    console.log(`   - Discord ID: ${application.discord_id}`);
    console.log(`   - Score: ${application.score}`);
    console.log(`   - Current Status: ${application.status}`);
    
    // Check if already processed
    if (application.status !== 'pending') {
      console.log(`⚠️ Application already ${application.status}, skipping`);
      return res.json({ 
        success: true, 
        message: `Application was already ${application.status}`,
        alreadyProcessed: true,
        application: application
      });
    }
    
    const reason = req.body.reason || "Insufficient test score or incomplete application";
    
    // Check if user is a test user
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000' || id.length < 5;
    
    // Send rejection DM (skip for test users)
    let dmSent = false;
    if (!isTestUser) {
      console.log(`📨 Step 1: Sending rejection DM to ${application.discord_username}...`);
      dmSent = await sendRejectionDM(application.discord_id, application.discord_username, reason);
      console.log(`✅ Rejection DM ${dmSent ? 'sent successfully' : 'failed to send'}`);
    } else {
      console.log(`⚠️ Skipping DM for test user: ${application.discord_username}`);
    }
    
    // Update database
    console.log(`💾 Step 2: Updating database...`);
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
    
    if (updateError) {
      console.error("Database update error:", updateError);
      throw updateError;
    }
    
    console.log(`✅ Database updated successfully`);
    
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
          username: "Admin System"
        });
        console.log(`✅ Webhook notification sent`);
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    console.log(`✅ ========== APPLICATION ${req.params.id} REJECTED SUCCESSFULLY ==========\n`);
    
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
    console.error("❌ Reject error:", err.message);
    console.error("Stack trace:", err.stack);
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
║                VOID ESPORTS MOD TEST SERVER v2.2                    ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${PORT}                                  ║
║ 🤖 Discord Bot: ${botReady ? "✅ Connected" : "🔄 Connecting..."}   ║
║ 📝 ADMIN FEATURES:                                                   ║
║    • ✅ Advanced Admin Portal with Tabs                             ║
║    • ✅ Auto-filtering by status                                    ║
║    • ✅ Fixed Rejection Error Handling                              ║
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
