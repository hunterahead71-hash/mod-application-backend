
const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, PermissionsBitField } = require("discord.js");
const MemoryStore = require('memorystore')(session);

const app = express();


/* ================= SUPABASE ================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= ENHANCED DISCORD BOT ================= */




const bot = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildPresences
    ],
    partials: ['CHANNEL'] // For DM support
});

// Initialize enhanced bot manager
async function initializeBot() {
    console.log('🤖 Initializing Discord bot...');
    
    try {
        // Bot is already declared at the top, just need to login
        await bot.login(process.env.DISCORD_BOT_TOKEN);
        console.log(`✅ Discord bot logged in as ${bot.user.tag}`);
    } catch (error) {
        console.error('❌ Discord bot login failed:', error.message);
        console.log('⚠️ Bot features will be unavailable');
    }
}

// Initialize bot
initializeBot();

bot.on('ready', () => {
    console.log(`🤖 Discord bot ready as ${bot.user.tag}`);
    
    // Set bot presence
    bot.user.setPresence({
        activities: [{ 
            name: 'Void Mod Applications', 
            type: 3 // WATCHING
        }],
        status: 'online'
    });
});

bot.on('error', (error) => {
    console.error('🤖 Discord bot error:', error);
});

/* ================= ULTIMATE ASSIGN MOD ROLE FUNCTION ================= */

async function ultimateAssignModRole(discordId, discordUsername) {
    console.log(`🎯 ULTIMATE: Assigning mod role to ${discordUsername} (${discordId})`);
    
    const operationId = `assign-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        // Check if bot manager is available
        if (!botManager || !botManager.ready) {
            console.log('🤖 Bot not ready, adding to pending operations');
            
            if (botManager) {
                botManager.addPendingOperation(operationId, {
                    type: 'assignRole',
                    userId: discordId,
                    roleId: process.env.MOD_ROLE_ID,
                    username: discordUsername
                });
            }
            
            // Fallback to original function
            return await assignModRole(discordId);
        }
        
        // Use enhanced bot manager
        const roleResult = await botManager.assignRoleToUser(discordId, process.env.MOD_ROLE_ID);
        
        if (roleResult.success) {
            // Send enhanced welcome message
            console.log(`🤖 Sending enhanced welcome DM to ${discordUsername}`);
            const dmResult = await botManager.sendWelcomeMessage(discordId, discordUsername);
            
            // Send notification to admin channel if configured
            if (process.env.ADMIN_NOTIFICATION_CHANNEL_ID) {
                await sendAdminNotification(discordId, discordUsername, 'accepted');
            }
            
            return {
                success: true,
                roleAssigned: true,
                dmSent: dmResult.success,
                username: discordUsername,
                operationId: operationId
            };
        }
        
        return {
            success: false,
            roleAssigned: false,
            error: 'Failed to assign role'
        };
        
    } catch (error) {
        console.error(`❌ ULTIMATE role assignment failed:`, error);
        
        // Try original function as fallback
        try {
            console.log('🔄 Trying fallback role assignment...');
            const fallbackResult = await assignModRole(discordId);
            
            return {
                success: fallbackResult,
                roleAssigned: fallbackResult,
                dmSent: fallbackResult,
                fallbackUsed: true,
                error: error.message
            };
        } catch (fallbackError) {
            console.error('❌ Fallback also failed:', fallbackError);
            
            return {
                success: false,
                roleAssigned: false,
                dmSent: false,
                error: `${error.message} | Fallback: ${fallbackError.message}`
            };
        }
    }
}

/* ================= ULTIMATE REJECTION FUNCTION ================= */

async function ultimateSendRejection(discordId, discordUsername, reason) {
    console.log(`🎯 ULTIMATE: Sending rejection to ${discordUsername} (${discordId})`);
    
    const operationId = `reject-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        // Check if bot manager is available
        if (!botManager || !botManager.ready) {
            console.log('🤖 Bot not ready, adding to pending operations');
            
            if (botManager) {
                botManager.addPendingOperation(operationId, {
                    type: 'sendRejection',
                    userId: discordId,
                    username: discordUsername,
                    reason: reason
                });
            }
            
            // Fallback to original function
            return await sendRejectionDM(discordId, discordUsername, reason);
        }
        
        // Use enhanced bot manager
        const dmResult = await botManager.sendRejectionMessage(discordId, discordUsername, reason);
        
        // Send notification to admin channel if configured
        if (process.env.ADMIN_NOTIFICATION_CHANNEL_ID) {
            await sendAdminNotification(discordId, discordUsername, 'rejected', reason);
        }
        
        return {
            success: true,
            dmSent: dmResult.success,
            dmError: dmResult.error || null,
            username: discordUsername,
            operationId: operationId
        };
        
    } catch (error) {
        console.error(`❌ ULTIMATE rejection failed:`, error);
        
        // Try original function as fallback
        try {
            console.log('🔄 Trying fallback rejection...');
            const fallbackResult = await sendRejectionDM(discordId, discordUsername, reason);
            
            return {
                success: fallbackResult,
                dmSent: fallbackResult,
                fallbackUsed: true,
                error: error.message
            };
        } catch (fallbackError) {
            console.error('❌ Fallback also failed:', fallbackError);
            
            return {
                success: false,
                dmSent: false,
                error: `${error.message} | Fallback: ${fallbackError.message}`
            };
        }
    }
}

/* ================= ADMIN NOTIFICATION FUNCTION ================= */

async function sendAdminNotification(discordId, username, action, reason = null) {
    if (!process.env.ADMIN_NOTIFICATION_CHANNEL_ID) {
        return false;
    }
    
    try {
        const channelId = process.env.ADMIN_NOTIFICATION_CHANNEL_ID;
        const channel = await bot.channels.fetch(channelId);
        
        if (!channel) {
            console.log(`❌ Admin notification channel not found: ${channelId}`);
            return false;
        }
        
        const embed = {
            title: action === 'accepted' ? '✅ MODERATOR ACCEPTED' : '❌ MODERATOR REJECTED',
            description: `**User:** ${username}\n**Discord ID:** ${discordId}\n**Action:** ${action.toUpperCase()}`,
            fields: [
                {
                    name: '📊 Details',
                    value: `\`\`\`\nTime: ${new Date().toLocaleString()}\nAction: ${action}\nUser ID: ${discordId}\n${reason ? `Reason: ${reason}\n` : ''}\`\`\``,
                    inline: false
                }
            ],
            color: action === 'accepted' ? 0x3ba55c : 0xed4245,
            timestamp: new Date().toISOString(),
            footer: { text: 'Void Esports Admin System' }
        };
        
        await channel.send({ embeds: [embed] });
        console.log(`📢 Admin notification sent to ${channel.name}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to send admin notification:', error.message);
        return false;
    }
}

/* ================= BOT STATUS ENDPOINT ================= */

app.get("/bot-status", async (req, res) => {
    try {
        const status = botManager ? botManager.getStatus() : { error: 'Bot manager not initialized' };
        
        // Check specific permissions
        let guildInfo = null;
        let roleInfo = null;
        
        if (botManager && botManager.ready) {
            try {
                const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
                const botMember = await guild.members.fetch(bot.user.id);
                const role = guild.roles.cache.get(process.env.MOD_ROLE_ID);
                
                guildInfo = {
                    name: guild.name,
                    memberCount: guild.memberCount,
                    botPermissions: {
                        manageRoles: botMember.permissions.has(PermissionsBitField.Flags.ManageRoles),
                        sendMessages: botMember.permissions.has(PermissionsBitField.Flags.SendMessages),
                        manageMessages: botMember.permissions.has(PermissionsBitField.Flags.ManageMessages)
                    }
                };
                
                roleInfo = role ? {
                    name: role.name,
                    color: role.hexColor,
                    position: role.position,
                    botHighestRole: botMember.roles.highest.position
                } : { error: 'Role not found' };
                
            } catch (guildError) {
                guildInfo = { error: guildError.message };
            }
        }
        
        res.json({
            bot: status,
            guild: guildInfo,
            role: roleInfo,
            env: {
                guildId: process.env.DISCORD_GUILD_ID ? 'SET' : 'NOT SET',
                modRoleId: process.env.MOD_ROLE_ID ? 'SET' : 'NOT SET',
                adminChannel: process.env.ADMIN_NOTIFICATION_CHANNEL_ID ? 'SET' : 'NOT SET'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/* ================= UPDATE ADMIN ENDPOINTS ================= */

// Update the accept endpoint to use ultimate function
app.post("/admin/accept/:id", async (req, res) => {
    try {
        // ... (previous code remains the same until the role assignment part)
        
        // Replace the role assignment section with:
        
        console.log(`🔵 Accepting application ${req.params.id}`);
        
        // Assign mod role via ULTIMATE function
        let roleResult = null;
        if (process.env.DISCORD_GUILD_ID && process.env.MOD_ROLE_ID) {
            roleResult = await ultimateAssignModRole(application.discord_id, application.discord_username);
            
            if (roleResult.success && roleResult.roleAssigned) {
                console.log(`🎉 Ultimate role assignment successful for ${application.discord_username}`);
            } else {
                console.log(`⚠️ Ultimate role assignment issues:`, roleResult);
            }
        } else {
            console.log("⚠️ Discord guild ID or mod role ID not configured");
        }
        
        // ... (rest of the code remains the same)
        
        res.json({ 
            success: true, 
            message: "Application accepted successfully",
            botResult: roleResult,
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

// Update the reject endpoint to use ultimate function
app.post("/admin/reject/:id", async (req, res) => {
    try {
        // ... (previous code remains the same until the DM sending part)
        
        // Replace the rejection DM section with:
        
        console.log(`❌ Application ${req.params.id} marked as rejected`);
        
        // Send rejection DM via ULTIMATE function
        let dmResult = null;
        if (!isTestUser) {
            dmResult = await ultimateSendRejection(application.discord_id, application.discord_username, req.body.reason || "Not specified");
            
            if (dmResult.success && dmResult.dmSent) {
                console.log(`✅ Ultimate rejection DM sent to ${application.discord_username}`);
            } else {
                console.log(`⚠️ Ultimate rejection DM issues:`, dmResult);
            }
        } else {
            console.log(`Skipping DM for test user: ${application.discord_username}`);
        }
        
        // ... (rest of the code remains the same)
        
        res.json({ 
            success: true, 
            message: "Application rejected successfully",
            botResult: dmResult,
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
/* ================= BOT TEST ENDPOINTS ================= */

app.get("/bot/debug", async (req, res) => {
    try {
        // Check if bot is connected
        const botConnected = bot.isReady();
        const botUser = bot.user ? bot.user.tag : 'Not logged in';
        
        // Check guild access
        let guildInfo = null;
        if (process.env.DISCORD_GUILD_ID && botConnected) {
            try {
                const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
                guildInfo = {
                    name: guild.name,
                    id: guild.id,
                    memberCount: guild.memberCount,
                    icon: guild.iconURL()
                };
            } catch (guildError) {
                guildInfo = { error: guildError.message };
            }
        }
        
        // Check role access
        let roleInfo = null;
        if (process.env.MOD_ROLE_ID && guildInfo && !guildInfo.error) {
            try {
                const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
                const role = guild.roles.cache.get(process.env.MOD_ROLE_ID);
                roleInfo = role ? {
                    name: role.name,
                    id: role.id,
                    color: role.hexColor,
                    position: role.position,
                    members: role.members.size
                } : { error: 'Role not found' };
            } catch (roleError) {
                roleInfo = { error: roleError.message };
            }
        }
        
        res.json({
            timestamp: new Date().toISOString(),
            bot: {
                connected: botConnected,
                user: botUser,
                readyAt: bot.readyAt,
                uptime: bot.uptime
            },
            environment: {
                guildId: process.env.DISCORD_GUILD_ID || 'NOT SET',
                modRoleId: process.env.MOD_ROLE_ID || 'NOT SET',
                botToken: process.env.DISCORD_BOT_TOKEN ? 'SET' : 'NOT SET'
            },
            guild: guildInfo,
            role: roleInfo,
            instructions: {
                inviteLink: `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID || 'CLIENT_ID_MISSING'}&permissions=268435456&scope=bot%20applications.commands`,
                permissionsNeeded: ['MANAGE_ROLES', 'SEND_MESSAGES', 'READ_MESSAGES', 'EMBED_LINKS']
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test role assignment endpoint
app.post("/bot/test-assign-role", async (req, res) => {
    try {
        const { userId, testUsername = "Test User" } = req.body;
        
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }
        
        console.log(`🧪 TEST: Attempting to assign role to ${userId}`);
        
        // Check bot status
        if (!bot.isReady()) {
            return res.json({
                success: false,
                error: "Bot is not connected",
                botStatus: "disconnected",
                timestamp: new Date().toISOString()
            });
        }
        
        // Check if we have required env vars
        if (!process.env.DISCORD_GUILD_ID || !process.env.MOD_ROLE_ID) {
            return res.json({
                success: false,
                error: "Missing environment variables",
                missing: {
                    guildId: !process.env.DISCORD_GUILD_ID,
                    modRoleId: !process.env.MOD_ROLE_ID
                }
            });
        }
        
        try {
            // Get guild
            const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
            
            // Get member
            const member = await guild.members.fetch(userId);
            
            // Get role
            const role = guild.roles.cache.get(process.env.MOD_ROLE_ID);
            
            if (!role) {
                return res.json({
                    success: false,
                    error: "Role not found",
                    roleId: process.env.MOD_ROLE_ID,
                    availableRoles: guild.roles.cache.map(r => ({ id: r.id, name: r.name }))
                });
            }
            
            // Check permissions
            const botMember = await guild.members.fetch(bot.user.id);
            const hasPermission = botMember.permissions.has("MANAGE_ROLES");
            
            if (!hasPermission) {
                return res.json({
                    success: false,
                    error: "Bot lacks MANAGE_ROLES permission",
                    botPermissions: botMember.permissions.toArray()
                });
            }
            
            // Check role hierarchy
            if (role.position >= botMember.roles.highest.position) {
                return res.json({
                    success: false,
                    error: "Role is higher than bot's highest role",
                    rolePosition: role.position,
                    botHighestRole: botMember.roles.highest.position
                });
            }
            
            // Test assign role
            await member.roles.add(role);
            
            // Send test DM
            let dmSent = false;
            try {
                const user = await bot.users.fetch(userId);
                await user.send({
                    embeds: [{
                        title: "🤖 Bot Test Successful!",
                        description: "This is a test message from the Void Esports bot system.",
                        color: 0x00ffea,
                        timestamp: new Date().toISOString()
                    }]
                });
                dmSent = true;
            } catch (dmError) {
                console.log("DM test failed:", dmError.message);
            }
            
            // Remove role after test
            setTimeout(async () => {
                try {
                    await member.roles.remove(role);
                    console.log(`🧪 TEST: Cleaned up test role from ${member.user.tag}`);
                } catch (cleanupError) {
                    console.error("Cleanup error:", cleanupError.message);
                }
            }, 5000);
            
            res.json({
                success: true,
                message: "Role assignment test successful",
                user: {
                    id: member.user.id,
                    tag: member.user.tag,
                    avatar: member.user.displayAvatarURL()
                },
                role: {
                    id: role.id,
                    name: role.name,
                    color: role.hexColor
                },
                dmSent: dmSent,
                cleanup: "Role will be removed in 5 seconds",
                timestamp: new Date().toISOString()
            });
            
        } catch (fetchError) {
            res.json({
                success: false,
                error: fetchError.message,
                code: fetchError.code,
                details: {
                    userId: userId,
                    guildId: process.env.DISCORD_GUILD_ID
                }
            });
        }
        
    } catch (error) {
        console.error("Test error:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            stack: error.stack 
        });
    }
});
/* ================= BOT INVITE LINK GENERATOR ================= */

app.get("/bot/invite", (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    
    if (!clientId || clientId === "your_client_id_here") {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Bot Setup Required</title>
                <style>
                    body { font-family: Arial; padding: 40px; text-align: center; }
                    .error { color: #ff0033; font-size: 24px; margin: 20px 0; }
                    .steps { text-align: left; max-width: 600px; margin: 0 auto; }
                </style>
            </head>
            <body>
                <h1>🤖 Bot Setup Required</h1>
                <div class="error">DISCORD_CLIENT_ID is not set in environment variables!</div>
                <div class="steps">
                    <h3>Steps to fix:</h3>
                    <ol>
                        <li>Go to <a href="https://discord.com/developers/applications" target="_blank">Discord Developer Portal</a></li>
                        <li>Click your application → OAuth2 → Copy "Client ID"</li>
                        <li>Add to Render.com environment variables: DISCORD_CLIENT_ID=your_client_id_here</li>
                        <li>Redeploy your application</li>
                    </ol>
                    <p>Your Client ID should be a number like: <code>123456789012345678</code></p>
                </div>
            </body>
            </html>
        `);
    }
    
    // Generate correct invite link
    const permissions = "268435456"; // Manage Roles + Send Messages + Read Messages
    const scope = "bot%20applications.commands";
    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${scope}`;
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Bot Invite Link</title>
            <style>
                body { font-family: Arial; padding: 40px; text-align: center; }
                .success { color: #3ba55c; font-size: 24px; margin: 20px 0; }
                .link { 
                    background: #2f3136; 
                    padding: 20px; 
                    border-radius: 10px; 
                    margin: 20px auto; 
                    max-width: 600px;
                    word-break: break-all;
                    font-family: monospace;
                }
                a { color: #00ffea; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <h1>🤖 Bot Invite Link Generated</h1>
            <div class="success">✅ Use this link to invite the bot to your server:</div>
            <div class="link">
                <a href="${inviteLink}" target="_blank">${inviteLink}</a>
            </div>
            <p><a href="${inviteLink}" target="_blank"><button style="padding: 15px 30px; background: #5865f2; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 18px;">Click here to invite bot</button></a></p>
            <p style="margin-top: 30px; color: #888;">Client ID: ${clientId}</p>
        </body>
        </html>
    `);
});
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

// Function to send DM to user
async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    const user = await bot.users.fetch(discordId);
    if (!user) {
      console.log(`User ${discordId} not found`);
      return false;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: footer || 'Void Esports Mod Team' });

    await user.send({ embeds: [embed] });
    console.log(`DM sent to ${user.tag}: ${title}`);
    return true;
  } catch (error) {
    console.error(`Failed to send DM to ${discordId}:`, error.message);
    return false;
  }
}

// Function to assign mod role
async function assignModRole(discordId) {
  try {
    const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const role = guild.roles.cache.get(process.env.MOD_ROLE_ID);
    
    if (!member) {
      console.log(`Member ${discordId} not found in guild`);
      return false;
    }
    
    if (!role) {
      console.log(`Role ${process.env.MOD_ROLE_ID} not found`);
      return false;
    }
    
    await member.roles.add(role);
    console.log(`Assigned mod role to ${member.user.tag}`);
    
    // Send welcome DM
    await sendDMToUser(
      discordId,
      '🎉 Welcome to the Void Esports Mod Team!',
      `Congratulations! Your moderator application has been **approved**.\n\n` +
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
    
    return true;
  } catch (error) {
    console.error('Error assigning mod role:', error);
    return false;
  }
}

// Function to send rejection DM
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
    console.error('Error sending rejection DM:', error);
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

/* ================= TEST INTENT - FIXED ================= */

// Store intents in memory as backup
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

/* ================= ADMIN PAGE - ENHANCED WITH CONVERSATION LOGS ================= */

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
    // FIRST: Check if applications table exists by trying to query it
    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      
      // If table doesn't exist, create it dynamically
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.log("Applications table doesn't exist, creating it...");
        return createApplicationsTableAndReturnAdmin(req, res);
      }
      
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
    
    // Admin dashboard HTML with enhanced features
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          :root {
            --void-blood: #ff0033;
            --void-neon: #00ffea;
            --discord-bg: #36393f;
            --discord-primary: #202225;
            --discord-green: #3ba55c;
            --discord-red: #ed4245;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          body {
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background: var(--discord-bg);
            color: #ffffff;
            min-height: 100vh;
            padding: 20px;
          }
          
          .admin-container {
            max-width: 1400px;
            margin: 0 auto;
          }
          
          .header {
            background: var(--discord-primary);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .header h1 {
            color: var(--void-blood);
            font-size: 28px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          
          .user-avatar {
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, var(--void-blood), var(--void-neon));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 20px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .logout-btn {
            background: var(--discord-red);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .logout-btn:hover {
            background: #ff3333;
            transform: translateY(-2px);
          }
          
          .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
          }
          
          .stat-card {
            background: var(--discord-primary);
            padding: 20px;
            border-radius: 12px;
            text-align: center;
          }
          
          .stat-number {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 10px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .stat-label {
            color: #888;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .total { color: var(--void-neon); }
          .pending { color: #f59e0b; }
          .accepted { color: var(--discord-green); }
          .rejected { color: var(--discord-red); }
          
          .filters {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
          }
          
          .filter-btn {
            background: var(--discord-primary);
            color: #888;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .filter-btn.active {
            background: var(--void-blood);
            color: white;
          }
          
          .filter-btn:hover:not(.active) {
            background: #333;
            color: white;
          }
          
          .applications-grid {
            display: grid;
            gap: 15px;
          }
          
          .application-card {
            background: var(--discord-primary);
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #888;
          }
          
          .application-card.pending { border-left-color: #f59e0b; }
          .application-card.accepted { border-left-color: var(--discord-green); }
          .application-card.rejected { border-left-color: var(--discord-red); }
          
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .app-user {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .app-avatar {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #8b5cf6, var(--void-neon));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-info h3 {
            font-size: 18px;
            margin-bottom: 5px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-info p {
            color: #888;
            font-size: 14px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-status {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .status-pending { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
          .status-accepted { background: rgba(59, 165, 92, 0.2); color: var(--discord-green); }
          .status-rejected { background: rgba(237, 66, 69, 0.2); color: var(--discord-red); }
          
          .app-details {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            margin-top: 15px;
          }
          
          .score-display {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          
          .score-value {
            font-size: 24px;
            font-weight: bold;
            color: var(--void-neon);
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
          }
          
          .action-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .accept-btn {
            background: var(--discord-green);
            color: white;
          }
          
          .reject-btn {
            background: var(--discord-red);
            color: white;
          }
          
          .view-btn {
            background: #5865f2;
            color: white;
          }
          
          .action-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .no-applications {
            text-align: center;
            padding: 50px;
            color: #888;
            font-size: 18px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .answers-content {
            margin-top: 10px;
            padding: 10px;
            background: rgba(0,0,0,0.5);
            border-radius: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            max-height: 300px;
            overflow-y: auto;
            display: none;
          }
          
          .answers-content.show {
            display: block;
          }
          
          .view-answers-btn {
            background: none;
            border: none;
            color: var(--void-neon);
            cursor: pointer;
            font-size: 14px;
            margin-top: 10px;
            display: flex;
            align-items: center;
            gap: 5px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          /* Conversation Log Styles */
          .conversation-log {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            font-family: 'JetBrains Mono', monospace;
            font-size: 11px;
            max-height: 300px;
            overflow-y: auto;
            border-left: 3px solid #5865f2;
          }
          
          .conversation-log pre {
            margin: 0;
            white-space: pre-wrap;
            word-wrap: break-word;
            line-height: 1.4;
          }
          
          .view-full-log {
            background: rgba(88, 101, 242, 0.2);
            border: 1px solid #5865f2;
            color: #5865f2;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            margin-top: 10px;
            display: inline-block;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .view-full-log:hover {
            background: rgba(88, 101, 242, 0.3);
          }
          
          .qna-section {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            border-left: 3px solid #f59e0b;
          }
          
          .qna-item {
            background: rgba(255,255,255,0.05);
            border-radius: 6px;
            padding: 10px;
            margin: 8px 0;
            font-size: 12px;
          }
          
          .qna-status.correct {
            color: var(--discord-green);
            font-weight: bold;
            font-size: 11px;
          }
          
          .qna-status.incorrect {
            color: var(--discord-red);
            font-weight: bold;
            font-size: 11px;
          }
          
          /* Reject Modal Styles */
          .reject-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 10000;
          }
          
          .modal-content {
            background: #2f3136;
            padding: 30px;
            border-radius: 12px;
            max-width: 500px;
            width: 90%;
            border: 2px solid var(--discord-red);
          }
          
          .reject-reasons {
            margin: 20px 0;
          }
          
          .reject-reasons label {
            display: block;
            padding: 8px;
            background: rgba(255,255,255,0.05);
            margin: 5px 0;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
          }
          
          .reject-reasons label:hover {
            background: rgba(255,255,255,0.1);
          }
          
          .reject-reasons input[type="radio"] {
            margin-right: 10px;
          }
          
          .modal-buttons {
            display: flex;
            gap: 10px;
            margin-top: 20px;
          }
          
          .modal-cancel {
            flex: 1;
            background: #72767d;
            color: white;
            border: none;
            padding: 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
          }
          
          .modal-confirm-reject {
            flex: 1;
            background: var(--discord-red);
            color: white;
            border: none;
            padding: 12px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
          }
          
          .modal-cancel:hover {
            background: #5d6269;
          }
          
          .modal-confirm-reject:hover {
            background: #c03537;
          }
          
          .reviewed-by {
            font-size: 12px;
            color: #888;
            margin-top: 5px;
            font-style: italic;
          }
          
          .rejection-reason {
            background: rgba(237, 66, 69, 0.1);
            border-left: 3px solid var(--discord-red);
            padding: 10px;
            margin: 10px 0;
            border-radius: 4px;
            font-size: 13px;
          }
          
          .test-user-badge {
            background: #f59e0b;
            color: black;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: bold;
            margin-left: 8px;
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="header">
            <h1><i class="fas fa-shield-alt"></i> VOID ESPORTS - ADMIN DASHBOARD</h1>
            <div class="user-info">
              <div class="user-avatar">${req.session.user.username.charAt(0).toUpperCase()}</div>
              <div>
                <div>${req.session.user.username}#${req.session.user.discriminator}</div>
                <div style="font-size: 12px; color: #888;">Admin • Session: ${req.sessionID.substring(0, 8)}...</div>
              </div>
              <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            </div>
          </div>
          
          <div class="stats-container">
            <div class="stat-card">
              <div class="stat-number total">${realApplications.length}</div>
              <div class="stat-label">Real Applications</div>
            </div>
            <div class="stat-card">
              <div class="stat-number pending">${realApplications.filter(a => a.status === 'pending').length}</div>
              <div class="stat-label">Pending</div>
            </div>
            <div class="stat-card">
              <div class="stat-number accepted">${realApplications.filter(a => a.status === 'accepted').length}</div>
              <div class="stat-label">Accepted</div>
            </div>
            <div class="stat-card">
              <div class="stat-number rejected">${realApplications.filter(a => a.status === 'rejected').length}</div>
              <div class="stat-label">Rejected</div>
            </div>
          </div>
          
          <div class="filters">
            <button class="filter-btn active" onclick="filterApplications('all')">All (${realApplications.length})</button>
            <button class="filter-btn" onclick="filterApplications('pending')">Pending (${realApplications.filter(a => a.status === 'pending').length})</button>
            <button class="filter-btn" onclick="filterApplications('accepted')">Accepted (${realApplications.filter(a => a.status === 'accepted').length})</button>
            <button class="filter-btn" onclick="filterApplications('rejected')">Rejected (${realApplications.filter(a => a.status === 'rejected').length})</button>
          </div>
          
          <div class="applications-grid" id="applicationsContainer">
    `;

    if (realApplications.length === 0) {
      html += `
        <div class="no-applications">
          <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px;"></i>
          <p>No real applications submitted yet.</p>
          <p style="color: #888; font-size: 14px; margin-top: 10px;">Test submissions are filtered out. Real user submissions will appear here.</p>
        </div>
      `;
    }

    realApplications.forEach((app, index) => {
      const score = app.score ? app.score.split('/') : ['0', '8'];
      const scoreValue = parseInt(score[0]);
      const totalQuestions = parseInt(score[1]);
      const percentage = totalQuestions > 0 ? Math.round((scoreValue / totalQuestions) * 100) : 0;
      
      // Check if it's a test user
      const username = app.discord_username.toLowerCase();
      const isTestUser = username.includes('test') || username.includes('bot') || app.discord_id.includes('test');
      
      // Safely escape HTML content
      const safeUsername = escapeHtml(app.discord_username);
      const safeId = escapeHtml(app.discord_id);
      const safeScore = escapeHtml(app.score || '0/8');
      const safeReviewedBy = app.reviewed_by ? escapeHtml(app.reviewed_by) : '';
      const safeRejectionReason = app.rejection_reason ? escapeHtml(app.rejection_reason) : '';
      
      // Safely escape conversation log
      let safeConversationLog = '';
      if (app.conversation_log) {
        safeConversationLog = escapeHtml(app.conversation_log.substring(0, 1500));
      }
      
      html += `
        <div class="application-card ${app.status}" id="app-${app.id}" data-status="${app.status}">
          <div class="app-header">
            <div class="app-user">
              <div class="app-avatar">${safeUsername.charAt(0).toUpperCase()}</div>
              <div class="app-info">
                <h3>${safeUsername} ${isTestUser ? '<span class="test-user-badge">TEST</span>' : ''}</h3>
                <p>ID: ${safeId} • ${new Date(app.created_at).toLocaleString()}</p>
                ${app.reviewed_by ? `<div class="reviewed-by">Reviewed by: ${safeReviewedBy} on ${new Date(app.reviewed_at).toLocaleDateString()}</div>` : ''}
                ${app.rejection_reason ? `<div class="rejection-reason"><strong>Rejection Reason:</strong> ${safeRejectionReason}</div>` : ''}
              </div>
            </div>
            <div class="app-status status-${app.status}">${app.status.toUpperCase()}</div>
          </div>
          
          <div class="app-details">
            <div class="score-display">
              <div class="score-value">${scoreValue}/${totalQuestions}</div>
              <div style="color: #888;">${percentage}% • ${app.correct_answers || 0} correct</div>
            </div>
            
            <button class="view-answers-btn" onclick="toggleAnswers(${app.id})">
              <i class="fas fa-chevron-down"></i> View Conversation Logs
            </button>
            
            <div class="answers-content" id="answers-${app.id}">
      `;
      
      // Show conversation logs if available
      if (app.conversation_log) {
        html += `
              <div class="conversation-log">
                <h4 style="margin: 0 0 10px 0; color: #5865f2;"><i class="fas fa-comments"></i> Conversation Log:</h4>
                <pre>${safeConversationLog}${app.conversation_log.length > 1500 ? '...' : ''}</pre>
                ${app.conversation_log.length > 1500 ? 
                  `<button class="view-full-log" onclick="viewFullLog(${app.id}, 'conversation')">View Full Conversation Log (${app.conversation_log.length} chars)</button>` : ''}
              </div>
        `;
      }
      
      // Show Q&A if available
      if (app.questions_with_answers) {
        try {
          const qna = JSON.parse(app.questions_with_answers);
          if (Array.isArray(qna) && qna.length > 0) {
            // Safely escape Q&A content
            const safeQna = qna.slice(0, 3).map((q, i) => ({
              question: escapeHtml(q.question.substring(0, 80)),
              questionFull: q.question,
              answer: escapeHtml(q.answer.substring(0, 80)),
              answerFull: q.answer,
              correct: q.correct
            }));
            
            html += `
              <div class="qna-section">
                <h4 style="margin: 0 0 10px 0; color: #f59e0b;"><i class="fas fa-question-circle"></i> Questions & Answers:</h4>
                ${safeQna.map((q, i) => `
                  <div class="qna-item">
                    <strong>Q${i+1}:</strong> ${q.question}${q.questionFull.length > 80 ? '...' : ''}<br>
                    <strong>A${i+1}:</strong> ${q.answer}${q.answerFull.length > 80 ? '...' : ''}<br>
                    <span class="qna-status ${q.correct ? 'correct' : 'incorrect'}">
                      ${q.correct ? '✅ Correct' : '❌ Incorrect'}
                    </span>
                  </div>
                `).join('')}
                ${qna.length > 3 ? `<button class="view-full-log" onclick="viewFullLog(${app.id}, 'qna')">View All ${qna.length} Q&A</button>` : ''}
              </div>
            `;
          }
        } catch (e) {
          console.error('Error parsing Q&A:', e);
        }
      }
      
      // Show simple answers if no conversation log
      if (app.answers && !app.conversation_log) {
        const safeAnswers = escapeHtml(app.answers.substring(0, 500));
        html += `
              <div class="simple-answers">
                <h4 style="margin: 0 0 10px 0;"><i class="fas fa-file-alt"></i> Answers:</h4>
                <pre>${safeAnswers}${app.answers.length > 500 ? '...' : ''}</pre>
              </div>
        `;
      }
      
      html += `
            </div>
            
            <div class="app-actions">
      `;
      
      if (app.status === "pending") {
        html += `
              <button class="action-btn accept-btn" onclick="processApplication(${app.id}, 'accept')">
                <i class="fas fa-check"></i> Accept & Grant Mod Role
              </button>
              <button class="action-btn reject-btn" onclick="showRejectModal(${app.id})">
                <i class="fas fa-times"></i> Reject with Reason
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
              <button class="action-btn view-btn" onclick="viewFullApplication(${app.id})">
                <i class="fas fa-eye"></i> View Details
              </button>
            </div>
          </div>
        </div>
        
        <!-- Reject Modal -->
        <div class="reject-modal" id="rejectModal-${app.id}">
          <div class="modal-content">
            <h3 style="color: var(--discord-red); margin-bottom: 15px;"><i class="fas fa-times-circle"></i> Reject Application</h3>
            <p><strong>User:</strong> ${safeUsername}</p>
            <p><strong>Score:</strong> ${safeScore}</p>
            <p><strong>Submitted:</strong> ${new Date(app.created_at).toLocaleString()}</p>
            
            <div class="reject-reasons">
              <label><input type="radio" name="reason-${app.id}" value="Insufficient test score"> Insufficient test score</label>
              <label><input type="radio" name="reason-${app.id}" value="Poor/incomplete responses"> Poor/incomplete responses</label>
              <label><input type="radio" name="reason-${app.id}" value="Better candidates available"> Better candidates available</label>
              <label><input type="radio" name="reason-${app.id}" value="Currently not accepting new mods"> Currently not accepting new mods</label>
              <label><input type="radio" name="reason-${app.id}" value="Other"> Other (specify below)</label>
            </div>
            
            <textarea id="customReason-${app.id}" placeholder="Custom reason (optional)" rows="3" style="width: 100%; padding: 10px; border-radius: 6px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; margin-top: 10px;"></textarea>
            
            <div class="modal-buttons">
              <button class="modal-cancel" onclick="closeRejectModal(${app.id})">Cancel</button>
              <button class="modal-confirm-reject" onclick="confirmReject(${app.id})">Confirm Rejection</button>
            </div>
          </div>
        </div>
      `;
    });

    html += `
          </div>
        </div>
        
        <!-- Full Application View Modal -->
        <div class="reject-modal" id="fullAppModal" style="display: none;">
          <div class="modal-content" style="max-width: 800px; max-height: 80vh; overflow-y: auto;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <h3 style="color: var(--void-neon);"><i class="fas fa-file-alt"></i> Application Details</h3>
              <button onclick="closeFullAppModal()" style="background: none; border: none; color: white; font-size: 20px; cursor: pointer;">×</button>
            </div>
            <div id="fullAppContent"></div>
          </div>
        </div>
        
        <script>
          // Escape HTML for safety (also defined on client side for consistency)
          function escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }
          
          function filterApplications(status) {
            const cards = document.querySelectorAll('.application-card');
            const buttons = document.querySelectorAll('.filter-btn');
            
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            cards.forEach(card => {
              if (status === 'all' || card.dataset.status === status) {
                card.style.display = 'block';
              } else {
                card.style.display = 'none';
              }
            });
          }
          
          function toggleAnswers(appId) {
            const answersDiv = document.getElementById('answers-' + appId);
            const toggleBtn = answersDiv.previousElementSibling;
            const icon = toggleBtn.querySelector('i');
            
            if (answersDiv.classList.contains('show')) {
              answersDiv.classList.remove('show');
              icon.className = 'fas fa-chevron-down';
              toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> View Conversation Logs';
            } else {
              answersDiv.classList.add('show');
              icon.className = 'fas fa-chevron-up';
              toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Logs';
            }
          }
          
          async function processApplication(appId, action) {
            if (action === 'reject') {
              showRejectModal(appId);
              return;
            }
            
            const btn = event.target;
            const originalText = btn.innerHTML;
            
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;
            
            try {
              const response = await fetch('/admin/' + action + '/' + appId, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              const result = await response.json();
              
              if (response.ok) {
                if (result.roleAssigned === false) {
                  alert('Application accepted but could not assign role. Please assign manually in Discord.');
                }
                location.reload();
              } else {
                alert('Failed to process application: ' + (result.message || 'Unknown error'));
                btn.innerHTML = originalText;
                btn.disabled = false;
              }
            } catch (error) {
              console.error('Error:', error);
              alert('An error occurred: ' + error.message);
              btn.innerHTML = originalText;
              btn.disabled = false;
            }
          }
          
          function showRejectModal(appId) {
            document.getElementById('rejectModal-' + appId).style.display = 'flex';
          }
          
          function closeRejectModal(appId) {
            document.getElementById('rejectModal-' + appId).style.display = 'none';
            // Reset form
            const radios = document.getElementsByName('reason-' + appId);
            for (const radio of radios) radio.checked = false;
            document.getElementById('customReason-' + appId).value = '';
          }
          
          async function confirmReject(appId) {
            const reasonRadios = document.getElementsByName('reason-' + appId);
            let reason = '';
            
            for (const radio of reasonRadios) {
              if (radio.checked) {
                reason = radio.value;
                break;
              }
            }
            
            const customReason = document.getElementById('customReason-' + appId).value;
            if (customReason && reason === 'Other') {
              reason = customReason;
            }
            
            if (!reason && !customReason) {
              reason = 'Not specified';
            }
            
            const btn = event.target;
            const originalText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;
            
            try {
              const response = await fetch('/admin/reject/' + appId, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ reason: reason || customReason })
              });
              
              const result = await response.json();
              
              if (response.ok) {
                if (result.dmSent === false) {
                  alert('Application rejected but could not send DM. User may have DMs disabled.');
                }
                closeRejectModal(appId);
                location.reload();
              } else {
                alert('Failed to reject application: ' + (result.message || 'Unknown error'));
                btn.innerHTML = originalText;
                btn.disabled = false;
              }
            } catch (error) {
              console.error('Error:', error);
              alert('An error occurred: ' + error.message);
              btn.innerHTML = originalText;
              btn.disabled = false;
            }
          }
          
          function viewFullLog(appId, type) {
            const appCard = document.getElementById('app-' + appId);
            const username = appCard.querySelector('.app-info h3').textContent.replace(' TEST', '');
            const appIdText = appId;
            
            if (type === 'conversation') {
              alert('Full conversation log for ' + username + ' (App ID: ' + appIdText + ')\\n\\n' +
                    'To view the full conversation log, please check the database directly or use the admin API.');
            } else if (type === 'qna') {
              alert('Full Q&A for ' + username + ' (App ID: ' + appIdText + ')\\n\\n' +
                    'To view all questions and answers, please check the database directly.');
            }
          }
          
          async function viewFullApplication(appId) {
            try {
              const response = await fetch('/admin/application/' + appId);
              if (response.ok) {
                const app = await response.json();
                let content = \`
                  <div style="margin-bottom: 20px;">
                    <h4 style="color: var(--void-neon);">Application Details</h4>
                    <p><strong>Username:</strong> \${escapeHtml(app.discord_username)}</p>
                    <p><strong>Discord ID:</strong> \${escapeHtml(app.discord_id)}</p>
                    <p><strong>Score:</strong> \${escapeHtml(app.score)}</p>
                    <p><strong>Submitted:</strong> \${new Date(app.created_at).toLocaleString()}</p>
                    <p><strong>Status:</strong> <span class="status-\${app.status}">\${app.status.toUpperCase()}</span></p>
                    \${app.reviewed_by ? \`<p><strong>Reviewed by:</strong> \${escapeHtml(app.reviewed_by)} on \${new Date(app.reviewed_at).toLocaleString()}</p>\` : ''}
                    \${app.rejection_reason ? \`<p><strong>Rejection Reason:</strong> \${escapeHtml(app.rejection_reason)}</p>\` : ''}
                  </div>
                \`;
                
                if (app.conversation_log) {
                  content += \`
                    <div style="margin-bottom: 20px;">
                      <h4 style="color: #5865f2;">Conversation Log</h4>
                      <pre style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow-x: auto; font-family: monospace; font-size: 11px; max-height: 400px; overflow-y: auto;">\${escapeHtml(app.conversation_log)}</pre>
                    </div>
                  \`;
                }
                
                if (app.questions_with_answers) {
                  try {
                    const qna = JSON.parse(app.questions_with_answers);
                    if (Array.isArray(qna) && qna.length > 0) {
                      content += \`
                        <div style="margin-bottom: 20px;">
                          <h4 style="color: #f59e0b;">Questions & Answers</h4>
                          \${qna.map((q, i) => \`
                            <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px; margin: 10px 0;">
                              <p><strong>Q\${i+1}:</strong> \${escapeHtml(q.question)}</p>
                              <p><strong>A\${i+1}:</strong> \${escapeHtml(q.answer)}</p>
                              <p><strong>Status:</strong> <span style="color: \${q.correct ? '#3ba55c' : '#ed4245'};">\${q.correct ? '✅ Correct' : '❌ Incorrect'}</span></p>
                              \${q.explanation ? \`<p><strong>Explanation:</strong> \${escapeHtml(q.explanation)}</p>\` : ''}
                            </div>
                          \`).join('')}
                        </div>
                      \`;
                    }
                  } catch (e) {}
                }
                
                if (app.answers && !app.conversation_log) {
                  content += \`
                    <div style="margin-bottom: 20px;">
                      <h4>Answers</h4>
                      <pre style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; overflow-x: auto; font-family: monospace; font-size: 11px; max-height: 300px; overflow-y: auto;">\${escapeHtml(app.answers)}</pre>
                    </div>
                  \`;
                }
                
                document.getElementById('fullAppContent').innerHTML = content;
                document.getElementById('fullAppModal').style.display = 'flex';
              }
            } catch (error) {
              console.error('Error loading application:', error);
              alert('Failed to load application details');
            }
          }
          
          function closeFullAppModal() {
            document.getElementById('fullAppModal').style.display = 'none';
            document.getElementById('fullAppContent').innerHTML = '';
          }
          
          // Close modals when clicking outside
          window.addEventListener('click', function(event) {
            const modals = document.querySelectorAll('.reject-modal');
            modals.forEach(modal => {
              if (event.target === modal) {
                modal.style.display = 'none';
              }
            });
          });
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

// Helper function to create applications table if it doesn't exist
async function createApplicationsTableAndReturnAdmin(req, res) {
  try {
    console.log("Creating applications table...");
    
    // Try to create table using Supabase SQL
    const { error: createError } = await supabase.rpc('create_applications_table');
    
    if (createError) {
      console.log("RPC failed, trying direct SQL...");
      // If RPC fails, try to insert a dummy record to force table creation
      const { error: insertError } = await supabase
        .from('applications')
        .insert({
          discord_id: 'test',
          discord_username: 'Test User',
          answers: 'Test application',
          score: '0/8',
          status: 'pending',
          created_at: new Date().toISOString()
        });
        
      if (insertError) {
        console.error("Failed to create table:", insertError);
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Database Setup Required</title>
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
              .instructions {
                background: #202225;
                padding: 30px;
                border-radius: 10px;
                margin: 30px auto;
                max-width: 800px;
                text-align: left;
              }
            </style>
          </head>
          <body>
            <h1>Database Setup Required</h1>
            <div class="instructions">
              <p>The applications table doesn't exist in your Supabase database.</p>
              <p>Please run this SQL in your Supabase SQL Editor:</p>
              <pre style="background: #000; padding: 15px; border-radius: 5px; overflow-x: auto;">
CREATE TABLE applications (
  id BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  answers TEXT,
  conversation_log TEXT,
  questions_with_answers JSONB,
  score TEXT,
  total_questions INTEGER DEFAULT 8,
  correct_answers INTEGER DEFAULT 0,
  wrong_answers INTEGER DEFAULT 0,
  test_results JSONB,
  status TEXT DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_created_at ON applications(created_at DESC);
              </pre>
              <p>After creating the table, refresh this page.</p>
            </div>
          </body>
          </html>
        `);
      }
    }
    
    // Table created or already exists, redirect to admin page
    console.log("Table created successfully, redirecting...");
    return res.redirect('/admin');
    
  } catch (err) {
    console.error("Table creation error:", err);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Database Error</title></head>
      <body>
        <h1>Database Setup Error</h1>
        <p>${err.message}</p>
        <p>Please check your Supabase database configuration.</p>
      </body>
      </html>
    `);
  }
}

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

/* ================= ULTIMATE SUBMISSION ENDPOINT - ENHANCED WITH CONVERSATION LOGS ================= */

app.post("/submit-test-results", async (req, res) => {
  console.log("🚀 ULTIMATE SUBMISSION ENDPOINT CALLED");
  
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
      answersLength: answers ? answers.length : 0,
      conversationLogLength: conversationLog ? conversationLog.length : 0,
      qnaLength: questionsWithAnswers ? questionsWithAnswers.length : 0
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
    
    // Step 1: Enhanced Discord Webhook with conversation logs
    let webhookSuccess = false;
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        console.log("🌐 Sending enhanced webhook with conversation logs...");
        
        // Create embeds
        const embeds = [];
        
        // Main embed
        embeds.push({
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
            },
            {
              name: "📋 Detailed Logs",
              value: "Check conversation logs below ↓",
              inline: false
            }
          ],
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Mod Test System • Auto-saved to Admin Panel"
          },
          thumbnail: {
            url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
          }
        });
        
        // Conversation log embed (if available)
        if (conversationLog && conversationLog.length > 0) {
          let logContent = conversationLog;
          if (logContent.length > 4000) {
            logContent = logContent.substring(0, 3900) + "...\n[Log truncated due to length]";
          }
          
          embeds.push({
            title: "💬 CONVERSATION LOGS",
            description: `\`\`\`yaml\n${logContent}\n\`\`\``,
            color: 0x5865f2,
            footer: {
              text: `Full logs available in admin panel • ${conversationLog.length} characters`
            }
          });
        } else if (questionsWithAnswers && questionsWithAnswers.length > 0) {
          // Format Q&A
          let qnaContent = "";
          questionsWithAnswers.forEach((q, i) => {
            qnaContent += `Q${i+1}: ${q.question.substring(0, 50)}${q.question.length > 50 ? '...' : ''}\n`;
            qnaContent += `A${i+1}: ${q.answer.substring(0, 50)}${q.answer.length > 50 ? '...' : ''}\n`;
            qnaContent += `Status: ${q.correct ? '✅' : '❌'}\n\n`;
          });
          
          if (qnaContent.length > 3900) {
            qnaContent = qnaContent.substring(0, 3900) + "...\n[Q&A truncated]";
          }
          
          embeds.push({
            title: "❓ QUESTIONS & ANSWERS",
            description: `\`\`\`\n${qnaContent}\`\`\``,
            color: 0xf59e0b,
            footer: {
              text: `Full answers available in admin panel`
            }
          });
        }
        
        // Test results embed
        if (testResults && typeof testResults === 'object') {
          const resultsStr = JSON.stringify(testResults, null, 2);
          if (resultsStr.length > 1000) {
            embeds.push({
              title: "📈 TEST DETAILS",
              description: `\`\`\`json\n${resultsStr.substring(0, 900)}\n... [Full results in admin panel]\`\`\``,
              color: 0x8b5cf6
            });
          }
        }
        
        const webhookData = {
          embeds,
          username: "Void Test System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, webhookData);
        webhookSuccess = true;
        console.log("✅ Discord webhook sent successfully with conversation logs!");
      } catch (webhookError) {
        console.error("⚠️ Discord webhook error:", webhookError.message);
      }
    } else {
      console.log("ℹ️ No Discord webhook URL configured");
    }
    
    // Step 2: Save to database with conversation logs
    console.log("💾 Saving to database with conversation logs...");
    
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
    
    console.log("📊 Database data prepared with conversation logs");
    
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
        
        // Try without conversation_log field if it doesn't exist
        delete applicationData.conversation_log;
        delete applicationData.questions_with_answers;
        
        const { data: data2, error: error2 } = await supabase
          .from("applications")
          .insert([applicationData])
          .select();
        
        if (error2) {
          console.log("❌ Second insert failed:", error2.message);
        } else {
          console.log("✅ Insert successful!");
          dbSuccess = true;
          savedId = data2?.[0]?.id;
        }
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
      message: "✅ Test submitted successfully! Results saved with conversation logs.",
      details: {
        submissionId,
        user: discordUsername,
        score: score,
        discordWebhook: webhookSuccess ? "sent_with_logs" : "failed",
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

/* ================= ADMIN ACTIONS ENDPOINTS ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    console.log(`🔵 Accepting application ${req.params.id}`);
    
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
    
    // Check if user is a test user (shouldn't happen with filtering, but just in case)
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000';
    
    if (isTestUser) {
      return res.status(400).json({ 
        error: "Cannot accept test user applications",
        message: "Test users are filtered out and cannot be accepted."
      });
    }
    
    // Update status to accepted
    const { error: updateError } = await supabase
      .from("applications")
      .update({ 
        status: "accepted",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", req.params.id);
    
    if (updateError) {
      throw updateError;
    }
    
    console.log(`✅ Application ${req.params.id} marked as accepted`);
    
    // Assign mod role via Discord bot
    let roleAssigned = false;
    if (process.env.DISCORD_GUILD_ID && process.env.MOD_ROLE_ID) {
      roleAssigned = await assignModRole(application.discord_id);
      
      if (roleAssigned) {
        console.log(`🎉 Role assigned to ${application.discord_username}`);
      } else {
        console.log(`⚠️ Could not assign role to ${application.discord_username}`);
      }
    } else {
      console.log("⚠️ Discord guild ID or mod role ID not configured");
    }
    
    // Send webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "✅ APPLICATION ACCEPTED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Accepted by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: ACCEPTED\nRole Assignment: ${roleAssigned ? "SUCCESS" : "FAILED/NO CONFIG"}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
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
      message: "Application accepted successfully",
      roleAssigned: roleAssigned,
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
    console.log(`🔴 Rejecting application ${req.params.id}`);
    
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
    
    // Check if user is a test user
    const username = application.discord_username.toLowerCase();
    const id = application.discord_id;
    const isTestUser = username.includes('test') || id.includes('test') || username === 'user' || id === '0000';
    
    if (isTestUser) {
      console.log(`Skipping DM for test user: ${application.discord_username}`);
      
      // Still update status but don't send DM
      const { error: updateError } = await supabase
        .from("applications")
        .update({ 
          status: "rejected",
          updated_at: new Date().toISOString(),
          reviewed_by: req.session.user.username,
          reviewed_at: new Date().toISOString(),
          rejection_reason: req.body.reason || "Test user - auto-rejected"
        })
        .eq("id", req.params.id);
      
      if (updateError) throw updateError;
      
      return res.json({ 
        success: true, 
        message: "Test user application rejected (no DM sent)",
        dmSent: false,
        isTestUser: true
      });
    }
    
    // Update status to rejected
    const { error: updateError } = await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString(),
        rejection_reason: req.body.reason || "Not specified"
      })
      .eq("id", req.params.id);
    
    if (updateError) {
      throw updateError;
    }
    
    console.log(`❌ Application ${req.params.id} marked as rejected`);
    
    // Send rejection DM
    let dmSent = false;
    try {
      dmSent = await sendRejectionDM(application.discord_id, application.discord_username, req.body.reason || "Not specified");
    } catch (dmError) {
      console.error("DM error:", dmError);
    }
    
    // Send webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "❌ APPLICATION REJECTED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Rejected by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: REJECTED\nDM Sent: ${dmSent ? "SUCCESS" : "FAILED"}\nReason: ${req.body.reason || "Not specified"}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
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
║                VOID ESPORTS MOD TEST SERVER v2.0                    ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${PORT}                                  ║
║ 🤖 Discord Bot: ${bot.user ? "Connected" : "Connecting..."}        ║
║ 📝 SUBMISSION ENDPOINTS:                                            ║
║    • /api/submit (Simple & reliable)                                ║
║    • /submit-test-results (Ultimate with conversation logs)         ║
║ 👑 Admin Panel: /admin (with conversation logs & filtering)         ║
║    • Accept: Assigns mod role + welcome DM                          ║
║    • Reject: Sends rejection DM with reason                         ║
║ 🧪 Test Login: /auth/discord                                        ║
║ 🏥 Health Check: /health                                            ║
║ 📊 Database: ${process.env.SUPABASE_URL ? "CONFIGURED" : "NOT SETUP"}                    ║
║ 🔔 Discord Webhook: ${process.env.DISCORD_WEBHOOK_URL ? "READY" : "NOT SET"}            ║
║ 🏰 Discord Guild: ${process.env.DISCORD_GUILD_ID ? "CONFIGURED" : "NOT SET"}            ║
║ 🛡️ Mod Role: ${process.env.MOD_ROLE_ID ? "CONFIGURED" : "NOT SET"}                     ║
╚══════════════════════════════════════════════════════════════════════╝
  `);
});
