// Script to delete old commands from Discord
// Run this to remove old commands: node scripts/delete-old-commands.js

const { REST, Routes } = require('discord.js');

// Load environment variables
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available, use process.env directly
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

// Old command names to delete
const oldCommands = [
  'addquestion',
  'deletequestion',
  'editquestion',
  'listquestions',
  'testquestion',
  'viewquestion'
];

(async () => {
  try {
    if (!process.env.DISCORD_CLIENT_ID) {
      console.error('❌ DISCORD_CLIENT_ID not set');
      return;
    }

    console.log('🗑️  Deleting old commands...\n');

    let commandsToDelete = [];
    
    if (process.env.DISCORD_GUILD_ID) {
      // Get guild commands
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
      );
      
      console.log(`Found ${guildCommands.length} guild commands`);
      commandsToDelete = guildCommands.filter(cmd => oldCommands.includes(cmd.name));
      
      if (commandsToDelete.length > 0) {
        console.log(`\n🗑️  Deleting ${commandsToDelete.length} old guild commands:`);
        commandsToDelete.forEach(cmd => console.log(`   - /${cmd.name} (ID: ${cmd.id})`));
        
        // Delete each old command
        for (const cmd of commandsToDelete) {
          await rest.delete(
            Routes.applicationGuildCommand(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID, cmd.id)
          );
          console.log(`✅ Deleted /${cmd.name}`);
        }
      }
    } else {
      // Get global commands
      const globalCommands = await rest.get(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
      );
      
      console.log(`Found ${globalCommands.length} global commands`);
      commandsToDelete = globalCommands.filter(cmd => oldCommands.includes(cmd.name));
      
      if (commandsToDelete.length > 0) {
        console.log(`\n🗑️  Deleting ${commandsToDelete.length} old global commands:`);
        commandsToDelete.forEach(cmd => console.log(`   - /${cmd.name} (ID: ${cmd.id})`));
        
        // Delete each old command
        for (const cmd of commandsToDelete) {
          await rest.delete(
            Routes.applicationCommand(process.env.DISCORD_CLIENT_ID, cmd.id)
          );
          console.log(`✅ Deleted /${cmd.name}`);
        }
      }
    }

    if (commandsToDelete.length === 0) {
      console.log('✅ No old commands found to delete');
    } else {
      console.log(`\n✅ Successfully deleted ${commandsToDelete.length} old command(s)`);
      console.log('\n📝 Now deploy new commands: npm run deploy-commands');
    }
  } catch (error) {
    console.error('❌ Error deleting old commands:', error);
    if (error.message) console.error('Error:', error.message);
  }
})();
