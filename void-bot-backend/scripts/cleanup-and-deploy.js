// Complete cleanup and deployment script
// This deletes old commands and deploys new ones
// Run: node scripts/cleanup-and-deploy.js

const { REST, Routes } = require('discord.js');

// Load environment variables
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available
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

// New commands to deploy
const slashCommands = require('../commands/slashCommands');
const newCommands = [
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

(async () => {
  try {
    if (!process.env.DISCORD_CLIENT_ID) {
      console.error('❌ DISCORD_CLIENT_ID not set');
      return;
    }

    console.log('🧹 Step 1: Cleaning up old commands...\n');

    let deletedCount = 0;
    
    if (process.env.DISCORD_GUILD_ID) {
      // Get guild commands
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
      );
      
      console.log(`Found ${guildCommands.length} guild commands`);
      
      // Delete old commands
      for (const cmd of guildCommands) {
        if (oldCommands.includes(cmd.name)) {
          await rest.delete(
            Routes.applicationGuildCommand(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID, cmd.id)
          );
          console.log(`✅ Deleted old command: /${cmd.name}`);
          deletedCount++;
        }
      }
      
      // Deploy new commands
      console.log(`\n🚀 Step 2: Deploying ${newCommands.length} new commands...\n`);
      const data = await rest.put(
        Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
        { body: newCommands }
      );
      console.log(`✅ Successfully deployed ${data.length} guild commands:`);
      data.forEach(cmd => console.log(`   - /${cmd.name}`));
      
    } else {
      // Get global commands
      const globalCommands = await rest.get(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
      );
      
      console.log(`Found ${globalCommands.length} global commands`);
      
      // Delete old commands
      for (const cmd of globalCommands) {
        if (oldCommands.includes(cmd.name)) {
          await rest.delete(
            Routes.applicationCommand(process.env.DISCORD_CLIENT_ID, cmd.id)
          );
          console.log(`✅ Deleted old command: /${cmd.name}`);
          deletedCount++;
        }
      }
      
      // Deploy new commands
      console.log(`\n🚀 Step 2: Deploying ${newCommands.length} new commands...\n`);
      const data = await rest.put(
        Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
        { body: newCommands }
      );
      console.log(`✅ Successfully deployed ${data.length} global commands:`);
      data.forEach(cmd => console.log(`   - /${cmd.name}`));
    }

    console.log(`\n✅ Complete! Deleted ${deletedCount} old command(s), deployed ${newCommands.length} new command(s)`);
    console.log('\n📝 Commands should appear in Discord within 1-2 minutes (instant for guild commands)');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (error.message) console.error('Message:', error.message);
    if (error.stack) console.error('Stack:', error.stack);
  }
})();
