const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { supabase } = require('../config/supabase');
const { logger } = require('../utils/logger');

module.exports = {
    // ==================== /addquestion COMMAND ====================
    addQuestion: {
        data: new SlashCommandBuilder()
            .setName('addquestion')
            .setDescription('Add a new certification test question')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('The user message/question')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('The username of the person asking')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('color')
                    .setDescription('Avatar color (hex code, e.g., #5865f2)')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('keywords')
                    .setDescription('Comma-separated keywords to look for')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('explanation')
                    .setDescription('Explanation/feedback for correct answer')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('matches')
                    .setDescription('Number of keywords required (default: 2)')
                    .setRequired(false)),
        
        async execute(interaction) {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const message = interaction.options.getString('message');
                const username = interaction.options.getString('username');
                const color = interaction.options.getString('color');
                const keywordsString = interaction.options.getString('keywords');
                const matches = interaction.options.getInteger('matches') || 2;
                const explanation = interaction.options.getString('explanation');
                
                // Validate hex color
                const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
                if (!hexColorRegex.test(color)) {
                    return interaction.editReply('❌ Invalid color format. Use hex code like #5865f2');
                }
                
                // Parse keywords
                const keywords = keywordsString.split(',').map(k => k.trim()).filter(k => k);
                if (keywords.length === 0) {
                    return interaction.editReply('❌ Please provide at least one keyword');
                }
                
                // Insert into database
                const { data, error } = await supabase
                    .from('test_questions')
                    .insert([{
                        user_message: message,
                        username: username,
                        avatar_color: color,
                        keywords: keywords,
                        required_matches: matches,
                        explanation: explanation,
                        enabled: true,
                        created_by: interaction.user.tag,
                        updated_at: new Date().toISOString()
                    }])
                    .select();
                
                if (error) {
                    logger.error('Database error:', error);
                    return interaction.editReply('❌ Failed to add question. Check logs.');
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Question Added Successfully')
                    .setColor(0x10b981)
                    .addFields(
                        { name: 'ID', value: data[0].id.toString(), inline: true },
                        { name: 'Username', value: username, inline: true },
                        { name: 'Message', value: message.substring(0, 50) + (message.length > 50 ? '...' : '') },
                        { name: 'Keywords', value: keywords.join(', ') },
                        { name: 'Required Matches', value: matches.toString(), inline: true }
                    )
                    .setFooter({ text: `Added by ${interaction.user.tag}` })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                
                // Optional: Log to channel if configured
                if (process.env.LOG_CHANNEL_ID) {
                    try {
                        const logChannel = await interaction.guild.channels.fetch(process.env.LOG_CHANNEL_ID);
                        if (logChannel) {
                            const logEmbed = new EmbedBuilder()
                                .setTitle('📝 New Test Question Added')
                                .setColor(0x5865f2)
                                .addFields(
                                    { name: 'Added By', value: interaction.user.tag },
                                    { name: 'Question ID', value: data[0].id.toString() },
                                    { name: 'Preview', value: `"${message.substring(0, 100)}"` }
                                )
                                .setTimestamp();
                            
                            await logChannel.send({ embeds: [logEmbed] });
                        }
                    } catch (logError) {
                        // Silently fail if log channel doesn't exist
                    }
                }
                
            } catch (error) {
                logger.error('Add question error:', error);
                await interaction.editReply('❌ An error occurred while adding the question.');
            }
        }
    },

    // ==================== /listquestions COMMAND ====================
    listQuestions: {
        data: new SlashCommandBuilder()
            .setName('listquestions')
            .setDescription('List all certification test questions')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addIntegerOption(option =>
                option.setName('page')
                    .setDescription('Page number')
                    .setRequired(false)),
        
        async execute(interaction) {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const page = interaction.options.getInteger('page') || 1;
                const pageSize = 10;
                const start = (page - 1) * pageSize;
                
                // Get total count
                const { count } = await supabase
                    .from('test_questions')
                    .select('*', { count: 'exact', head: true });
                
                // Get paginated questions
                const { data: questions, error } = await supabase
                    .from('test_questions')
                    .select('*')
                    .order('id', { ascending: true })
                    .range(start, start + pageSize - 1);
                
                if (error) {
                    return interaction.editReply('❌ Failed to fetch questions.');
                }
                
                if (!questions || questions.length === 0) {
                    return interaction.editReply('📭 No questions found.');
                }
                
                const totalPages = Math.ceil(count / pageSize);
                
                const embed = new EmbedBuilder()
                    .setTitle('📋 Certification Test Questions')
                    .setColor(0x5865f2)
                    .setDescription(`Page ${page} of ${totalPages} | Total: ${count} questions`);
                
                questions.forEach(q => {
                    const status = q.enabled ? '✅' : '❌';
                    embed.addFields({
                        name: `ID: ${q.id} ${status}`,
                        value: `**User:** ${q.username}\n**Message:** ${q.user_message.substring(0, 50)}...\n**Keywords:** ${q.keywords.join(', ')}`,
                        inline: false
                    });
                });
                
                embed.setFooter({ text: 'Use /viewquestion id:XX to see full details' });
                
                await interaction.editReply({ embeds: [embed] });
                
            } catch (error) {
                logger.error('List questions error:', error);
                await interaction.editReply('❌ An error occurred while listing questions.');
            }
        }
    },

    // ==================== /viewquestion COMMAND ====================
    viewQuestion: {
        data: new SlashCommandBuilder()
            .setName('viewquestion')
            .setDescription('View full details of a specific question')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Question ID')
                    .setRequired(true)),
        
        async execute(interaction) {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const id = interaction.options.getInteger('id');
                
                const { data: question, error } = await supabase
                    .from('test_questions')
                    .select('*')
                    .eq('id', id)
                    .single();
                
                if (error || !question) {
                    return interaction.editReply(`❌ Question with ID ${id} not found.`);
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(`📝 Question #${question.id}`)
                    .setColor(question.avatar_color || '#5865f2')
                    .addFields(
                        { name: 'Username', value: question.username, inline: true },
                        { name: 'Avatar Color', value: question.avatar_color || '#5865f2', inline: true },
                        { name: 'Status', value: question.enabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                        { name: 'Message', value: question.user_message },
                        { name: 'Keywords', value: question.keywords.join(', ') },
                        { name: 'Required Matches', value: question.required_matches.toString(), inline: true },
                        { name: 'Explanation', value: question.explanation || 'No explanation provided' },
                        { name: 'Added By', value: question.created_by || 'Unknown', inline: true },
                        { name: 'Last Updated', value: new Date(question.updated_at).toLocaleString(), inline: true }
                    )
                    .setFooter({ text: 'Use /editquestion to modify' });
                
                await interaction.editReply({ embeds: [embed] });
                
            } catch (error) {
                logger.error('View question error:', error);
                await interaction.editReply('❌ An error occurred while fetching the question.');
            }
        }
    },

    // ==================== /editquestion COMMAND ====================
    editQuestion: {
        data: new SlashCommandBuilder()
            .setName('editquestion')
            .setDescription('Edit an existing question')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Question ID to edit')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('New message text')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('New username')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('color')
                    .setDescription('New avatar color')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('keywords')
                    .setDescription('New keywords (comma-separated)')
                    .setRequired(false))
            .addIntegerOption(option =>
                option.setName('matches')
                    .setDescription('New required matches count')
                    .setRequired(false))
            .addStringOption(option =>
                option.setName('explanation')
                    .setDescription('New explanation')
                    .setRequired(false))
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('Enable/disable question')
                    .setRequired(false)),
        
        async execute(interaction) {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const id = interaction.options.getInteger('id');
                
                // Build update object with only provided fields
                const updates = {};
                if (interaction.options.getString('message')) updates.user_message = interaction.options.getString('message');
                if (interaction.options.getString('username')) updates.username = interaction.options.getString('username');
                if (interaction.options.getString('color')) {
                    const color = interaction.options.getString('color');
                    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
                    if (!hexColorRegex.test(color)) {
                        return interaction.editReply('❌ Invalid color format. Use hex code like #5865f2');
                    }
                    updates.avatar_color = color;
                }
                if (interaction.options.getString('keywords')) {
                    updates.keywords = interaction.options.getString('keywords').split(',').map(k => k.trim()).filter(k => k);
                }
                if (interaction.options.getInteger('matches')) updates.required_matches = interaction.options.getInteger('matches');
                if (interaction.options.getString('explanation')) updates.explanation = interaction.options.getString('explanation');
                if (interaction.options.getBoolean('enabled') !== null) updates.enabled = interaction.options.getBoolean('enabled');
                
                updates.updated_at = new Date().toISOString();
                
                if (Object.keys(updates).length === 1) { // Only updated_at
                    return interaction.editReply('❌ No fields to update. Provide at least one field to edit.');
                }
                
                const { data, error } = await supabase
                    .from('test_questions')
                    .update(updates)
                    .eq('id', id)
                    .select();
                
                if (error) {
                    return interaction.editReply(`❌ Failed to update question: ${error.message}`);
                }
                
                if (!data || data.length === 0) {
                    return interaction.editReply(`❌ Question with ID ${id} not found.`);
                }
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Question Updated Successfully')
                    .setColor(0x10b981)
                    .addFields(
                        { name: 'ID', value: id.toString(), inline: true },
                        { name: 'Updated Fields', value: Object.keys(updates).filter(k => k !== 'updated_at').join(', ') }
                    )
                    .setFooter({ text: `Updated by ${interaction.user.tag}` })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
                
            } catch (error) {
                logger.error('Edit question error:', error);
                await interaction.editReply('❌ An error occurred while editing the question.');
            }
        }
    },

    // ==================== /deletequestion COMMAND ====================
    deleteQuestion: {
        data: new SlashCommandBuilder()
            .setName('deletequestion')
            .setDescription('Delete a question (soft delete by disabling)')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Question ID to delete')
                    .setRequired(true))
            .addBooleanOption(option =>
                option.setName('permanent')
                    .setDescription('Permanently delete from database')
                    .setRequired(false)),
        
        async execute(interaction) {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const id = interaction.options.getInteger('id');
                const permanent = interaction.options.getBoolean('permanent') || false;
                
                if (permanent) {
                    // Permanent delete
                    const { error } = await supabase
                        .from('test_questions')
                        .delete()
                        .eq('id', id);
                    
                    if (error) {
                        return interaction.editReply(`❌ Failed to delete question: ${error.message}`);
                    }
                    
                    await interaction.editReply(`✅ Question #${id} permanently deleted.`);
                    
                } else {
                    // Soft delete (disable)
                    const { error } = await supabase
                        .from('test_questions')
                        .update({ enabled: false, updated_at: new Date().toISOString() })
                        .eq('id', id);
                    
                    if (error) {
                        return interaction.editReply(`❌ Failed to disable question: ${error.message}`);
                    }
                    
                    await interaction.editReply(`✅ Question #${id} disabled. Use /editquestion id:${id} enabled:true to re-enable.`);
                }
                
            } catch (error) {
                logger.error('Delete question error:', error);
                await interaction.editReply('❌ An error occurred while deleting the question.');
            }
        }
    },

    // ==================== /testquestion COMMAND ====================
    testQuestion: {
        data: new SlashCommandBuilder()
            .setName('testquestion')
            .setDescription('Test how a question would evaluate an answer')
            .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
            .addIntegerOption(option =>
                option.setName('id')
                    .setDescription('Question ID to test')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('answer')
                    .setDescription('Test answer to evaluate')
                    .setRequired(true)),
        
        async execute(interaction) {
            await interaction.deferReply({ ephemeral: true });
            
            try {
                const id = interaction.options.getInteger('id');
                const answer = interaction.options.getString('answer');
                
                const { data: question, error } = await supabase
                    .from('test_questions')
                    .select('*')
                    .eq('id', id)
                    .single();
                
                if (error || !question) {
                    return interaction.editReply(`❌ Question with ID ${id} not found.`);
                }
                
                const answerLower = answer.toLowerCase();
                let matches = 0;
                let matchedKeywords = [];
                
                for (const keyword of question.keywords) {
                    if (answerLower.includes(keyword.toLowerCase())) {
                        matches++;
                        matchedKeywords.push(keyword);
                    }
                }
                
                const passed = matches >= question.required_matches;
                
                const embed = new EmbedBuilder()
                    .setTitle(passed ? '✅ Test Passed' : '❌ Test Failed')
                    .setColor(passed ? 0x10b981 : 0xed4245)
                    .addFields(
                        { name: 'Question', value: question.user_message },
                        { name: 'Test Answer', value: answer.substring(0, 100) + (answer.length > 100 ? '...' : '') },
                        { name: 'Matches Found', value: `${matches}/${question.required_matches}` },
                        { name: 'Matched Keywords', value: matchedKeywords.length > 0 ? matchedKeywords.join(', ') : 'None' },
                        { name: 'Expected', value: question.explanation || 'Follow protocol' }
                    )
                    .setFooter({ text: `Question ID: ${id}` });
                
                await interaction.editReply({ embeds: [embed] });
                
            } catch (error) {
                logger.error('Test question error:', error);
                await interaction.editReply('❌ An error occurred while testing the question.');
            }
        }
    }
};
