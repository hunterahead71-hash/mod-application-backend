// Test script to verify all commands are properly structured
const slashCommands = require('../commands/slashCommands');

console.log('🧪 Testing command structure...\n');

const commands = [
  { name: 'test-question', cmd: slashCommands.testQuestionCommand },
  { name: 'cert-role', cmd: slashCommands.certRoleCommand },
  { name: 'cert-analytics', cmd: slashCommands.analyticsCommand },
  { name: 'cert-bulk', cmd: slashCommands.bulkCommand },
  { name: 'cert-simulate', cmd: slashCommands.simulateCommand },
  { name: 'cert-question-stats', cmd: slashCommands.questionStatsCommand },
  { name: 'cert-quick', cmd: slashCommands.quickActionsCommand },
  { name: 'cert-status', cmd: slashCommands.botStatusCommand },
  { name: 'cert-help', cmd: slashCommands.helpCommand }
];

let allValid = true;

commands.forEach(({ name, cmd }) => {
  try {
    if (!cmd || !cmd.data) {
      console.log(`❌ ${name}: Missing data property`);
      allValid = false;
      return;
    }

    const json = cmd.data.toJSON();
    if (!json.name || !json.description) {
      console.log(`❌ ${name}: Missing name or description`);
      allValid = false;
      return;
    }

    if (!cmd.execute || typeof cmd.execute !== 'function') {
      console.log(`❌ ${name}: Missing execute function`);
      allValid = false;
      return;
    }

    console.log(`✅ ${name}: Valid`);
    console.log(`   Description: ${json.description}`);
    console.log(`   Options: ${json.options?.length || 0}`);
  } catch (error) {
    console.log(`❌ ${name}: Error - ${error.message}`);
    allValid = false;
  }
});

console.log(`\n${allValid ? '✅ All commands are valid!' : '❌ Some commands have errors'}`);
