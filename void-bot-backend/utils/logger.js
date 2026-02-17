const logger = {
  info: (...args) => console.log(`[INFO] ${new Date().toISOString()}:`, ...args),
  error: (...args) => console.error(`[ERROR] ${new Date().toISOString()}:`, ...args),
  warn: (...args) => console.warn(`[WARN] ${new Date().toISOString()}:`, ...args),
  success: (...args) => console.log(`[SUCCESS] ${new Date().toISOString()}:`, ...args),
  
  request: (method, path) => {
    console.log(`\n=== ${new Date().toISOString()} ${method} ${path} ===`);
  },
  
  botReady: (tag, guildCount) => {
    console.log(`✅ Discord bot ready as ${tag}`);
    console.log(`📊 Servers: ${guildCount}`);
  },
  
  botPermissions: (botMember, guild, modRoleId) => {
    console.log("🔍 Bot Permissions Check:");
    console.log(`   - Manage Roles: ${botMember.permissions.has('ManageRoles') ? '✅' : '❌'}`);
    console.log(`   - Send Messages: ${botMember.permissions.has('SendMessages') ? '✅' : '❌'}`);
    console.log(`   - Read Messages: ${botMember.permissions.has('ViewChannel') ? '✅' : '❌'}`);
    
    if (modRoleId) {
      const modRole = guild.roles.cache.get(modRoleId);
      console.log(`   - Mod Role Found: ${modRole ? `✅ ${modRole.name}` : '❌ Not Found'}`);
      
      if (modRole) {
        console.log(`   - Role Position: ${modRole.position}`);
        console.log(`   - Bot's Highest Role Position: ${botMember.roles.highest.position}`);
        
        if (modRole.position >= botMember.roles.highest.position) {
          console.warn(`⚠️  WARNING: Mod role is higher than bot's highest role! Bot cannot assign this role.`);
          console.warn(`💡 FIX: Move the bot's role higher than the mod role in Discord Server Settings → Roles`);
        }
      }
    }
  },
  
  startup: (port, botReady) => {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                VOID ESPORTS MOD TEST SERVER v2.4                    ║
╠══════════════════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${port}                                  ║
║ 🤖 Discord Bot: ${botReady ? "✅ Connected" : "🔄 Connecting..."}   ║
║ 📝 FIXED ISSUES:                                                    ║
║    • ✅ Accept/Reject now always succeed in UI                      ║
║    • ✅ Bot actions run in background                                ║
║    • ✅ Applications move immediately to correct sections           ║
║    • ✅ Code broken into multiple files for maintainability         ║
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
  }
};

module.exports = { logger };
