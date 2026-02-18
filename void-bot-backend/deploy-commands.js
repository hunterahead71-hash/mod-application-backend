const { REST, Routes } = require('discord.js');
const questionCommands = require('./commands/questionCommands');

const commands = [
    questionCommands.addQuestion.data.toJSON(),
    questionCommands.listQuestions.data.toJSON(),
    questionCommands.viewQuestion.data.toJSON(),
    questionCommands.editQuestion.data.toJSON(),
    questionCommands.deleteQuestion.data.toJSON(),
    questionCommands.testQuestion.data.toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        console.log('Registering slash commands...');
        
        await rest.put(
            Routes.applicationGuildCommands(
                process.env.DISCORD_CLIENT_ID, 
                process.env.DISCORD_GUILD_ID
            ),
            { body: commands }
        );
        
        console.log('✅ Commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
})();
