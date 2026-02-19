// Standalone command deployment script
// Run this separately to deploy commands: node deploy-commands.js

const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [
  require('./commands/slashCommands').testQuestionCommand.data.toJSON(),
  require('./commands/slashCommands').certRoleCommand.data.toJSON(),
  require('./commands/slashCommands').analyticsCommand.data.toJSON(),
  require('./commands/slashCommands').bulkCommand.data.toJSON(),
  require('./commands/slashCommands').simulateCommand.data.toJSON(),
  require('./commands/slashCommands').questionStatsCommand.data.toJSON(),
  require('./commands/slashCommands').quickActionsCommand.data.toJSON()
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
