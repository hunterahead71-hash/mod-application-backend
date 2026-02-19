const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { supabase } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { getDMTemplate } = require('../utils/discordHelpers');
const { logToChannel } = require('../utils/channelLogger');

async function safeLog(...args) {
  try {
    const fn = typeof logToChannel === 'function' ? logToChannel : require('../utils/channelLogger').logToChannel;
    return await fn(...args);
  } catch (e) {
    logger.warn('Channel log failed:', e.message);
    return false;
  }
}

// ==================== PERMISSION CHECK ====================
async function isAdmin(member) {
  if (!member) return false;
  
  // Check for specific admin role (1474083665293217914)
  const ADMIN_ROLE_ID = '1474083665293217914';
  if (member.roles.cache.has(ADMIN_ROLE_ID)) {
    return true;
  }
  
  // Also check if user has Administrator permission (fallback)
  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  
  // Check for admin role IDs from env (comma-separated) as additional fallback
  if (process.env.ADMIN_ROLE_IDS) {
    const adminRoleIds = process.env.ADMIN_ROLE_IDS.split(',').map(id => id.trim());
    if (adminRoleIds.some(roleId => member.roles.cache.has(roleId))) {
      return true;
    }
  }
  
  return false;
}

// ==================== TEST QUESTION COMMAND (ALL SUBCOMMANDS) ====================
const testQuestionCommand = {
  data: new SlashCommandBuilder()
    .setName('test-question')
    .setDescription('Manage certification test questions')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a new test question')
        .addStringOption(option =>
          option.setName('text')
            .setDescription('The user message/question text')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('username')
            .setDescription('Username to display (default: User)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('keywords')
            .setDescription('Comma-separated keywords (e.g., age,roster,requirement)')
            .setRequired(false))
        .addIntegerOption(option =>
          option.setName('required_matches')
            .setDescription('Required keyword matches (default: 2)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('explanation')
            .setDescription('Explanation/feedback for this question')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('Edit a test question')
        .addIntegerOption(option =>
          option.setName('id')
            .setDescription('Question ID')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('text')
            .setDescription('New question text')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('username')
            .setDescription('Username to display')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('keywords')
            .setDescription('Comma-separated keywords (e.g., age,roster,requirement)')
            .setRequired(false))
        .addIntegerOption(option =>
          option.setName('required_matches')
            .setDescription('Required keyword matches')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('explanation')
            .setDescription('Explanation/feedback for this question')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a test question')
        .addIntegerOption(option =>
          option.setName('id')
            .setDescription('Question ID to delete')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all test questions'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reorder')
        .setDescription('Reorder a test question')
        .addIntegerOption(option =>
          option.setName('id')
            .setDescription('Question ID')
            .setRequired(true))
        .addIntegerOption(option =>
          option.setName('position')
            .setDescription('New position (0-based)')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable')
        .setDescription('Enable a test question')
        .addIntegerOption(option =>
          option.setName('id')
            .setDescription('Question ID')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable a test question')
        .addIntegerOption(option =>
          option.setName('id')
            .setDescription('Question ID')
            .setRequired(true))),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You are not an admin. Contact support or nick for help.' 
      });
    }

    // This command has subcommands, get it
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'add') {
        const text = interaction.options.getString('text');
        const username = interaction.options.getString('username') || 'User';
        const keywordsStr = interaction.options.getString('keywords') || '';
        const requiredMatches = interaction.options.getInteger('required_matches') || 2;
        const explanation = interaction.options.getString('explanation') || '';

        const keywords = keywordsStr.split(',').map(k => k.trim()).filter(k => k);
        const { data, error } = await supabase
          .from('test_questions')
          .insert([{
            user_message: text,
            username: username,
            avatar_color: '#5865f2',
            keywords: keywords,
            required_matches: requiredMatches,
            explanation: explanation,
            enabled: true
          }])
          .select();

        if (error) {
          logger.error('Error adding question:', error);
          return interaction.editReply({ 
            content: `❌ Error adding question: ${error.message}` 
          });
        }

        // Log to channel
        await safeLog(
          '📝 Question Added',
          `A new test question was added by ${interaction.user.tag}`,
          0x5865f2,
          [
            { name: '🆔 Question ID', value: String(data[0].id), inline: true },
            { name: '👤 Username', value: username, inline: true },
            { name: '📝 Question Text', value: text.substring(0, 500), inline: false },
            { name: '🔑 Keywords', value: keywords.length > 0 ? keywords.join(', ') : 'None', inline: false },
            { name: '🎯 Required Matches', value: String(requiredMatches), inline: true }
          ]
        );

        await interaction.editReply({ 
          content: `✅ Question added successfully!\n**ID:** ${data[0].id}\n**Text:** ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}` 
        });

      } else if (subcommand === 'edit') {
        const id = interaction.options.getInteger('id');
        const newText = interaction.options.getString('text');
        const username = interaction.options.getString('username');
        const keywordsStr = interaction.options.getString('keywords');
        const requiredMatches = interaction.options.getInteger('required_matches');
        const explanation = interaction.options.getString('explanation');

        // Build update object with only provided fields
        const updateData = {};
        if (newText !== null) updateData.user_message = newText;
        if (username !== null) updateData.username = username;
        if (keywordsStr !== null) {
          updateData.keywords = keywordsStr.split(',').map(k => k.trim()).filter(k => k);
        }
        if (requiredMatches !== null) updateData.required_matches = requiredMatches;
        if (explanation !== null) updateData.explanation = explanation;

        if (Object.keys(updateData).length === 0) {
          return interaction.editReply({ 
            content: `❌ No fields provided to update. Please provide at least one field (text, username, keywords, required_matches, or explanation).` 
          });
        }

        const { data, error } = await supabase
          .from('test_questions')
          .update(updateData)
          .eq('id', id)
          .select();

        if (error) {
          return interaction.editReply({ 
            content: `❌ Error updating question: ${error.message}` 
          });
        }

        if (!data || data.length === 0) {
          return interaction.editReply({ 
            content: `❌ Question with ID ${id} not found.` 
          });
        }

        // Build log fields
        const logFields = [{ name: '🆔 Question ID', value: String(id), inline: true }];
        if (newText !== null) logFields.push({ name: '📝 New Text', value: newText.substring(0, 500), inline: false });
        if (username !== null) logFields.push({ name: '👤 Username', value: username, inline: true });
        if (keywordsStr !== null) logFields.push({ name: '🔑 Keywords', value: updateData.keywords.join(', ') || 'None', inline: false });
        if (requiredMatches !== null) logFields.push({ name: '🎯 Required Matches', value: String(requiredMatches), inline: true });
        if (explanation !== null) logFields.push({ name: '📖 Explanation', value: explanation.substring(0, 500), inline: false });

        // Log to channel
        await safeLog(
          '✏️ Question Edited',
          `Question #${id} was edited by ${interaction.user.tag}`,
          0x5865f2,
          logFields
        );

        await interaction.editReply({ 
          content: `✅ Question ${id} updated successfully!` 
        });

      } else if (subcommand === 'delete') {
        const id = interaction.options.getInteger('id');

        const { error } = await supabase
          .from('test_questions')
          .delete()
          .eq('id', id);

        if (error) {
          return interaction.editReply({ 
            content: `❌ Error deleting question: ${error.message}` 
          });
        }

        // Log to channel
        await safeLog(
          '🗑️ Question Deleted',
          `Question #${id} was deleted by ${interaction.user.tag}`,
          0xed4245,
          [
            { name: '🆔 Question ID', value: String(id), inline: true }
          ]
        );

        await interaction.editReply({ 
          content: `✅ Question ${id} deleted successfully!` 
        });

      } else if (subcommand === 'list') {
        const { data, error } = await supabase
          .from('test_questions')
          .select('*')
          .order('id', { ascending: true });

        if (error) {
          return interaction.editReply({ 
            content: `❌ Error fetching questions: ${error.message}` 
          });
        }

        if (!data || data.length === 0) {
          return interaction.editReply({ 
            content: '📋 No questions found. Use `/test-question add` to add questions.' 
          });
        }

        const enabledCount = data.filter(q => q.enabled).length;
        const disabledCount = data.length - enabledCount;

        const embed = new EmbedBuilder()
          .setTitle('📋 Test Questions')
          .setDescription(`Total: ${data.length} | Enabled: ${enabledCount} | Disabled: ${disabledCount}`)
          .setColor(0x5865f2);

        let description = '';
        data.slice(0, 10).forEach(q => {
          const status = q.enabled ? '✅' : '❌';
          description += `${status} **#${q.id}** - ${q.user_message.substring(0, 60)}${q.user_message.length > 60 ? '...' : ''}\n`;
        });

        if (data.length > 10) {
          description += `\n... and ${data.length - 10} more`;
        }

        embed.setDescription(description);

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'reorder') {
        await interaction.editReply({ 
          content: '⚠️ Manual question ordering is not enabled on this database. Questions are currently ordered by ID.' 
        });

      } else if (subcommand === 'enable') {
        const id = interaction.options.getInteger('id');

        const { error } = await supabase
          .from('test_questions')
          .update({ enabled: true })
          .eq('id', id);

        if (error) {
          return interaction.editReply({ 
            content: `❌ Error enabling question: ${error.message}` 
          });
        }

        // Log to channel
        await safeLog(
          '✅ Question Enabled',
          `Question #${id} was enabled by ${interaction.user.tag}`,
          0x10b981,
          [
            { name: '🆔 Question ID', value: String(id), inline: true }
          ]
        );

        await interaction.editReply({ 
          content: `✅ Question ${id} enabled!` 
        });

      } else if (subcommand === 'disable') {
        const id = interaction.options.getInteger('id');

        const { error } = await supabase
          .from('test_questions')
          .update({ enabled: false })
          .eq('id', id);

        if (error) {
          return interaction.editReply({ 
            content: `❌ Error disabling question: ${error.message}` 
          });
        }

        // Log to channel
        await safeLog(
          '❌ Question Disabled',
          `Question #${id} was disabled by ${interaction.user.tag}`,
          0xed4245,
          [
            { name: '🆔 Question ID', value: String(id), inline: true }
          ]
        );

        await interaction.editReply({ 
          content: `✅ Question ${id} disabled!` 
        });
      }
    } catch (error) {
      logger.error(`test-question ${subcommand} error:`, error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}\n\nIf this persists, check server logs.` 
      });
    }
  }
};

// ==================== CERT ROLE COMMAND (ALL SUBCOMMANDS) ====================
const certRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-role')
    .setDescription('Manage certification roles')
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a role to be assigned on certification acceptance')
        .addStringOption(option =>
          option.setName('role')
            .setDescription('Role mention or ID')
            .setRequired(true))
        .addStringOption(option =>
          option.setName('description')
            .setDescription('Description of this role')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a certification role')
        .addStringOption(option =>
          option.setName('role')
            .setDescription('Role mention or ID')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all certification roles')),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You are not an admin. Contact support or nick for help.' 
      });
    }

    // This command has subcommands, get it
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'add') {
        const roleInput = interaction.options.getString('role');
        const description = interaction.options.getString('description') || '';

        let roleId = roleInput;
        if (roleInput.startsWith('<@&') && roleInput.endsWith('>')) {
          roleId = roleInput.slice(3, -1);
        }

        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          return interaction.editReply({ 
            content: `❌ Role not found. Please provide a valid role mention or ID.` 
          });
        }

        let existing = null;
        try {
          const { data } = await supabase
            .from('mod_roles')
            .select('*')
            .eq('role_id', roleId)
            .single();
          existing = data;
        } catch (dbError) {
          // If mod_roles table does not exist, fall back to env-based roles only
          if (dbError?.message?.includes("mod_roles")) {
            return interaction.editReply({
              content: '⚠️ The `mod_roles` table is not set up in Supabase. This command currently relies on `MOD_ROLE_ID` in your environment.'
            });
          }
          throw dbError;
        }

        if (existing) {
          return interaction.editReply({ 
            content: `❌ Role ${role.name} is already configured.` 
          });
        }

        const { data, error } = await supabase
          .from('mod_roles')
          .insert([{
            role_id: roleId,
            role_name: role.name,
            description: description
          }])
          .select();

        if (error) {
          logger.error('Error adding role:', error);
          return interaction.editReply({ 
            content: `❌ Error adding role: ${error.message}` 
          });
        }

        // Log to channel
        await safeLog(
          '🎭 Role Added',
          `A new certification role was added by ${interaction.user.tag}`,
          0x5865f2,
          [
            { name: '🎭 Role', value: role.name, inline: true },
            { name: '🆔 Role ID', value: roleId, inline: true },
            { name: '📝 Description', value: description || 'None', inline: false }
          ]
        );

        await interaction.editReply({ 
          content: `✅ Role **${role.name}** added successfully!\n**ID:** ${roleId}` 
        });

      } else if (subcommand === 'remove') {
        const roleInput = interaction.options.getString('role');

        let roleId = roleInput;
        if (roleInput.startsWith('<@&') && roleInput.endsWith('>')) {
          roleId = roleInput.slice(3, -1);
        }

        let data = null;
        let error = null;
        try {
          const result = await supabase
            .from('mod_roles')
            .delete()
            .eq('role_id', roleId)
            .select();
          data = result.data;
          error = result.error;
        } catch (dbError) {
          if (dbError?.message?.includes("mod_roles")) {
            return interaction.editReply({
              content: '⚠️ The `mod_roles` table is not set up in Supabase, so there is nothing to remove. Roles are currently managed via `MOD_ROLE_ID`.'
            });
          }
          throw dbError;
        }

        if (error) {
          return interaction.editReply({ 
            content: `❌ Error removing role: ${error.message}` 
          });
        }

        if (!data || data.length === 0) {
          return interaction.editReply({ 
            content: `❌ Role not found in configuration.` 
          });
        }

        // Log to channel
        await safeLog(
          '🎭 Role Removed',
          `A certification role was removed by ${interaction.user.tag}`,
          0xed4245,
          [
            { name: '🎭 Role', value: data[0].role_name, inline: true },
            { name: '🆔 Role ID', value: roleId, inline: true }
          ]
        );

        await interaction.editReply({ 
          content: `✅ Role **${data[0].role_name}** removed successfully!` 
        });

      } else if (subcommand === 'list') {
        try {
          const { data, error } = await supabase
            .from('mod_roles')
            .select('*')
            .order('id', { ascending: true });

          if (error) {
            if (error.message?.includes("mod_roles")) {
              // Graceful fallback: show roles from env
              if (!process.env.MOD_ROLE_ID) {
                return interaction.editReply({
                  content: '📋 No roles configured in Supabase or `MOD_ROLE_ID`. Use `/cert-role add` or set `MOD_ROLE_ID` in your environment.'
                });
              }

              const envRoles = process.env.MOD_ROLE_ID.split(',').map(r => r.trim()).filter(Boolean);
              const envDesc = envRoles.map(id => `<@&${id}>`).join('\n');

              const embed = new EmbedBuilder()
                .setTitle('📋 Certification Roles (Environment)')
                .setDescription(envDesc || 'No roles configured in `MOD_ROLE_ID`.')
                .setColor(0x5865f2);

              return interaction.editReply({ embeds: [embed] });
            }

            return interaction.editReply({ 
              content: `❌ Error fetching roles: ${error.message}` 
            });
          }

          if (!data || data.length === 0) {
            return interaction.editReply({ 
              content: '📋 No roles configured. Use `/cert-role add` to add roles.' 
            });
          }

          const embed = new EmbedBuilder()
            .setTitle('📋 Certification Roles')
            .setDescription(`Total: ${data.length} role(s)`)
            .setColor(0x5865f2);

          let description = '';
          for (const role of data) {
            const roleMention = `<@&${role.role_id}>`;
            description += `**${role.role_name}** ${roleMention}\n`;
            if (role.description) {
              description += `  └ ${role.description}\n`;
            }
          }

          embed.setDescription(description);

          await interaction.editReply({ embeds: [embed] });
        } catch (dbError) {
          return interaction.editReply({
            content: `❌ Error fetching roles: ${dbError.message}`
          });
        }
      }
    } catch (error) {
      logger.error(`cert-role ${subcommand} error:`, error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== ANALYTICS COMMAND ====================
const analyticsCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-analytics')
    .setDescription('📊 View certification test analytics and statistics')
    .addSubcommand(subcommand =>
      subcommand
        .setName('overview')
        .setDescription('Get overall statistics'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('user')
        .setDescription('Get stats for a specific user')
        .addStringOption(option =>
          option.setName('user')
            .setDescription('User mention or ID')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('recent')
        .setDescription('View recent test submissions')
        .addIntegerOption(option =>
          option.setName('limit')
            .setDescription('Number of results (default: 10)')
            .setRequired(false))),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You do not have permission to use this command.' 
      });
    }

    // This command has subcommands, get it
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'overview') {
        const { data: apps, error } = await supabase
          .from('applications')
          .select('status, score, correct_answers, total_questions, created_at');

        if (error) throw error;

        const total = apps.length;
        const pending = apps.filter(a => a.status === 'pending').length;
        const accepted = apps.filter(a => a.status === 'accepted').length;
        const rejected = apps.filter(a => a.status === 'rejected').length;
        
        const scores = apps
          .filter(a => a.score)
          .map(a => {
            const parts = a.score.split('/');
            return parts.length === 2 ? parseInt(parts[0]) / parseInt(parts[1]) : 0;
          });
        
        const avgScore = scores.length > 0 
          ? (scores.reduce((a, b) => a + b, 0) / scores.length * 100).toFixed(1)
          : 0;

        const embed = new EmbedBuilder()
          .setTitle('📊 Certification Analytics Overview')
          .setColor(0x5865f2)
          .addFields(
            { name: '📝 Total Applications', value: `${total}`, inline: true },
            { name: '⏳ Pending', value: `${pending}`, inline: true },
            { name: '✅ Accepted', value: `${accepted}`, inline: true },
            { name: '❌ Rejected', value: `${rejected}`, inline: true },
            { name: '📈 Average Score', value: `${avgScore}%`, inline: true },
            { name: '🎯 Pass Rate', value: `${total > 0 ? ((accepted / total) * 100).toFixed(1) : 0}%`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'user') {
        const userInput = interaction.options.getString('user');
        let userId = userInput;
        if (userInput.startsWith('<@') && userInput.endsWith('>')) {
          userId = userInput.slice(2, -1);
        }

        const { data: apps, error } = await supabase
          .from('applications')
          .select('*')
          .eq('discord_id', userId)
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (!apps || apps.length === 0) {
          return interaction.editReply({ 
            content: `❌ No test submissions found for that user.` 
          });
        }

        const latest = apps[0];
        const passed = apps.filter(a => {
          const score = a.score ? a.score.split('/') : ['0', '8'];
          return parseInt(score[0]) >= 6;
        }).length;

        const embed = new EmbedBuilder()
          .setTitle(`📊 Analytics for ${latest.discord_username}`)
          .setColor(0x5865f2)
          .addFields(
            { name: '📝 Total Submissions', value: `${apps.length}`, inline: true },
            { name: '✅ Passed', value: `${passed}`, inline: true },
            { name: '📊 Latest Score', value: latest.score || 'N/A', inline: true },
            { name: '📅 Latest Submission', value: new Date(latest.created_at).toLocaleDateString(), inline: true },
            { name: '📋 Status', value: latest.status || 'pending', inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

      } else if (subcommand === 'recent') {
        const limit = interaction.options.getInteger('limit') || 10;
        
        const { data: apps, error } = await supabase
          .from('applications')
          .select('discord_username, score, status, created_at')
          .order('created_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        if (!apps || apps.length === 0) {
          return interaction.editReply({ 
            content: '📋 No recent submissions found.' 
          });
        }

        let description = '';
        apps.forEach((app, idx) => {
          const date = new Date(app.created_at).toLocaleDateString();
          const statusEmoji = app.status === 'accepted' ? '✅' : app.status === 'rejected' ? '❌' : '⏳';
          description += `${statusEmoji} **${app.discord_username}** - ${app.score || 'N/A'} (${date})\n`;
        });

        const embed = new EmbedBuilder()
          .setTitle(`📋 Recent Submissions (Last ${limit})`)
          .setDescription(description)
          .setColor(0x5865f2)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error(`analytics ${subcommand} error:`, error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== BULK OPERATIONS COMMAND ====================
const bulkCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-bulk')
    .setDescription('⚡ Perform bulk operations on questions and applications')
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable-all')
        .setDescription('Enable all disabled questions'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable-all')
        .setDescription('Disable all questions'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reorder-auto')
        .setDescription('Auto-reorder questions by ID'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('export')
        .setDescription('Export questions as JSON')),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You do not have permission to use this command.' 
      });
    }

    // This command has subcommands, get it
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'enable-all') {
        const { data, error } = await supabase
          .from('test_questions')
          .update({ enabled: true })
          .eq('enabled', false)
          .select();

        if (error) throw error;

        await interaction.editReply({ 
          content: `✅ Enabled ${data?.length || 0} question(s)!` 
        });

      } else if (subcommand === 'disable-all') {
        const { data, error } = await supabase
          .from('test_questions')
          .update({ enabled: false })
          .select();

        if (error) throw error;

        await interaction.editReply({ 
          content: `✅ Disabled ${data?.length || 0} question(s)!` 
        });

      } else if (subcommand === 'reorder-auto') {
        await interaction.editReply({ 
          content: '⚠️ Auto-reorder is disabled because the `order` column is not present. Questions are ordered by ID.' 
        });

      } else if (subcommand === 'export') {
        const { data: questions, error } = await supabase
          .from('test_questions')
          .select('*')
          .order('id', { ascending: true });

        if (error) throw error;

        const json = JSON.stringify(questions, null, 2);
        const buffer = Buffer.from(json, 'utf-8');

        await interaction.editReply({
          content: `📦 Exported ${questions.length} question(s)!`,
          files: [{
            attachment: buffer,
            name: `questions_export_${Date.now()}.json`
          }]
        });
      }
    } catch (error) {
      logger.error(`bulk ${subcommand} error:`, error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== SIMULATE COMMAND ====================
const simulateCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-simulate')
    .setDescription('🎮 Simulate a test submission (for testing)')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('User to simulate')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('score')
        .setDescription('Score to simulate (e.g., 7 for 7/8)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(8)),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You do not have permission to use this command.' 
      });
    }

    try {
      const user = interaction.options.getUser('user');
      const score = interaction.options.getInteger('score');
      const total = 8;

      const { data, error } = await supabase
        .from('applications')
        .insert([{
          discord_id: user.id,
          discord_username: user.username,
          score: `${score}/${total}`,
          total_questions: total,
          correct_answers: score,
          wrong_answers: total - score,
          status: 'pending',
          answers: `Simulated test submission - Score: ${score}/${total}`,
          conversation_log: `Simulated by ${interaction.user.tag}`,
          test_results: JSON.stringify({
            score: score,
            total: total,
            passed: score >= 6,
            percentage: Math.round((score / total) * 100),
            simulated: true,
            date: new Date().toISOString()
          })
        }])
        .select();

      if (error) throw error;

      await interaction.editReply({ 
        content: `✅ Simulated test submission for ${user.tag}!\n**Score:** ${score}/${total} (${score >= 6 ? 'PASS' : 'FAIL'})\n**Application ID:** ${data[0].id}` 
      });
    } catch (error) {
      logger.error('simulate error:', error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== QUESTION STATS COMMAND ====================
const questionStatsCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-question-stats')
    .setDescription('📈 View statistics for specific questions')
    .addIntegerOption(option =>
      option.setName('id')
        .setDescription('Question ID (leave empty for all)')
        .setRequired(false)),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You do not have permission to use this command.' 
      });
    }

    try {
      const questionId = interaction.options.getInteger('id');

      if (questionId) {
        const { data: question, error: qError } = await supabase
          .from('test_questions')
          .select('*')
          .eq('id', questionId)
          .single();

        if (qError || !question) {
          return interaction.editReply({ 
            content: `❌ Question ${questionId} not found.` 
          });
        }

        const { data: apps } = await supabase
          .from('applications')
          .select('test_results');

        let appearances = 0;
        apps?.forEach(app => {
          try {
            const results = typeof app.test_results === 'string' 
              ? JSON.parse(app.test_results) 
              : app.test_results;
            if (results && results.questions) {
              const found = results.questions.find((q) => q.id === questionId);
              if (found) appearances++;
            }
          } catch {}
        });

        const embed = new EmbedBuilder()
          .setTitle(`📈 Question #${questionId} Statistics`)
          .setColor(0x5865f2)
          .addFields(
            { name: '📝 Question Text', value: question.user_message.substring(0, 200) + (question.user_message.length > 200 ? '...' : ''), inline: false },
            { name: '✅ Status', value: question.enabled ? 'Enabled' : 'Disabled', inline: true },
            { name: '📍 Order', value: `${question.order || 0}`, inline: true },
            { name: '🔑 Keywords', value: (question.keywords || []).join(', ') || 'None', inline: false },
            { name: '📊 Appearances', value: `${appearances}`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } else {
        const { data: questions, error } = await supabase
          .from('test_questions')
          .select('id, enabled');

        if (error) throw error;

        const enabled = questions.filter(q => q.enabled).length;
        const disabled = questions.length - enabled;

        const embed = new EmbedBuilder()
          .setTitle('📈 Question Statistics')
          .setColor(0x5865f2)
          .addFields(
            { name: '📝 Total Questions', value: `${questions.length}`, inline: true },
            { name: '✅ Enabled', value: `${enabled}`, inline: true },
            { name: '❌ Disabled', value: `${disabled}`, inline: true }
          )
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      logger.error('question-stats error:', error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== QUICK ACTIONS COMMAND ====================
const quickActionsCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-quick')
    .setDescription('⚡ Quick actions for common tasks')
    .addSubcommand(subcommand =>
      subcommand
        .setName('accept-latest')
        .setDescription('Accept the most recent pending application'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reject-low-scores')
        .setDescription('Reject all applications with score < 6'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('cleanup-old')
        .setDescription('Clean up old rejected applications (30+ days)')
        .addIntegerOption(option =>
          option.setName('days')
            .setDescription('Days old (default: 30)')
            .setRequired(false))),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You do not have permission to use this command.' 
      });
    }

    // This command has subcommands, get it
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'accept-latest') {
        const { data: latest, error } = await supabase
          .from('applications')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (error || !latest) {
          return interaction.editReply({ 
            content: '❌ No pending applications found.' 
          });
        }

        await supabase
          .from('applications')
          .update({
            status: 'accepted',
            reviewed_by: interaction.user.tag,
            reviewed_at: new Date().toISOString()
          })
          .eq('id', latest.id);

        const { assignModRole } = require('../utils/discordHelpers');
        await assignModRole(latest.discord_id, latest.discord_username);

        await interaction.editReply({ 
          content: `✅ Accepted latest application from **${latest.discord_username}**!\n**Score:** ${latest.score}` 
        });

      } else if (subcommand === 'reject-low-scores') {
        const { data: apps, error } = await supabase
          .from('applications')
          .select('*')
          .eq('status', 'pending');

        if (error) throw error;

        let rejected = 0;
        for (const app of apps) {
          const score = app.score ? app.score.split('/') : ['0', '8'];
          const scoreValue = parseInt(score[0]) || 0;
          
          if (scoreValue < 6) {
            await supabase
              .from('applications')
              .update({
                status: 'rejected',
                rejection_reason: 'Automated: Score below passing threshold',
                reviewed_by: interaction.user.tag,
                reviewed_at: new Date().toISOString()
              })
              .eq('id', app.id);
            rejected++;
          }
        }

        await interaction.editReply({ 
          content: `✅ Rejected ${rejected} application(s) with scores below 6.` 
        });

      } else if (subcommand === 'cleanup-old') {
        const days = interaction.options.getInteger('days') || 30;
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        const { data: apps, error } = await supabase
          .from('applications')
          .select('id')
          .eq('status', 'rejected')
          .lt('created_at', cutoffDate.toISOString());

        if (error) throw error;

        let deleted = 0;
        for (const app of apps) {
          await supabase
            .from('applications')
            .delete()
            .eq('id', app.id);
          deleted++;
        }

        await interaction.editReply({ 
          content: `✅ Cleaned up ${deleted} old rejected application(s) (older than ${days} days).` 
        });
      }
    } catch (error) {
      logger.error(`quick ${subcommand} error:`, error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== BOT STATUS COMMAND (NEW) ====================
const botStatusCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-status')
    .setDescription('🤖 Check bot status and system health')
    .addBooleanOption(option =>
      option.setName('detailed')
        .setDescription('Show detailed information')
        .setRequired(false)),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({ 
        content: '❌ You do not have permission to use this command.' 
      });
    }

    try {
      const detailed = interaction.options.getBoolean('detailed') || false;
      const { getBot, ensureReady } = require('../config/discord');
      const bot = getBot();

      const botReady = bot && bot.isReady();
      const uptime = botReady ? Math.floor(process.uptime()) : 0;
      const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`;

      // Database check
      let dbStatus = '❌ Unknown';
      try {
        const { error } = await supabase.from('applications').select('id').limit(1);
        dbStatus = error ? '❌ Error' : '✅ Connected';
      } catch {}

      // Count stats
      const { data: apps } = await supabase.from('applications').select('id');
      const { data: questions } = await supabase.from('test_questions').select('id');
      const { data: roles } = await supabase.from('mod_roles').select('id');

      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Status')
        .setColor(botReady ? 0x10b981 : 0xed4245)
        .addFields(
          { name: '🟢 Bot Status', value: botReady ? '✅ Online' : '❌ Offline', inline: true },
          { name: '⏱️ Uptime', value: botReady ? uptimeStr : 'N/A', inline: true },
          { name: '💾 Database', value: dbStatus, inline: true },
          { name: '📝 Applications', value: `${apps?.length || 0}`, inline: true },
          { name: '❓ Questions', value: `${questions?.length || 0}`, inline: true },
          { name: '🎭 Roles', value: `${roles?.length || 0}`, inline: true }
        )
        .setTimestamp();

      if (detailed && botReady) {
        embed.addFields(
          { name: '👥 Guilds', value: `${bot.guilds.cache.size}`, inline: true },
          { name: '👤 Users', value: `${bot.users.cache.size}`, inline: true },
          { name: '📊 Memory', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, inline: true }
        );
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error('status error:', error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({ 
        content: `❌ Error executing command: ${error.message}` 
      });
    }
  }
};

// ==================== HELP COMMAND (NEW) ====================
const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-help')
    .setDescription('📚 Show help and command list'),
  
  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    // Help command is public - no admin check needed
    const embed = new EmbedBuilder()
      .setTitle('📚 Void Esports Certification Bot - Commands')
      .setDescription('All commands require Administrator permission or admin role.')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '📝 Question Management',
          value: '`/test-question` - Manage test questions\n• `add` - Add new question\n• `edit` - Edit question\n• `delete` - Delete question\n• `list` - List all questions\n• `reorder` - Change order\n• `enable/disable` - Toggle question',
          inline: false
        },
        {
          name: '🎭 Role Management',
          value: '`/cert-role` - Manage certification roles\n• `add` - Add role\n• `remove` - Remove role\n• `list` - List roles',
          inline: false
        },
        {
          name: '📊 Analytics',
          value: '`/cert-analytics` - View statistics\n• `overview` - Overall stats\n• `user` - User stats\n• `recent` - Recent submissions',
          inline: false
        },
        {
          name: '⚡ Bulk Operations',
          value: '`/cert-bulk` - Bulk actions\n• `enable-all` - Enable all questions\n• `disable-all` - Disable all\n• `reorder-auto` - Auto-reorder\n• `export` - Export as JSON',
          inline: false
        },
        {
          name: '🎮 Testing',
          value: '`/cert-simulate` - Simulate test submission\n`/cert-question-stats` - Question statistics',
          inline: false
        },
        {
          name: '⚡ Quick Actions',
          value: '`/cert-quick` - Quick tasks\n• `accept-latest` - Accept latest\n• `reject-low-scores` - Auto-reject low scores\n• `cleanup-old` - Clean old apps',
          inline: false
        },
        {
          name: '🤖 System',
          value: '`/cert-status` - Bot status\n`/cert-help` - This help message',
          inline: false
        }
      )
      .setFooter({ text: 'Void Esports Certification System' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  }
};

// ==================== DM TEMPLATE COMMAND ====================
const dmTemplateCommand = {
  data: new SlashCommandBuilder()
    .setName('cert-dm')
    .setDescription('Configure accept/reject DM templates')
    .addSubcommand(subcommand =>
      subcommand
        .setName('accept-view')
        .setDescription('View the current accept DM template'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('accept-edit')
        .setDescription('Edit the accept DM template')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Embed title (optional)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('body')
            .setDescription('DM body; supports {username} and {roles}')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('footer')
            .setDescription('Embed footer (optional)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('color')
            .setDescription('Hex color (e.g. #3ba55c)')
            .setRequired(false)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reject-view')
        .setDescription('View the current reject DM template'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('reject-edit')
        .setDescription('Edit the reject DM template')
        .addStringOption(option =>
          option.setName('title')
            .setDescription('Embed title (optional)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('body')
            .setDescription('DM body; supports {username} and {reason}')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('footer')
            .setDescription('Embed footer (optional)')
            .setRequired(false))
        .addStringOption(option =>
          option.setName('color')
            .setDescription('Hex color (e.g. #ed4245)')
            .setRequired(false))),

  async execute(interaction) {
    const alreadyDeferred = interaction.deferred || interaction.replied;
    if (!alreadyDeferred) {
      await interaction.deferReply({ ephemeral: false });
    }

    if (!await isAdmin(interaction.member)) {
      return interaction.editReply({
        content: '❌ You do not have permission to use this command.'
      });
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === 'accept-view' || subcommand === 'reject-view') {
        const type = subcommand.startsWith('accept') ? 'accept' : 'reject';
        const defaults = type === 'accept'
          ? {
              title: '🎉 Welcome to the Void Esports Mod Team!',
              body: 'Congratulations {username}! Your application was **approved**.\n\nYou have been granted: **{roles}**.',
              footer: 'Welcome to the Mod Team!',
              color: 0x3ba55c
            }
          : {
              title: '❌ Application Status Update',
              body: 'Hello {username},\n\nAfter review, your moderator application has **not been approved**.\n\n**Reason:** {reason}\n\nYou may reapply in 30 days.',
              footer: 'Better luck next time!',
              color: 0xed4245
            };

        const template = await getDMTemplate(type, defaults);

        const embed = new EmbedBuilder()
          .setTitle(`📨 ${type === 'accept' ? 'Accept' : 'Reject'} DM Template`)
          .setColor(template.color)
          .addFields(
            { name: 'Title', value: template.title, inline: false },
            { name: 'Body', value: '```txt\n' + template.body + '\n```', inline: false },
            { name: 'Footer', value: template.footer || 'None', inline: false }
          )
          .setFooter({ text: 'Placeholders: {username}, {roles}, {reason}' });

        return interaction.editReply({ embeds: [embed] });
      }

      const type = subcommand.startsWith('accept') ? 'accept' : 'reject';
      const title = interaction.options.getString('title');
      const body = interaction.options.getString('body');
      const footer = interaction.options.getString('footer');
      const colorHex = interaction.options.getString('color');

      const fieldsToUpdate = {};
      if (title) fieldsToUpdate.title = title;
      if (body) fieldsToUpdate.body = body;
      if (footer) fieldsToUpdate.footer = footer;
      if (colorHex) fieldsToUpdate.color_hex = colorHex;

      if (Object.keys(fieldsToUpdate).length === 0) {
        return interaction.editReply({
          content: '⚠️ Nothing to update. Provide at least one of `title`, `body`, `footer`, or `color`.'
        });
      }

      try {
        const { error } = await supabase
          .from('dm_templates')
          .upsert({
            type,
            ...fieldsToUpdate,
            updated_at: new Date().toISOString()
          }, { onConflict: 'type' });

        if (error) {
          if (error.message?.includes('dm_templates')) {
            return interaction.editReply({
              content: '⚠️ The `dm_templates` table is not set up in Supabase. Templates will continue using built-in defaults.'
            });
          }
          return interaction.editReply({
            content: `❌ Error saving template: ${error.message}`
          });
        }

        return interaction.editReply({
          content: `✅ ${type === 'accept' ? 'Accept' : 'Reject'} DM template updated successfully.`
        });
      } catch (dbError) {
        return interaction.editReply({
          content: `❌ Error saving template: ${dbError.message}`
        });
      }
    } catch (error) {
      logger.error('cert-dm error:', error);
      logger.error('Stack:', error.stack);
      await interaction.editReply({
        content: `❌ Error executing command: ${error.message}`
      });
    }
  }
};

module.exports = {
  testQuestionCommand,
  certRoleCommand,
  analyticsCommand,
  bulkCommand,
  simulateCommand,
  questionStatsCommand,
  quickActionsCommand,
  botStatusCommand,
  helpCommand,
  dmTemplateCommand
};
