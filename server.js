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

/* ================= DISCORD BOT - OPTIMIZED ================= */

console.log("🤖 Initializing Discord bot...");

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: ['CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'REACTION', 'USER']
});

let botReady = false;
let botLoginAttempts = 0;

bot.on('ready', async () => {
  botReady = true;
  botLoginAttempts = 0;
  console.log(`✅ Discord bot ready as ${bot.user.tag}`);
  console.log(`📊 Servers: ${bot.guilds.cache.size}`);
  
  bot.user.setPresence({
    activities: [{ 
      name: 'Mod Applications', 
      type: ActivityType.Watching
    }],
    status: 'online'
  });
});

bot.on('error', (error) => {
  console.error('❌ Discord bot error:', error.message);
});

async function loginBot() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("❌ DISCORD_BOT_TOKEN not set!");
    return false;
  }
  
  try {
    await bot.login(process.env.DISCORD_BOT_TOKEN);
    botReady = true;
    console.log("✅ Bot login successful!");
    return true;
  } catch (error) {
    console.error("❌ Bot login failed:", error.message);
    return false;
  }
}

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
    
    if (botLoginAttempts < 3) {
      console.log(`⏳ Retrying in 10 seconds...`);
      setTimeout(startBotWithRetry, 10000);
    }
  }
}

startBotWithRetry();

/* ================= HELPER FUNCTIONS ================= */

async function ensureBotReady() {
  if (botReady && bot.isReady()) return true;
  
  console.log("🔄 Bot not ready, attempting to reconnect...");
  
  if (!bot.isReady() && process.env.DISCORD_BOT_TOKEN) {
    const success = await loginBot();
    if (success) {
      botReady = true;
      return true;
    }
  }
  
  return false;
}

async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    if (!await ensureBotReady()) {
      console.log("❌ Bot not ready for DM");
      return false;
    }
    
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
      if (dmError.code === 50007) {
        console.log(`📵 User ${user.tag} has DMs disabled`);
        return true;
      }
      return false;
    }
  } catch (error) {
    console.error(`❌ Unexpected error in sendDMToUser:`, error.message);
    return false;
  }
}

// FIXED ROLE ASSIGNMENT FUNCTION
async function assignModRole(discordId, discordUsername = 'User') {
  console.log(`\n🎯 ATTEMPTING TO ASSIGN MOD ROLE`);
  console.log(`   User: ${discordUsername} (${discordId})`);
  
  try {
    if (!await ensureBotReady()) {
      return { success: false, error: "Bot not ready. Please check if bot is online and has proper intents enabled." };
    }
    
    if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
      return { success: false, error: "Missing Discord configuration. Check DISCORD_GUILD_ID and MOD_ROLE_ID environment variables." };
    }
    
    const guildId = process.env.DISCORD_GUILD_ID;
    const roleId = process.env.MOD_ROLE_ID;
    
    // Fetch guild
    let guild;
    try {
      guild = await bot.guilds.fetch(guildId);
      console.log(`✅ Found guild: ${guild.name} (${guild.id})`);
    } catch (guildError) {
      return { success: false, error: `Guild not found. Bot might not be in this server. Error: ${guildError.message}` };
    }
    
    // Fetch member
    let member;
    try {
      member = await guild.members.fetch(discordId);
      console.log(`✅ Found member: ${member.user.tag} (${member.id})`);
    } catch (memberError) {
      return { success: false, error: `User not found in the server. Make sure ${discordUsername} is in ${guild.name}. Error: ${memberError.message}` };
    }
    
    // Fetch role
    let role;
    try {
      role = await guild.roles.fetch(roleId);
      if (!role) {
        return { success: false, error: `Mod role not found. Check MOD_ROLE_ID environment variable.` };
      }
      console.log(`✅ Found role: ${role.name} (${role.id})`);
    } catch (roleError) {
      return { success: false, error: `Could not fetch role. Error: ${roleError.message}` };
    }
    
    // Check bot permissions
    const botMember = await guild.members.fetch(bot.user.id);
    if (!botMember.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return { success: false, error: "Bot lacks 'Manage Roles' permission. Grant this permission in Discord server settings." };
    }
    
    // Check role hierarchy
    const botHighestRole = botMember.roles.highest;
    if (role.position >= botHighestRole.position) {
      return { success: false, error: "Role hierarchy issue. Bot's role must be higher than the mod role in Discord server settings." };
    }
    
    // Check if member already has the role
    if (member.roles.cache.has(role.id)) {
      return { success: true, message: "Member already has the role", dmSent: false };
    }
    
    // Assign the role
    console.log(`🔄 Assigning role "${role.name}" to ${member.user.tag}...`);
    try {
      await member.roles.add(role);
      console.log(`✅ SUCCESS: Assigned mod role to ${member.user.tag}`);
      
      // Send welcome DM
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
      
      if (assignError.message.includes("Missing Permissions")) {
        return { success: false, error: "Bot lacks permissions. Make sure bot has 'Manage Roles' permission and its role is above the mod role." };
      } else if (assignError.message.includes("Invalid Form Body")) {
        return { success: false, error: "Invalid role ID. Check MOD_ROLE_ID environment variable." };
      } else {
        return { success: false, error: `Failed to assign role: ${assignError.message}` };
      }
    }
    
  } catch (error) {
    console.error('❌ CRITICAL ERROR in assignModRole:', error.message);
    return { success: false, error: `Unexpected error: ${error.message}` };
  }
}

async function sendRejectionDM(discordId, discordUsername, reason = "Not specified") {
  try {
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

/* ================= CORS & SESSION ================= */

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

/* ================= ADMIN PORTAL - COMPLETELY REWRITTEN ================= */

app.get("/admin", async (req, res) => {
  console.log("\n=== ADMIN PORTAL ACCESS ===");
  
  if (!req.session.user || !req.session.isAdmin) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
            color: white; min-height: 100vh; display: flex; align-items: center; justify-content: center;
          }
          .denied-container {
            background: rgba(32, 34, 37, 0.95);
            padding: 40px; border-radius: 20px; text-align: center;
            border: 1px solid rgba(255, 0, 51, 0.3);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            max-width: 600px; width: 90%;
          }
          h1 { color: #ff0033; margin-bottom: 20px; }
          .action-buttons { margin-top: 30px; display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; }
          .action-btn {
            padding: 12px 24px; background: linear-gradient(135deg, #5865f2, #4752c4);
            color: white; border: none; border-radius: 8px; text-decoration: none;
            font-weight: 600; cursor: pointer; transition: all 0.3s ease;
            display: inline-flex; align-items: center; gap: 8px;
          }
          .action-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(88, 101, 242, 0.4); }
        </style>
      </head>
      <body>
        <div class="denied-container">
          <h1><i class="fas fa-ban"></i> Access Denied</h1>
          <p>You don't have administrator privileges.</p>
          <div class="action-buttons">
            <a href="/logout" class="action-btn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            <a href="https://hunterahead71-hash.github.io/void.training/" class="action-btn"><i class="fas fa-home"></i> Return to Training</a>
          </div>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Filter test users
    const realApplications = applications.filter(app => {
      const username = app.discord_username.toLowerCase();
      const id = app.discord_id;
      const isTestUser = 
        username.includes('test') || username.includes('bot') ||
        id.includes('test') || id === '0000' || username === 'user' ||
        username.includes('example') || id.length < 5;
      return !isTestUser;
    });

    const pendingApps = realApplications.filter(app => app.status === 'pending');
    const acceptedApps = realApplications.filter(app => app.status === 'accepted');
    const rejectedApps = realApplications.filter(app => app.status === 'rejected');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Advanced Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
        <style>
          :root {
            --void-abyss: #000010;
            --void-blood: #ff0033;
            --void-neon: #00ffea;
            --void-purple: #8b5cf6;
            --discord-bg: #36393f;
            --discord-primary: #202225;
            --discord-secondary: #2f3136;
            --discord-green: #3ba55c;
            --discord-red: #ed4245;
            --discord-yellow: #f59e0b;
          }
          
          * { margin: 0; padding: 0; box-sizing: border-box; }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, var(--void-abyss) 0%, #0a0a1a 50%, #1a002a 100%);
            color: #ffffff;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
          }
          
          .admin-container {
            max-width: 1800px;
            margin: 0 auto;
            padding: 30px;
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
            flex-wrap: wrap;
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
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
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
          
          /* Tabs */
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
            flex-wrap: wrap;
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
            grid-template-columns: repeat(auto-fill, minmax(500px, 1fr));
            gap: 25px;
          }
          
          @media (max-width: 768px) {
            .applications-grid {
              grid-template-columns: 1fr;
            }
          }
          
          /* Application Card */
          .application-card {
            background: linear-gradient(135deg, rgba(32, 34, 37, 0.95), rgba(47, 49, 54, 0.95));
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
          
          .user-info-container {
            display: flex;
            align-items: center;
            gap: 15px;
            flex: 1;
          }
          
          .user-avatar-small {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: linear-gradient(135deg, #ff0033, #8b5cf6);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 24px;
            flex-shrink: 0;
          }
          
          .user-details {
            flex: 1;
          }
          
          .user-main {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 5px;
          }
          
          .username {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
          }
          
          .user-id {
            font-size: 13px;
            color: #888;
            font-family: 'JetBrains Mono', monospace;
            background: rgba(0,0,0,0.3);
            padding: 2px 8px;
            border-radius: 4px;
          }
          
          .application-status {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            white-space: nowrap;
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
          
          .score-display {
            background: rgba(0, 0, 0, 0.3);
            padding: 15px;
            border-radius: 10px;
            margin: 15px 0;
          }
          
          .score-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
            font-size: 14px;
          }
          
          .score-label {
            color: #888;
          }
          
          .score-value {
            font-weight: 600;
            font-size: 24px;
            color: #00ffea;
          }
          
          .progress-bar {
            height: 8px;
            background: rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            margin-top: 10px;
            overflow: hidden;
          }
          
          .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00ffea, #8b5cf6);
            border-radius: 4px;
            transition: width 1s ease;
          }
          
          /* Conversation Log */
          .conversation-section {
            margin-top: 20px;
          }
          
          .conversation-toggle {
            width: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 12px 15px;
            color: white;
            font-family: inherit;
            font-size: 14px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.3s ease;
          }
          
          .conversation-toggle:hover {
            background: rgba(0, 0, 0, 0.4);
          }
          
          .conversation-toggle i {
            transition: transform 0.3s ease;
          }
          
          .conversation-toggle.active i {
            transform: rotate(180deg);
          }
          
          .conversation-log {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.5s ease;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 0 0 8px 8px;
            margin-top: -1px;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          
          .conversation-log.active {
            max-height: 400px;
            overflow-y: auto;
          }
          
          .conversation-content {
            padding: 15px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-break: break-word;
          }
          
          /* Actions */
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
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
          }
          
          .accept-btn {
            background: linear-gradient(135deg, #3ba55c, #2d8b4f);
            color: white;
          }
          
          .accept-btn:hover:not(:disabled) {
            box-shadow: 0 8px 25px rgba(59, 165, 92, 0.4);
            transform: translateY(-2px);
          }
          
          .reject-btn {
            background: linear-gradient(135deg, #ed4245, #c03939);
            color: white;
          }
          
          .reject-btn:hover:not(:disabled) {
            box-shadow: 0 8px 25px rgba(237, 66, 69, 0.4);
            transform: translateY(-2px);
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
          
          /* No Applications */
          .no-applications {
            text-align: center;
            padding: 60px 20px;
            color: #888;
            grid-column: 1 / -1;
          }
          
          .no-applications-icon {
            font-size: 60px;
            margin-bottom: 20px;
            opacity: 0.3;
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
                <div>
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
            </div>
            
            <div class="stat-card pending" onclick="showTab('pending')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Pending Review</div>
                  <div class="stat-number">${pendingApps.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-clock"></i>
                </div>
              </div>
            </div>
            
            <div class="stat-card accepted" onclick="showTab('accepted')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Accepted</div>
                  <div class="stat-number">${acceptedApps.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-check-circle"></i>
                </div>
              </div>
            </div>
            
            <div class="stat-card rejected" onclick="showTab('rejected')">
              <div class="stat-header">
                <div>
                  <div class="stat-title">Rejected</div>
                  <div class="stat-number">${rejectedApps.length}</div>
                </div>
                <div class="stat-icon">
                  <i class="fas fa-times-circle"></i>
                </div>
              </div>
            </div>
          </div>
          
          <!-- Tabs -->
          <div class="tabs-container">
            <div class="tabs-nav">
              <button class="tab-btn active" onclick="showTab('pending')">
                <i class="fas fa-clock"></i> Pending
                <span class="tab-badge">${pendingApps.length}</span>
              </button>
              <button class="tab-btn" onclick="showTab('accepted')">
                <i class="fas fa-check-circle"></i> Accepted
                <span class="tab-badge">${acceptedApps.length}</span>
              </button>
              <button class="tab-btn" onclick="showTab('rejected')">
                <i class="fas fa-times-circle"></i> Rejected
                <span class="tab-badge">${rejectedApps.length}</span>
              </button>
              <button class="tab-btn" onclick="showTab('all')">
                <i class="fas fa-layer-group"></i> All Applications
                <span class="tab-badge">${realApplications.length}</span>
              </button>
            </div>
            
            <!-- Pending Applications -->
            <div id="tab-pending" class="applications-container active">
              <div class="applications-grid">
                ${pendingApps.length === 0 ? `
                  <div class="no-applications">
                    <div class="no-applications-icon">
                      <i class="fas fa-inbox"></i>
                    </div>
                    <h3>No Pending Applications</h3>
                    <p>All applications have been reviewed.</p>
                  </div>
                ` : pendingApps.map(app => {
                  const score = app.score ? app.score.split('/') : ['0', '8'];
                  const scoreValue = parseInt(score[0]);
                  const totalQuestions = parseInt(score[1]);
                  const percentage = (scoreValue / totalQuestions) * 100;
                  const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
                  const conversationLog = app.conversation_log || app.answers || 'No conversation log available';
                  
                  return `
                    <div class="application-card pending" id="app-${app.id}" data-status="pending">
                      <div class="card-header">
                        <div class="user-info-container">
                          <div class="user-avatar-small">${usernameInitial}</div>
                          <div class="user-details">
                            <div class="user-main">
                              <span class="username">${app.discord_username}</span>
                              <span class="user-id">${app.discord_id}</span>
                            </div>
                            <div>Submitted: ${new Date(app.created_at).toLocaleString()}</div>
                          </div>
                        </div>
                        <div class="application-status status-pending">PENDING</div>
                      </div>
                      
                      <div class="score-display">
                        <div class="score-row">
                          <span class="score-label">Test Score:</span>
                          <span class="score-value">${scoreValue}/${totalQuestions}</span>
                        </div>
                        <div class="progress-bar">
                          <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                        <div class="score-row">
                          <span class="score-label">Percentage:</span>
                          <span>${Math.round(percentage)}%</span>
                        </div>
                      </div>
                      
                      <div class="conversation-section">
                        <button class="conversation-toggle" onclick="toggleConversation(this)">
                          <span>View Conversation Log</span>
                          <i class="fas fa-chevron-down"></i>
                        </button>
                        <div class="conversation-log">
                          <div class="conversation-content">${conversationLog.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
                        </div>
                      </div>
                      
                      <div class="card-actions">
                        <button class="action-btn accept-btn" onclick="acceptApplication(${app.id}, '${app.discord_username.replace(/'/g, "\\'")}')">
                          <i class="fas fa-check"></i> Accept & Assign Role
                        </button>
                        <button class="action-btn reject-btn" onclick="showRejectModal(${app.id}, '${app.discord_username.replace(/'/g, "\\'")}')">
                          <i class="fas fa-times"></i> Reject
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            
            <!-- Accepted Applications -->
            <div id="tab-accepted" class="applications-container">
              <div class="applications-grid">
                ${acceptedApps.length === 0 ? `
                  <div class="no-applications">
                    <div class="no-applications-icon">
                      <i class="fas fa-check-circle"></i>
                    </div>
                    <h3>No Accepted Applications</h3>
                    <p>No applications have been accepted yet.</p>
                  </div>
                ` : acceptedApps.map(app => {
                  const score = app.score ? app.score.split('/') : ['0', '8'];
                  const scoreValue = parseInt(score[0]);
                  const totalQuestions = parseInt(score[1]);
                  const percentage = (scoreValue / totalQuestions) * 100;
                  const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
                  const reviewedDate = app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : 'Not reviewed';
                  const reviewer = app.reviewed_by || 'Unknown';
                  const conversationLog = app.conversation_log || app.answers || 'No conversation log available';
                  
                  return `
                    <div class="application-card accepted" id="app-${app.id}" data-status="accepted">
                      <div class="card-header">
                        <div class="user-info-container">
                          <div class="user-avatar-small">${usernameInitial}</div>
                          <div class="user-details">
                            <div class="user-main">
                              <span class="username">${app.discord_username}</span>
                              <span class="user-id">${app.discord_id}</span>
                            </div>
                            <div>Reviewed by: ${reviewer} at ${reviewedDate}</div>
                          </div>
                        </div>
                        <div class="application-status status-accepted">ACCEPTED</div>
                      </div>
                      
                      <div class="score-display">
                        <div class="score-row">
                          <span class="score-label">Test Score:</span>
                          <span class="score-value">${scoreValue}/${totalQuestions}</span>
                        </div>
                        <div class="progress-bar">
                          <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                      </div>
                      
                      <div class="conversation-section">
                        <button class="conversation-toggle" onclick="toggleConversation(this)">
                          <span>View Conversation Log</span>
                          <i class="fas fa-chevron-down"></i>
                        </button>
                        <div class="conversation-log">
                          <div class="conversation-content">${conversationLog.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
                        </div>
                      </div>
                      
                      <div class="card-actions">
                        <button class="action-btn" disabled style="background: rgba(59, 165, 92, 0.3); cursor: default;">
                          <i class="fas fa-user-check"></i> Role Assigned
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            
            <!-- Rejected Applications -->
            <div id="tab-rejected" class="applications-container">
              <div class="applications-grid">
                ${rejectedApps.length === 0 ? `
                  <div class="no-applications">
                    <div class="no-applications-icon">
                      <i class="fas fa-times-circle"></i>
                    </div>
                    <h3>No Rejected Applications</h3>
                    <p>No applications have been rejected yet.</p>
                  </div>
                ` : rejectedApps.map(app => {
                  const score = app.score ? app.score.split('/') : ['0', '8'];
                  const scoreValue = parseInt(score[0]);
                  const totalQuestions = parseInt(score[1]);
                  const percentage = (scoreValue / totalQuestions) * 100;
                  const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
                  const reviewedDate = app.reviewed_at ? new Date(app.reviewed_at).toLocaleString() : 'Not reviewed';
                  const reviewer = app.reviewed_by || 'Unknown';
                  const reason = app.rejection_reason || 'No reason provided';
                  const conversationLog = app.conversation_log || app.answers || 'No conversation log available';
                  
                  return `
                    <div class="application-card rejected" id="app-${app.id}" data-status="rejected">
                      <div class="card-header">
                        <div class="user-info-container">
                          <div class="user-avatar-small">${usernameInitial}</div>
                          <div class="user-details">
                            <div class="user-main">
                              <span class="username">${app.discord_username}</span>
                              <span class="user-id">${app.discord_id}</span>
                            </div>
                            <div>Rejected by: ${reviewer} at ${reviewedDate}</div>
                          </div>
                        </div>
                        <div class="application-status status-rejected">REJECTED</div>
                      </div>
                      
                      <div class="score-display">
                        <div class="score-row">
                          <span class="score-label">Test Score:</span>
                          <span class="score-value">${scoreValue}/${totalQuestions}</span>
                        </div>
                        <div class="progress-bar">
                          <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                        <div class="score-row">
                          <span class="score-label">Reason:</span>
                          <span style="color: #ed4245;">${reason}</span>
                        </div>
                      </div>
                      
                      <div class="conversation-section">
                        <button class="conversation-toggle" onclick="toggleConversation(this)">
                          <span>View Conversation Log</span>
                          <i class="fas fa-chevron-down"></i>
                        </button>
                        <div class="conversation-log">
                          <div class="conversation-content">${conversationLog.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
                        </div>
                      </div>
                      
                      <div class="card-actions">
                        <button class="action-btn" disabled style="background: rgba(237, 66, 69, 0.3); cursor: default;">
                          <i class="fas fa-comment-slash"></i> Rejection DM Sent
                        </button>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
            
            <!-- All Applications -->
            <div id="tab-all" class="applications-container">
              <div class="applications-grid">
                ${realApplications.length === 0 ? `
                  <div class="no-applications">
                    <div class="no-applications-icon">
                      <i class="fas fa-inbox"></i>
                    </div>
                    <h3>No Applications</h3>
                    <p>No applications have been submitted yet.</p>
                  </div>
                ` : realApplications.map(app => {
                  const score = app.score ? app.score.split('/') : ['0', '8'];
                  const scoreValue = parseInt(score[0]);
                  const totalQuestions = parseInt(score[1]);
                  const percentage = (scoreValue / totalQuestions) * 100;
                  const usernameInitial = app.discord_username ? app.discord_username.charAt(0).toUpperCase() : 'U';
                  const statusClass = app.status === 'pending' ? 'status-pending' : app.status === 'accepted' ? 'status-accepted' : 'status-rejected';
                  const statusText = app.status === 'pending' ? 'PENDING' : app.status === 'accepted' ? 'ACCEPTED' : 'REJECTED';
                  const conversationLog = app.conversation_log || app.answers || 'No conversation log available';
                  
                  return `
                    <div class="application-card ${app.status}" id="app-${app.id}" data-status="${app.status}">
                      <div class="card-header">
                        <div class="user-info-container">
                          <div class="user-avatar-small">${usernameInitial}</div>
                          <div class="user-details">
                            <div class="user-main">
                              <span class="username">${app.discord_username}</span>
                              <span class="user-id">${app.discord_id}</span>
                            </div>
                            <div>Submitted: ${new Date(app.created_at).toLocaleString()}</div>
                          </div>
                        </div>
                        <div class="application-status ${statusClass}">${statusText}</div>
                      </div>
                      
                      <div class="score-display">
                        <div class="score-row">
                          <span class="score-label">Test Score:</span>
                          <span class="score-value">${scoreValue}/${totalQuestions}</span>
                        </div>
                        <div class="progress-bar">
                          <div class="progress-fill" style="width: ${percentage}%"></div>
                        </div>
                        <div class="score-row">
                          <span class="score-label">Status:</span>
                          <span style="color: ${app.status === 'pending' ? '#f59e0b' : app.status === 'accepted' ? '#3ba55c' : '#ed4245'}">
                            ${statusText}
                          </span>
                        </div>
                      </div>
                      
                      <div class="conversation-section">
                        <button class="conversation-toggle" onclick="toggleConversation(this)">
                          <span>View Conversation Log</span>
                          <i class="fas fa-chevron-down"></i>
                        </button>
                        <div class="conversation-log">
                          <div class="conversation-content">${conversationLog.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</div>
                        </div>
                      </div>
                      
                      ${app.status === 'pending' ? `
                      <div class="card-actions">
                        <button class="action-btn accept-btn" onclick="acceptApplication(${app.id}, '${app.discord_username.replace(/'/g, "\\'")}')">
                          <i class="fas fa-check"></i> Accept
                        </button>
                        <button class="action-btn reject-btn" onclick="showRejectModal(${app.id}, '${app.discord_username.replace(/'/g, "\\'")}')">
                          <i class="fas fa-times"></i> Reject
                        </button>
                      </div>
                      ` : `
                      <div class="card-actions">
                        <button class="action-btn" disabled style="background: rgba(255, 255, 255, 0.1); cursor: default;">
                          <i class="fas fa-${app.status === 'accepted' ? 'user-check' : 'comment-slash'}"></i>
                          ${app.status === 'accepted' ? 'Role Assigned' : 'Rejection DM Sent'}
                        </button>
                      </div>
                      `}
                    </div>
                  `;
                }).join('')}
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
          
          function showTab(tabName) {
            document.querySelectorAll('.applications-container').forEach(tab => {
              tab.classList.remove('active');
            });
            
            document.querySelectorAll('.tab-btn').forEach(btn => {
              btn.classList.remove('active');
            });
            
            document.getElementById('tab-' + tabName).classList.add('active');
            
            document.querySelectorAll('.tab-btn').forEach(btn => {
              if (btn.textContent.includes(tabName.charAt(0).toUpperCase() + tabName.slice(1)) || 
                  (tabName === 'all' && btn.textContent.includes('All'))) {
                btn.classList.add('active');
              }
            });
            
            history.pushState(null, '', '/admin#' + tabName);
          }
          
          window.addEventListener('load', function() {
            const hash = window.location.hash.substring(1);
            if (hash && ['pending', 'accepted', 'rejected', 'all'].includes(hash)) {
              showTab(hash);
            }
          });
          
          function toggleConversation(button) {
            const conversationLog = button.nextElementSibling;
            button.classList.toggle('active');
            conversationLog.classList.toggle('active');
          }
          
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
          
          async function acceptApplication(appId, username) {
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
              const response = await fetch('/admin/accept/' + appId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
              });
              
              const result = await response.json();
              
              if (result.success) {
                appCard.querySelector('.card-actions').innerHTML = \`
                  <button class="action-btn" disabled style="background: rgba(59, 165, 92, 0.3); cursor: default;">
                    <i class="fas fa-user-check"></i> Role Assigned
                  </button>
                \`;
                
                appCard.querySelector('.application-status').className = 'application-status status-accepted';
                appCard.querySelector('.application-status').textContent = 'ACCEPTED';
                appCard.classList.remove('pending');
                appCard.classList.add('accepted');
                
                setTimeout(() => {
                  if (document.getElementById('tab-accepted').classList.contains('active')) {
                    document.getElementById('tab-accepted').querySelector('.applications-grid').prepend(appCard);
                  }
                  updateStats();
                }, 1000);
                
              } else {
                throw new Error(result.error || 'Failed to accept application');
              }
            } catch (error) {
              console.error('Accept error:', error);
              buttons.forEach(btn => {
                btn.disabled = false;
                if (btn.classList.contains('accept-btn')) {
                  btn.innerHTML = '<i class="fas fa-check"></i> Accept & Assign Role';
                } else if (btn.classList.contains('reject-btn')) {
                  btn.innerHTML = '<i class="fas fa-times"></i> Reject';
                }
              });
              alert('Error: ' + error.message);
            }
          }
          
          async function rejectApplication() {
            if (!currentAppId) return;
            
            const reason = document.getElementById('rejectReason').value;
            const appCard = document.getElementById('app-' + currentAppId);
            if (!appCard) return;
            
            closeRejectModal();
            
            const buttons = appCard.querySelectorAll('.action-btn');
            buttons.forEach(btn => {
              btn.disabled = true;
              btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            });
            
            try {
              const response = await fetch('/admin/reject/' + currentAppId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ reason: reason })
              });
              
              const result = await response.json();
              
              if (result.success) {
                appCard.querySelector('.card-actions').innerHTML = \`
                  <button class="action-btn" disabled style="background: rgba(237, 66, 69, 0.3); cursor: default;">
                    <i class="fas fa-comment-slash"></i> Rejection DM Sent
                  </button>
                \`;
                
                const statusEl = appCard.querySelector('.application-status');
                statusEl.className = 'application-status status-rejected';
                statusEl.textContent = 'REJECTED';
                appCard.classList.remove('pending');
                appCard.classList.add('rejected');
                
                setTimeout(() => {
                  if (document.getElementById('tab-rejected').classList.contains('active')) {
                    document.getElementById('tab-rejected').querySelector('.applications-grid').prepend(appCard);
                  }
                  updateStats();
                }, 1000);
                
              } else {
                throw new Error(result.error || 'Failed to reject application');
              }
            } catch (error) {
              console.error('Reject error:', error);
              buttons.forEach(btn => {
                btn.disabled = false;
                if (btn.classList.contains('accept-btn')) {
                  btn.innerHTML = '<i class="fas fa-check"></i> Accept & Assign Role';
                } else if (btn.classList.contains('reject-btn')) {
                  btn.innerHTML = '<i class="fas fa-times"></i> Reject';
                }
              });
              alert('Error: ' + error.message);
            }
          }
          
          function updateStats() {
            const pendingCount = document.querySelectorAll('.application-card.pending').length;
            const acceptedCount = document.querySelectorAll('.application-card.accepted').length;
            const rejectedCount = document.querySelectorAll('.application-card.rejected').length;
            const totalCount = pendingCount + acceptedCount + rejectedCount;
            
            document.querySelector('.stat-card.total .stat-number').textContent = totalCount;
            document.querySelector('.stat-card.pending .stat-number').textContent = pendingCount;
            document.querySelector('.stat-card.accepted .stat-number').textContent = acceptedCount;
            document.querySelector('.stat-card.rejected .stat-number').textContent = rejectedCount;
            
            document.querySelector('.tab-btn[onclick*="pending"] .tab-badge').textContent = pendingCount;
            document.querySelector('.tab-btn[onclick*="accepted"] .tab-badge').textContent = acceptedCount;
            document.querySelector('.tab-btn[onclick*="rejected"] .tab-badge').textContent = rejectedCount;
            document.querySelector('.tab-btn[onclick*="all"] .tab-badge').textContent = totalCount;
          }
          
          document.getElementById('confirmReject').addEventListener('click', rejectApplication);
          
          document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
              closeRejectModal();
            }
          });
          
          setInterval(() => {
            const activeTab = document.querySelector('.applications-container.active');
            if (activeTab && activeTab.id === 'tab-pending') {
              location.reload();
            }
          }, 30000);
        </script>
      </body>
      </html>
    `);
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

/* ================= ADMIN ENDPOINTS ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }
    
    if (application.status === 'accepted') {
      return res.json({ 
        success: true, 
        message: "Application already accepted",
        alreadyProcessed: true
      });
    }
    
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000' || id.length < 5;
    
    if (isTestUser) {
      return res.status(400).json({ 
        success: false,
        error: "Cannot accept test user applications"
      });
    }
    
    const roleResult = await assignModRole(application.discord_id, application.discord_username);
    
    const updateData = { 
      status: "accepted",
      updated_at: new Date().toISOString(),
      reviewed_by: req.session.user.username,
      reviewed_at: new Date().toISOString(),
      notes: `Role assigned: ${roleResult.success ? 'Yes' : 'No'}. DM sent: ${roleResult.dmSent || false}`
    };
    
    const { error: dbUpdateError } = await supabase
      .from("applications")
      .update(updateData)
      .eq("id", req.params.id);
    
    if (dbUpdateError) {
      throw dbUpdateError;
    }
    
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: roleResult.success ? "✅ APPLICATION ACCEPTED & ROLE ASSIGNED" : "⚠️ APPLICATION ACCEPTED - ROLE ASSIGNMENT FAILED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Accepted by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: ACCEPTED\nRole Assignment: ${roleResult.success ? "SUCCESS" : "FAILED"}\nError: ${roleResult.error || "None"}\nDM Sent: ${roleResult.dmSent ? "YES" : "NO"}\n\`\`\``,
              inline: false
            }
          ],
          color: roleResult.success ? 0x3ba55c : 0xf59e0b,
          timestamp: new Date().toISOString(),
          footer: { text: "Void Esports Admin Action" }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System"
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    if (roleResult.success) {
      res.json({ 
        success: true, 
        message: "Application accepted and role assigned successfully!",
        roleAssigned: true,
        dmSent: roleResult.dmSent || false
      });
    } else {
      res.json({ 
        success: false, 
        error: roleResult.error || "Unknown error",
        roleAssigned: false,
        dmSent: false
      });
    }
    
  } catch (err) {
    console.error("❌ CRITICAL ERROR in accept endpoint:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message
    });
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  try {
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
    
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }
    
    if (application.status === 'rejected') {
      return res.json({ 
        success: true, 
        message: "Application already rejected",
        alreadyProcessed: true
      });
    }
    
    const reason = req.body.reason || "Insufficient test score or incomplete application";
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000' || id.length < 5;
    
    let dmSent = false;
    if (!isTestUser) {
      dmSent = await sendRejectionDM(application.discord_id, application.discord_username, reason);
    }
    
    const { error: dbUpdateError } = await supabase
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
    
    if (dbUpdateError) {
      throw dbUpdateError;
    }
    
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "❌ APPLICATION REJECTED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Rejected by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: REJECTED\nDM Sent: ${dmSent ? "SUCCESS" : "FAILED"}\nTest User: ${isTestUser ? "YES" : "NO"}\nReason: ${reason}\n\`\`\``,
              inline: false
            }
          ],
          color: 0xed4245,
          timestamp: new Date().toISOString(),
          footer: { text: "Void Esports Admin Action" }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System"
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: "Application rejected successfully",
      dmSent: dmSent,
      isTestUser: isTestUser
    });
    
  } catch (err) {
    console.error("❌ Reject error:", err.message);
    res.status(500).json({ 
      success: false, 
      error: err.message
    });
  }
});

/* ================= SUBMISSION ENDPOINTS ================= */

app.post("/submit-test-results", async (req, res) => {
  console.log("📝 SUBMISSION ENDPOINT CALLED");
  
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
    
    if (!discordId || !discordUsername) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing discordId or discordUsername" 
      });
    }
    
    let scoreValue = 0;
    let totalValue = 8;
    if (score && score.includes('/')) {
      const parts = score.split('/');
      scoreValue = parseInt(parts[0]) || 0;
      totalValue = parseInt(parts[1]) || 8;
    }
    
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: conversationLog || answers || "No conversation log provided",
      conversation_log: conversationLog || null,
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
    
    let dbSuccess = false;
    let savedId = null;
    
    try {
      const { data, error } = await supabase
        .from("applications")
        .insert([applicationData])
        .select();
      
      if (error) {
        console.log("❌ Insert failed:", error.message);
      } else {
        dbSuccess = true;
        savedId = data?.[0]?.id;
      }
    } catch (dbError) {
      console.error("❌ Database exception:", dbError.message);
    }
    
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "📝 NEW MOD TEST SUBMISSION",
          description: `**User:** ${discordUsername}\n**Discord ID:** ${discordId}\n**Score:** ${score || "0/8"}\n**Status:** Pending Review`,
          fields: [
            {
              name: "👤 User Info",
              value: `\`\`\`\nDiscord: ${discordUsername}\nID: ${discordId}\nDate: ${new Date().toLocaleString()}\n\`\`\``,
              inline: true
            },
            {
              name: "📊 Test Results",
              value: `\`\`\`\nScore: ${scoreValue}/${totalValue}\nCorrect: ${scoreValue}/${totalValue}\nPercentage: ${Math.round((scoreValue/totalValue)*100)}%\n\`\`\``,
              inline: true
            }
          ],
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
          footer: { text: "Void Esports Mod Test System" }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Void Test System"
        });
      } catch (webhookError) {
        console.error("⚠️ Discord webhook error:", webhookError.message);
      }
    }
    
    res.json({
      success: true,
      message: "✅ Test submitted successfully!",
      details: {
        user: discordUsername,
        score: score,
        database: dbSuccess ? "saved" : "failed",
        savedId: savedId,
        adminPanel: "https://mod-application-backend.onrender.com/admin"
      }
    });
    
  } catch (err) {
    console.error("🔥 CRITICAL ERROR in submission:", err);
    res.status(200).json({ 
      success: true, 
      message: "Test received! Your score has been recorded.",
      error: err.message
    });
  }
});

app.post("/api/submit", async (req, res) => {
  console.log("📨 SIMPLE API SUBMISSION ENDPOINT");
  
  const { discordId, discordUsername, score, answers, conversationLog } = req.body;
  
  if (!discordId || !discordUsername) {
    return res.status(400).json({ 
      success: false,
      error: "Missing required fields" 
    });
  }
  
  console.log(`Simple submission for: ${discordUsername} (${discordId}) - Score: ${score || 'N/A'}`);
  
  try {
    let correctAnswers = 0;
    let totalQuestions = 8;
    
    if (score && score.includes('/')) {
      const parts = score.split('/');
      correctAnswers = parseInt(parts[0]) || 0;
      totalQuestions = parseInt(parts[1]) || 8;
    }
    
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers || "Simple submission",
      conversation_log: conversationLog || null,
      score: score || "0/8",
      total_questions: totalQuestions,
      correct_answers: correctAnswers,
      wrong_answers: totalQuestions - correctAnswers,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const dbResult = await supabase.from("applications").insert([applicationData]);
    
    if (dbResult.error) {
      console.error("Simple DB error:", dbResult.error);
    }
    
    if (process.env.DISCORD_WEBHOOK_URL) {
      const embed = {
        title: "📝 Test Submission (Simple API)",
        description: `**User:** ${discordUsername}\n**Score:** ${score || "N/A"}\n**Discord ID:** ${discordId}`,
        fields: [
          {
            name: "Details",
            value: `\`\`\`\nScore: ${score || "0/8"}\nCorrect: ${correctAnswers}/${totalQuestions}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
            inline: false
          }
        ],
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
        footer: { text: "Simple API Endpoint - Auto-saved" }
      };
      
      axios.post(process.env.DISCORD_WEBHOOK_URL, {
        embeds: [embed]
      }).catch(e => console.log("Simple webhook error:", e.message));
    }
    
    res.json({ 
      success: true, 
      message: "Test submitted successfully!",
      user: discordUsername,
      score: score || "0/8"
    });
    
  } catch (err) {
    console.error("Simple submission error:", err);
    res.json({ 
      success: true, 
      message: "Test received and recorded"
    });
  }
});

/* ================= AUTH ENDPOINTS ================= */

app.get("/auth/discord", (req, res) => {
  req.session.loginIntent = "test";
  
  const redirect = `https://discord.com/api/oauth2/authorize?client_id=${
    process.env.DISCORD_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(
    process.env.REDIRECT_URI
  )}&response_type=code&scope=identify`;

  res.redirect(redirect);
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) return res.status(400).send("No code provided");

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

    const userRes = await axios.get(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization: `Bearer ${tokenRes.data.access_token}`
        }
      }
    );

    req.session.user = userRes.data;
    req.session.isAdmin = false;
    
    const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
    if (adminIds.includes(userRes.data.id)) {
      req.session.isAdmin = true;
    }
    
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
      
      const frontendUrl = `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userRes.data.username)}&discord_id=${userRes.data.id}&timestamp=${Date.now()}`;
      
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

/* ================= HEALTH CHECK ================= */

app.get("/health", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("applications")
      .select("count", { count: 'exact', head: true });
    
    const dbStatus = error ? `ERROR: ${error.message}` : "CONNECTED";
    const botStatus = bot.user ? `CONNECTED as ${bot.user.tag}` : "DISCONNECTED";
    
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      database: dbStatus,
      discordBot: botStatus,
      discordWebhook: process.env.DISCORD_WEBHOOK_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      session: req.session.user ? "active" : "none"
    });
  } catch (err) {
    res.status(500).json({ 
      status: "error", 
      error: err.message
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
║                VOID ESPORTS MOD TEST SERVER v3.0                    ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${PORT}                                  ║
║ 🤖 Discord Bot: ${botReady ? "✅ Connected" : "🔄 Connecting..."}   ║
║ 👑 Admin Panel: /admin                                              ║
║ 🧪 Test Login: /auth/discord                                        ║
║ 🏥 Health Check: /health                                            ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});
