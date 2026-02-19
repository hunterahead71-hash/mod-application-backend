// Standalone command deployment script
// Run this separately to deploy commands: node deploy-commands.js
// Or use: npm run deploy-commands

const { REST, Routes } = require('discord.js');

// Load environment variables
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available, use process.env directly
}

const slashCommands = require('./commands/slashCommands');

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

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  try {
    console.log(`🚀 Started refreshing ${commands.length} application (/) commands.`);

    let data;
    if (process.env.DISCORD_GUILD_ID) {
      // Deploy to specific guild (faster, instant)
      data = await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: commands }
      );
      console.log(`✅ Successfully reloaded ${data.length} guild commands.`);
    } else {
      // Deploy globally (takes up to 1 hour)
      data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: commands }
      );
      console.log(`✅ Successfully reloaded ${data.length} global commands.`);
    }
  } catch (error) {
    console.error('❌ Error deploying commands:', error);
  }
})();
