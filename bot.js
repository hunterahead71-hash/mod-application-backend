// bot.js
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActivityType } = require("discord.js");

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

let botReady = false;

// Bot ready event
bot.on('ready', () => {
  botReady = true;
  console.log(`✅ Bot logged in as ${bot.user.tag}`);

  bot.user.setPresence({
    activities: [{ name: 'Mod Applications', type: ActivityType.Watching }],
    status: 'online'
  });
});

// Login with retry
async function loginBot() {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error("DISCORD_BOT_TOKEN missing");
    return;
  }

  try {
    await bot.login(process.env.DISCORD_BOT_TOKEN);
  } catch (err) {
    console.error("Bot login failed:", err.message);
    setTimeout(loginBot, 10000); // retry after 10s
  }
}

loginBot();

// Export functions
async function assignModRole(discordId, discordUsername = 'User') {
  if (!botReady) return { success: false, error: "Bot not ready" };

  try {
    const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const role = await guild.roles.fetch(process.env.MOD_ROLE_ID);

    if (!member || !role) return { success: false, error: "Member or role not found" };

    const botMember = await guild.members.fetch(bot.user.id);
    if (role.position >= botMember.roles.highest.position) {
      return { success: false, error: "Bot role must be higher than mod role" };
    }

    if (member.roles.cache.has(role.id)) {
      return { success: true, message: "Already has role" };
    }

    await member.roles.add(role);
    console.log(`Role assigned to ${discordUsername}`);

    // Send DM (non-blocking)
    sendDMToUser(discordId, discordUsername, true);

    return { success: true };
  } catch (err) {
    console.error("Role assign error:", err);
    return { success: false, error: err.message };
  }
}

async function sendDMToUser(discordId, username, isAccept = true) {
  try {
    const user = await bot.users.fetch(discordId);
    const embed = new EmbedBuilder()
      .setTitle(isAccept ? "🎉 Welcome to Mod Team!" : "❌ Application Update")
      .setDescription(isAccept 
        ? `Congratulations ${username}! You are now a Moderator.\n\nRead #staff-rules-and-info`
        : `Your application was not approved at this time.\n\nYou can reapply in 30 days.`
      )
      .setColor(isAccept ? 0x3ba55c : 0xed4245)
      .setTimestamp();

    await user.send({ embeds: [embed] });
  } catch (err) {
    console.log(`DM failed for ${username}:`, err.message);
  }
}

module.exports = { assignModRole, sendDMToUser, bot };
