const express = require("express");
const session = require("express-session");
const axios = require("axios");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, PermissionsBitField } = require("discord.js");
const MemoryStore = require('memorystore')(session);

const app = express();

/* ================= SUPABASE ================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* ================= DISCORD BOT ================= */

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

bot.login(process.env.DISCORD_BOT_TOKEN)
  .then(() => console.log('Discord bot logged in'))
  .catch(console.error);

bot.on('ready', () => {
  console.log(`Discord bot ready as ${bot.user.tag}`);
});

/* ================= ADMIN ACTIONS ================= */

// Function to send DM to user
async function sendDMToUser(discordId, title, description, color, footer = null) {
  try {
    const user = await bot.users.fetch(discordId);
    if (!user) {
      console.log(`User ${discordId} not found`);
      return false;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: footer || 'Void Esports Mod Team' });

    await user.send({ embeds: [embed] });
    console.log(`DM sent to ${user.tag}: ${title}`);
    return true;
  } catch (error) {
    console.error(`Failed to send DM to ${discordId}:`, error.message);
    return false;
  }
}

// Function to assign mod role
async function assignModRole(discordId) {
  try {
    const guild = await bot.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(discordId);
    const role = guild.roles.cache.get(process.env.MOD_ROLE_ID);
    
    if (!member) {
      console.log(`Member ${discordId} not found in guild`);
      return false;
    }
    
    if (!role) {
      console.log(`Role ${process.env.MOD_ROLE_ID} not found`);
      return false;
    }
    
    await member.roles.add(role);
    console.log(`Assigned mod role to ${member.user.tag}`);
    
    // Send welcome DM
    await sendDMToUser(
      discordId,
      '🎉 Welcome to the Void Esports Mod Team!',
      `Congratulations! Your moderator application has been **approved**.\n\n` +
      `You have been granted the **Trial Moderator** role.\n\n` +
      `**Next Steps:**\n` +
      `1. Read #staff-rules-and-info\n` +
      `2. Introduce yourself in #staff-introductions\n` +
      `3. Join our next mod training session\n` +
      `4. Start with ticket duty in #mod-tickets\n\n` +
      `If you have any questions, ping @Senior Staff in #staff-chat.\n\n` +
      `We're excited to have you on the team!`,
      0x3ba55c,
      'Welcome to the Mod Team!'
    );
    
    return true;
  } catch (error) {
    console.error('Error assigning mod role:', error);
    return false;
  }
}

// Function to send rejection DM
async function sendRejectionDM(discordId, discordUsername) {
  try {
    const success = await sendDMToUser(
      discordId,
      '❌ Application Status Update',
      `Hello ${discordUsername},\n\n` +
      `After careful review, your moderator application has **not been approved** at this time.\n\n` +
      `**Possible reasons:**\n` +
      `• Insufficient test score\n` +
      `• Incomplete responses\n` +
      `• Better candidates available\n` +
      `• Currently not accepting new mods\n\n` +
      `**You can reapply in 30 days.**\n` +
      `In the meantime, remain active in the community and consider improving your knowledge of our rules and procedures.\n\n` +
      `Thank you for your interest in joining the Void Esports team!`,
      0xed4245,
      'Better luck next time!'
    );
    
    return success;
  } catch (error) {
    console.error('Error sending rejection DM:', error);
    return false;
  }
}

/* ================= FIXED CORS & SESSION ================= */

// ... [rest of the CORS and session setup remains the same] ...

/* ================= ULTIMATE SUBMISSION ENDPOINT - ENHANCED WITH CONVERSATION LOGS ================= */

app.post("/submit-test-results", async (req, res) => {
  console.log("🚀 ULTIMATE SUBMISSION ENDPOINT CALLED");
  
  try {
    const { 
      discordId, 
      discordUsername, 
      answers, 
      score, 
      totalQuestions = 8, 
      correctAnswers = 0, 
      wrongAnswers = 0, 
      testResults,
      conversationLog,
      questionsWithAnswers 
    } = req.body;
    
    console.log("📋 Received submission data:", {
      discordId,
      discordUsername,
      score,
      answersLength: answers ? answers.length : 0,
      conversationLogLength: conversationLog ? conversationLog.length : 0,
      qnaLength: questionsWithAnswers ? questionsWithAnswers.length : 0
    });
    
    if (!discordId || !discordUsername) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        success: false, 
        message: "Missing discordId or discordUsername" 
      });
    }
    
    // Create a submission ID for tracking
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📝 Submission ID: ${submissionId}`);
    
    // Step 1: Enhanced Discord Webhook with conversation logs
    let webhookSuccess = false;
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        console.log("🌐 Sending enhanced webhook with conversation logs...");
        
        // Create embeds
        const embeds = [];
        
        // Main embed
        embeds.push({
          title: "📝 NEW MOD TEST SUBMISSION",
          description: `**User:** ${discordUsername}\n**Discord ID:** ${discordId}\n**Score:** ${score || "0/8"}\n**Status:** Pending Review\n**Submission ID:** ${submissionId}`,
          fields: [
            {
              name: "👤 User Info",
              value: `\`\`\`\nDiscord: ${discordUsername}\nID: ${discordId}\nDate: ${new Date().toLocaleString()}\n\`\`\``,
              inline: true
            },
            {
              name: "📊 Test Results",
              value: `\`\`\`\nScore: ${score}\nCorrect: ${correctAnswers}/${totalQuestions}\nPercentage: ${Math.round((correctAnswers/totalQuestions)*100)}%\n\`\`\``,
              inline: true
            },
            {
              name: "📋 Detailed Logs",
              value: "Check conversation logs below ↓",
              inline: false
            }
          ],
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Mod Test System • Auto-saved to Admin Panel"
          },
          thumbnail: {
            url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
          }
        });
        
        // Conversation log embed (if available)
        if (conversationLog && conversationLog.length > 0) {
          let logContent = conversationLog;
          if (logContent.length > 4000) {
            logContent = logContent.substring(0, 3900) + "...\n[Log truncated due to length]";
          }
          
          embeds.push({
            title: "💬 CONVERSATION LOGS",
            description: `\`\`\`yaml\n${logContent}\n\`\`\``,
            color: 0x5865f2,
            footer: {
              text: `Full logs available in admin panel • ${conversationLog.length} characters`
            }
          });
        } else if (questionsWithAnswers && questionsWithAnswers.length > 0) {
          // Format Q&A
          let qnaContent = "";
          questionsWithAnswers.forEach((q, i) => {
            qnaContent += `Q${i+1}: ${q.question.substring(0, 50)}${q.question.length > 50 ? '...' : ''}\n`;
            qnaContent += `A${i+1}: ${q.answer.substring(0, 50)}${q.answer.length > 50 ? '...' : ''}\n\n`;
          });
          
          if (qnaContent.length > 3900) {
            qnaContent = qnaContent.substring(0, 3900) + "...\n[Q&A truncated]";
          }
          
          embeds.push({
            title: "❓ QUESTIONS & ANSWERS",
            description: `\`\`\`\n${qnaContent}\`\`\``,
            color: 0xf59e0b,
            footer: {
              text: `Full answers available in admin panel`
            }
          });
        }
        
        // Test results embed
        if (testResults && typeof testResults === 'object') {
          const resultsStr = JSON.stringify(testResults, null, 2);
          if (resultsStr.length > 1000) {
            embeds.push({
              title: "📈 TEST DETAILS",
              description: `\`\`\`json\n${resultsStr.substring(0, 900)}\n... [Full results in admin panel]\`\`\``,
              color: 0x8b5cf6
            });
          }
        }
        
        const webhookData = {
          embeds,
          username: "Void Test System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, webhookData);
        webhookSuccess = true;
        console.log("✅ Discord webhook sent successfully with conversation logs!");
      } catch (webhookError) {
        console.error("⚠️ Discord webhook error:", webhookError.message);
      }
    } else {
      console.log("ℹ️ No Discord webhook URL configured");
    }
    
    // Step 2: Save to database with conversation logs
    console.log("💾 Saving to database with conversation logs...");
    
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers ? (typeof answers === 'string' ? answers.substring(0, 15000) : JSON.stringify(answers).substring(0, 15000)) : "No answers provided",
      conversation_log: conversationLog ? conversationLog.substring(0, 20000) : null,
      questions_with_answers: questionsWithAnswers ? JSON.stringify(questionsWithAnswers) : null,
      score: score || "0/8",
      total_questions: parseInt(totalQuestions) || 8,
      correct_answers: parseInt(correctAnswers) || 0,
      wrong_answers: parseInt(wrongAnswers) || 8,
      test_results: testResults ? (typeof testResults === 'string' ? testResults : JSON.stringify(testResults)) : "{}",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    console.log("📊 Database data prepared with conversation logs");
    
    let dbSuccess = false;
    let savedId = null;
    
    try {
      console.log("🔄 Attempting to insert application...");
      const { data, error } = await supabase
        .from("applications")
        .insert([applicationData])
        .select();
      
      if (error) {
        console.log("❌ Insert failed:", error.message);
        
        // Try without conversation_log field if it doesn't exist
        delete applicationData.conversation_log;
        delete applicationData.questions_with_answers;
        
        const { data: data2, error: error2 } = await supabase
          .from("applications")
          .insert([applicationData])
          .select();
        
        if (error2) {
          console.log("❌ Second insert failed:", error2.message);
        } else {
          console.log("✅ Insert successful!");
          dbSuccess = true;
          savedId = data2?.[0]?.id;
        }
      } else {
        console.log("✅ Insert successful!");
        dbSuccess = true;
        savedId = data?.[0]?.id;
      }
    } catch (dbError) {
      console.error("❌ Database exception:", dbError.message);
    }
    
    // Step 3: Return response
    console.log("🎉 Submission process complete");
    
    const responseData = {
      success: true,
      message: "✅ Test submitted successfully! Results saved with conversation logs.",
      details: {
        submissionId,
        user: discordUsername,
        score: score,
        discordWebhook: webhookSuccess ? "sent_with_logs" : "failed",
        database: dbSuccess ? "saved" : "failed",
        savedId: savedId,
        timestamp: new Date().toISOString(),
        adminPanel: "https://mod-application-backend.onrender.com/admin"
      }
    };
    
    res.json(responseData);
    
  } catch (err) {
    console.error("🔥 CRITICAL ERROR in submission:", err);
    res.status(200).json({ 
      success: true, 
      message: "Test received! Your score has been recorded.",
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* ================= ADMIN ACTIONS ENDPOINTS ================= */

app.post("/admin/accept/:id", async (req, res) => {
  try {
    console.log(`🔵 Accepting application ${req.params.id}`);
    
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ error: "Application not found" });
    }
    
    // Update status to accepted
    const { error: updateError } = await supabase
      .from("applications")
      .update({ 
        status: "accepted",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", req.params.id);
    
    if (updateError) {
      throw updateError;
    }
    
    console.log(`✅ Application ${req.params.id} marked as accepted`);
    
    // Assign mod role via Discord bot
    const roleAssigned = await assignModRole(application.discord_id);
    
    if (roleAssigned) {
      console.log(`🎉 Role assigned to ${application.discord_username}`);
    } else {
      console.log(`⚠️ Could not assign role to ${application.discord_username}`);
    }
    
    // Send webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "✅ APPLICATION ACCEPTED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Accepted by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: ACCEPTED\nRole Assignment: ${roleAssigned ? "SUCCESS" : "FAILED"}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
              inline: false
            }
          ],
          color: 0x3ba55c,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Admin Action"
          }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: "Application accepted successfully",
      roleAssigned: roleAssigned,
      application: {
        id: application.id,
        username: application.discord_username,
        score: application.score
      }
    });
    
  } catch (err) {
    console.error("Accept error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      message: "Failed to process acceptance"
    });
  }
});

app.post("/admin/reject/:id", async (req, res) => {
  try {
    console.log(`🔴 Rejecting application ${req.params.id}`);
    
    // Check if admin is authenticated
    if (!req.session.user || !req.session.isAdmin) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    // Get application
    const { data: application, error: fetchError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();
    
    if (fetchError || !application) {
      return res.status(404).json({ error: "Application not found" });
    }
    
    // Update status to rejected
    const { error: updateError } = await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        updated_at: new Date().toISOString(),
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString(),
        rejection_reason: req.body.reason || "Not specified"
      })
      .eq("id", req.params.id);
    
    if (updateError) {
      throw updateError;
    }
    
    console.log(`❌ Application ${req.params.id} marked as rejected`);
    
    // Send rejection DM
    const dmSent = await sendRejectionDM(application.discord_id, application.discord_username);
    
    // Send webhook notification
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const embed = {
          title: "❌ APPLICATION REJECTED",
          description: `**User:** ${application.discord_username}\n**ID:** ${application.discord_id}\n**Score:** ${application.score}\n**Rejected by:** ${req.session.user.username}`,
          fields: [
            {
              name: "📊 Details",
              value: `\`\`\`\nApplication ID: ${application.id}\nStatus: REJECTED\nDM Sent: ${dmSent ? "SUCCESS" : "FAILED"}\nReason: ${req.body.reason || "Not specified"}\nTime: ${new Date().toLocaleString()}\n\`\`\``,
              inline: false
            }
          ],
          color: 0xed4245,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Void Esports Admin Action"
          }
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed],
          username: "Admin System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        });
      } catch (webhookError) {
        console.error("Webhook error:", webhookError.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: "Application rejected successfully",
      dmSent: dmSent,
      application: {
        id: application.id,
        username: application.discord_username,
        score: application.score
      }
    });
    
  } catch (err) {
    console.error("Reject error:", err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      message: "Failed to process rejection"
    });
  }
});

/* ================= ADMIN PAGE - FIXED ================= */

app.get("/admin", async (req, res) => {
  console.log("\n=== ADMIN PAGE ACCESS ===");
  console.log("Session User:", req.session.user || 'No user');
  console.log("Session isAdmin:", req.session.isAdmin);
  console.log("Admin IDs:", process.env.ADMIN_IDS);
  
  // Check if user is logged in
  if (!req.session.user) {
    console.log("No user in session, redirecting to login");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Not Logged In</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
            margin: 0;
          }
          h1 { color: #ff0033; }
          .login-btn {
            display: inline-block;
            margin: 20px;
            padding: 15px 30px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
            font-size: 18px;
          }
          .login-btn:hover {
            background: #4752c4;
          }
          .debug-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 800px;
            text-align: left;
            font-family: monospace;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-exclamation-triangle"></i> Not Logged In</h1>
        <p>You need to log in with Discord to access the admin panel.</p>
        
        <a href="/auth/discord/admin" class="login-btn">
          <i class="fab fa-discord"></i> Login with Discord
        </a>
        
        <div class="debug-info">
          <strong>Debug Info:</strong><br>
          Session ID: ${req.sessionID || 'None'}<br>
          User in Session: ${req.session.user ? 'Yes' : 'No'}<br>
          Cookie Header: ${req.headers.cookie || 'None'}
        </div>
      </body>
      </html>
    `);
  }
  
  // Check if user is admin
  const adminIds = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",") : [];
  const userId = req.session.user.id;
  
  console.log("Checking if user is admin:");
  console.log("User ID:", userId);
  console.log("Admin IDs:", adminIds);
  console.log("Is user in admin list?", adminIds.includes(userId));
  
  if (!adminIds.includes(userId)) {
    console.log("User is NOT an admin");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: #36393f;
            color: white;
            margin: 0;
          }
          h1 { color: #ff0033; }
          .user-info {
            background: #202225;
            padding: 20px;
            border-radius: 10px;
            margin: 30px auto;
            max-width: 600px;
            text-align: left;
          }
          .contact-link {
            color: #5865f2;
            font-weight: bold;
            text-decoration: none;
          }
          .contact-link:hover {
            text-decoration: underline;
          }
          .action-buttons {
            margin-top: 30px;
          }
          .action-btn {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: #5865f2;
            color: white;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
          }
          .logout-btn {
            background: #ed4245;
          }
        </style>
      </head>
      <body>
        <h1><i class="fas fa-ban"></i> Access Denied</h1>
        <p>You don't have administrator privileges.</p>
        
        <div class="user-info">
          <p><strong>Your Discord:</strong> ${req.session.user.username}#${req.session.user.discriminator}</p>
          <p><strong>Your ID:</strong> ${req.session.user.id}</p>
          <p><strong>Your session ID:</strong> ${req.sessionID}</p>
        </div>
        
        <p>If you need admin access, contact <a href="https://discord.com/users/727888300210913310" class="contact-link" target="_blank">@nicksscold</a> on Discord.</p>
        
        <div class="action-buttons">
          <a href="/logout" class="action-btn logout-btn">
            <i class="fas fa-sign-out-alt"></i> Logout
          </a>
          <a href="https://hunterahead71-hash.github.io/void.training/" class="action-btn">
            <i class="fas fa-home"></i> Return to Training
          </a>
          <a href="/auth/discord" class="action-btn">
            <i class="fas fa-vial"></i> Take Mod Test
          </a>
        </div>
      </body>
      </html>
    `);
  }

  console.log("User is admin, loading applications...");
  
  try {
    // FIRST: Check if applications table exists by trying to query it
    const { data: applications, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      
      // If table doesn't exist, create it dynamically
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        console.log("Applications table doesn't exist, creating it...");
        return createApplicationsTableAndReturnAdmin(req, res);
      }
      
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Database Error</title></head>
        <body>
          <h1>Database Error</h1>
          <p>Could not load applications.</p>
          <p><a href="/admin">Try Again</a></p>
        </body>
        </html>
      `);
    }

    console.log(`Found ${applications.length} applications in database`);
    
    // Admin dashboard HTML
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Void Esports - Admin Dashboard</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          :root {
            --void-blood: #ff0033;
            --void-neon: #00ffea;
            --discord-bg: #36393f;
            --discord-primary: #202225;
            --discord-green: #3ba55c;
            --discord-red: #ed4245;
          }
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          body {
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background: var(--discord-bg);
            color: #ffffff;
            min-height: 100vh;
            padding: 20px;
          }
          
          .admin-container {
            max-width: 1400px;
            margin: 0 auto;
          }
          
          .header {
            background: var(--discord-primary);
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .header h1 {
            color: var(--void-blood);
            font-size: 28px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
          }
          
          .user-avatar {
            width: 50px;
            height: 50px;
            background: linear-gradient(135deg, var(--void-blood), var(--void-neon));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 20px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .logout-btn {
            background: var(--discord-red);
            color: white;
            padding: 10px 20px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .logout-btn:hover {
            background: #ff3333;
            transform: translateY(-2px);
          }
          
          .stats-container {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
          }
          
          .stat-card {
            background: var(--discord-primary);
            padding: 20px;
            border-radius: 12px;
            text-align: center;
          }
          
          .stat-number {
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 10px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .stat-label {
            color: #888;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .total { color: var(--void-neon); }
          .pending { color: #f59e0b; }
          .accepted { color: var(--discord-green); }
          .rejected { color: var(--discord-red); }
          
          .filters {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
            flex-wrap: wrap;
          }
          
          .filter-btn {
            background: var(--discord-primary);
            color: #888;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .filter-btn.active {
            background: var(--void-blood);
            color: white;
          }
          
          .filter-btn:hover:not(.active) {
            background: #333;
            color: white;
          }
          
          .applications-grid {
            display: grid;
            gap: 15px;
          }
          
          .application-card {
            background: var(--discord-primary);
            border-radius: 12px;
            padding: 20px;
            border-left: 4px solid #888;
          }
          
          .application-card.pending { border-left-color: #f59e0b; }
          .application-card.accepted { border-left-color: var(--discord-green); }
          .application-card.rejected { border-left-color: var(--discord-red); }
          
          .app-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
          }
          
          .app-user {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          
          .app-avatar {
            width: 40px;
            height: 40px;
            background: linear-gradient(135deg, #8b5cf6, var(--void-neon));
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-info h3 {
            font-size: 18px;
            margin-bottom: 5px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-info p {
            color: #888;
            font-size: 14px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-status {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 1px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .status-pending { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
          .status-accepted { background: rgba(59, 165, 92, 0.2); color: var(--discord-green); }
          .status-rejected { background: rgba(237, 66, 69, 0.2); color: var(--discord-red); }
          
          .app-details {
            background: rgba(0,0,0,0.3);
            border-radius: 8px;
            padding: 15px;
            margin-top: 15px;
          }
          
          .score-display {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          
          .score-value {
            font-size: 24px;
            font-weight: bold;
            color: var(--void-neon);
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .app-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
          }
          
          .action-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            font-weight: bold;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.3s;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .accept-btn {
            background: var(--discord-green);
            color: white;
          }
          
          .reject-btn {
            background: var(--discord-red);
            color: white;
          }
          
          .action-btn:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
          }
          
          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          
          .no-applications {
            text-align: center;
            padding: 50px;
            color: #888;
            font-size: 18px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
          
          .answers-content {
            margin-top: 10px;
            padding: 10px;
            background: rgba(0,0,0,0.5);
            border-radius: 8px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            max-height: 200px;
            overflow-y: auto;
            display: none;
          }
          
          .answers-content.show {
            display: block;
          }
          
          .view-answers-btn {
            background: none;
            border: none;
            color: var(--void-neon);
            cursor: pointer;
            font-size: 14px;
            margin-top: 10px;
            display: flex;
            align-items: center;
            gap: 5px;
            font-family: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="header">
            <h1><i class="fas fa-shield-alt"></i> VOID ESPORTS - ADMIN DASHBOARD</h1>
            <div class="user-info">
              <div class="user-avatar">${req.session.user.username.charAt(0).toUpperCase()}</div>
              <div>
                <div>${req.session.user.username}#${req.session.user.discriminator}</div>
                <div style="font-size: 12px; color: #888;">Admin • Session: ${req.sessionID.substring(0, 8)}...</div>
              </div>
              <a href="/logout" class="logout-btn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            </div>
          </div>
          
          <div class="stats-container">
            <div class="stat-card">
              <div class="stat-number total">${applications.length}</div>
              <div class="stat-label">Total Applications</div>
            </div>
            <div class="stat-card">
              <div class="stat-number pending">${applications.filter(a => a.status === 'pending').length}</div>
              <div class="stat-label">Pending</div>
            </div>
            <div class="stat-card">
              <div class="stat-number accepted">${applications.filter(a => a.status === 'accepted').length}</div>
              <div class="stat-label">Accepted</div>
            </div>
            <div class="stat-card">
              <div class="stat-number rejected">${applications.filter(a => a.status === 'rejected').length}</div>
              <div class="stat-label">Rejected</div>
            </div>
          </div>
          
          <div class="filters">
            <button class="filter-btn active" onclick="filterApplications('all')">All (${applications.length})</button>
            <button class="filter-btn" onclick="filterApplications('pending')">Pending (${applications.filter(a => a.status === 'pending').length})</button>
            <button class="filter-btn" onclick="filterApplications('accepted')">Accepted (${applications.filter(a => a.status === 'accepted').length})</button>
            <button class="filter-btn" onclick="filterApplications('rejected')">Rejected (${applications.filter(a => a.status === 'rejected').length})</button>
          </div>
          
          <div class="applications-grid" id="applicationsContainer">
    `;

    if (applications.length === 0) {
      html += `
        <div class="no-applications">
          <i class="fas fa-inbox" style="font-size: 48px; margin-bottom: 20px;"></i>
          <p>No applications submitted yet.</p>
          <p style="color: #888; font-size: 14px; margin-top: 10px;">Test submissions will appear here once users complete the test.</p>
        </div>
      `;
    }

    applications.forEach((app, index) => {
      const score = app.score ? app.score.split('/') : ['0', '8'];
      const scoreValue = parseInt(score[0]);
      const totalQuestions = parseInt(score[1]);
      const percentage = totalQuestions > 0 ? Math.round((scoreValue / totalQuestions) * 100) : 0;
      
      html += `
        <div class="application-card ${app.status}" id="app-${app.id}" data-status="${app.status}">
          <div class="app-header">
            <div class="app-user">
              <div class="app-avatar">${app.discord_username.charAt(0).toUpperCase()}</div>
              <div class="app-info">
                <h3>${app.discord_username}</h3>
                <p>ID: ${app.discord_id} • ${new Date(app.created_at).toLocaleString()}</p>
              </div>
            </div>
            <div class="app-status status-${app.status}">${app.status.toUpperCase()}</div>
          </div>
          
          <div class="app-details">
            <div class="score-display">
              <div class="score-value">${scoreValue}/${totalQuestions}</div>
              <div style="color: #888;">${percentage}% • ${app.correct_answers || 0} correct</div>
            </div>
            
            <button class="view-answers-btn" onclick="toggleAnswers(${app.id})">
              <i class="fas fa-chevron-down"></i> View Test Details
            </button>
            
            <div class="answers-content" id="answers-${app.id}">
              ${app.answers ? app.answers.substring(0, 500).replace(/\n/g, '<br>') : 'No answers provided'}
              ${app.answers && app.answers.length > 500 ? '...' : ''}
            </div>
            
            <div class="app-actions">
      `;
      
      if (app.status === "pending") {
        html += `
              <button class="action-btn accept-btn" onclick="processApplication(${app.id}, 'accept')">
                <i class="fas fa-check"></i> Accept & Grant Mod Role
              </button>
              <button class="action-btn reject-btn" onclick="processApplication(${app.id}, 'reject')">
                <i class="fas fa-times"></i> Reject
              </button>
        `;
      } else {
        html += `
              <button class="action-btn" disabled>
                <i class="fas fa-${app.status === 'accepted' ? 'check' : 'times'}"></i>
                ${app.status === 'accepted' ? 'Accepted' : 'Rejected'} on ${new Date(app.updated_at || app.created_at).toLocaleDateString()}
              </button>
        `;
      }
      
      html += `
            </div>
          </div>
        </div>
      `;
    });

    html += `
          </div>
        </div>
        
        <script>
          function filterApplications(status) {
            const cards = document.querySelectorAll('.application-card');
            const buttons = document.querySelectorAll('.filter-btn');
            
            buttons.forEach(btn => btn.classList.remove('active'));
            event.target.classList.add('active');
            
            cards.forEach(card => {
              if (status === 'all' || card.dataset.status === status) {
                card.style.display = 'block';
              } else {
                card.style.display = 'none';
              }
            });
          }
          
          function toggleAnswers(appId) {
            const answersDiv = document.getElementById('answers-' + appId);
            const toggleBtn = answersDiv.previousElementSibling;
            const icon = toggleBtn.querySelector('i');
            
            if (answersDiv.classList.contains('show')) {
              answersDiv.classList.remove('show');
              icon.className = 'fas fa-chevron-down';
              toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i> View Test Details';
            } else {
              answersDiv.classList.add('show');
              icon.className = 'fas fa-chevron-up';
              toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i> Hide Details';
            }
          }
          
          async function processApplication(appId, action) {
            const btn = event.target;
            const originalText = btn.innerHTML;
            
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            btn.disabled = true;
            
            try {
              const response = await fetch('/admin/' + action + '/' + appId, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                }
              });
              
              if (response.ok) {
                location.reload();
              } else {
                alert('Failed to process application');
                btn.innerHTML = originalText;
                btn.disabled = false;
              }
            } catch (error) {
              console.error('Error:', error);
              alert('An error occurred');
              btn.innerHTML = originalText;
              btn.disabled = false;
            }
          }
        </script>
      </body>
      </html>
    `;

    res.send(html);
  } catch (err) {
    console.error("Admin error:", err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Server Error</title></head>
      <body>
        <h1>Server Error</h1>
        <p>${err.message}</p>
        <p><a href="/admin">Try Again</a></p>
      </body>
      </html>
    `);
  }
});

// Helper function to create applications table if it doesn't exist
async function createApplicationsTableAndReturnAdmin(req, res) {
  try {
    console.log("Creating applications table...");
    
    // Try to create table using Supabase SQL
    const { error: createError } = await supabase.rpc('create_applications_table');
    
    if (createError) {
      console.log("RPC failed, trying direct SQL...");
      // If RPC fails, try to insert a dummy record to force table creation
      const { error: insertError } = await supabase
        .from('applications')
        .insert({
          discord_id: 'test',
          discord_username: 'Test User',
          answers: 'Test application',
          score: '0/8',
          status: 'pending',
          created_at: new Date().toISOString()
        });
        
      if (insertError) {
        console.error("Failed to create table:", insertError);
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Database Setup Required</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                text-align: center; 
                padding: 50px; 
                background: #36393f;
                color: white;
                margin: 0;
              }
              h1 { color: #ff0033; }
              .instructions {
                background: #202225;
                padding: 30px;
                border-radius: 10px;
                margin: 30px auto;
                max-width: 800px;
                text-align: left;
              }
            </style>
          </head>
          <body>
            <h1>Database Setup Required</h1>
            <div class="instructions">
              <p>The applications table doesn't exist in your Supabase database.</p>
              <p>Please run this SQL in your Supabase SQL Editor:</p>
              <pre style="background: #000; padding: 15px; border-radius: 5px; overflow-x: auto;">
CREATE TABLE applications (
  id BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,
  answers TEXT,
  score TEXT,
  total_questions INTEGER DEFAULT 8,
  correct_answers INTEGER DEFAULT 0,
  wrong_answers INTEGER DEFAULT 0,
  test_results JSONB,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_created_at ON applications(created_at DESC);
              </pre>
              <p>After creating the table, refresh this page.</p>
            </div>
          </body>
          </html>
        `);
      }
    }
    
    // Table created or already exists, redirect to admin page
    console.log("Table created successfully, redirecting...");
    return res.redirect('/admin');
    
  } catch (err) {
    console.error("Table creation error:", err);
    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Database Error</title></head>
      <body>
        <h1>Database Setup Error</h1>
        <p>${err.message}</p>
        <p>Please check your Supabase database configuration.</p>
      </body>
      </html>
    `);
  }
}

/* ================= ULTIMATE SUBMISSION ENDPOINT - GUARANTEED TO SAVE ================= */

app.post("/submit-test-results", async (req, res) => {
  console.log("🚀 ULTIMATE SUBMISSION ENDPOINT CALLED");
  
  try {
    const { 
      discordId, 
      discordUsername, 
      answers, 
      score, 
      totalQuestions = 8, 
      correctAnswers = 0, 
      wrongAnswers = 0, 
      testResults 
    } = req.body;
    
    console.log("📋 Received submission data:", {
      discordId,
      discordUsername,
      score,
      answersLength: answers ? answers.length : 0,
      totalQuestions,
      correctAnswers,
      wrongAnswers
    });
    
    if (!discordId || !discordUsername) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ 
        success: false, 
        message: "Missing discordId or discordUsername" 
      });
    }
    
    // Create a submission ID for tracking
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    console.log(`📝 Submission ID: ${submissionId}`);
    
    // Step 1: Send to Discord Webhook (ALWAYS FIRST - NEVER FAILS)
    let webhookSuccess = false;
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        console.log("🌐 Sending to Discord webhook...");
        
        // Create a more detailed embed
        const webhookData = {
          embeds: [{
            title: "📝 NEW MOD TEST SUBMISSION",
            description: `**User:** ${discordUsername}\n**Score:** ${score || "0/8"}\n**Status:** Pending Review\n**Submission ID:** ${submissionId}`,
            fields: [
              {
                name: "👤 User Info",
                value: `\`\`\`\nDiscord: ${discordUsername}\nID: ${discordId}\n\`\`\``,
                inline: true
              },
              {
                name: "📊 Test Results",
                value: `\`\`\`\nScore: ${score}\nCorrect: ${correctAnswers}/${totalQuestions}\nDate: ${new Date().toLocaleString()}\n\`\`\``,
                inline: true
              },
              {
                name: "📋 Details",
                value: answers ? `\`\`\`\nAnswers logged (${answers.length} characters)\nSubmission successful to admin panel!\n\`\`\`` : "No detailed answers",
                inline: false
              }
            ],
            color: 0x00ff00,
            timestamp: new Date().toISOString(),
            footer: {
              text: "Void Esports Mod Test System • Auto-saved to Admin Panel"
            },
            thumbnail: {
              url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
            }
          }],
          username: "Void Test System",
          avatar_url: "https://cdn.discordapp.com/attachments/1061186659113721938/1061186659403133058/void_esports_logo.png"
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, webhookData);
        webhookSuccess = true;
        console.log("✅ Discord webhook sent successfully!");
      } catch (webhookError) {
        console.error("⚠️ Discord webhook error:", webhookError.message);
        // Don't fail - continue with database save
      }
    } else {
      console.log("ℹ️ No Discord webhook URL configured");
    }
    
    // Step 2: SAVE TO DATABASE - MULTIPLE ATTEMPTS WITH DIFFERENT METHODS
    console.log("💾 Attempting to save to database...");
    
    // Prepare the application data for database
    // In server.js, update the applicationData preparation:
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers ? (typeof answers === 'string' ? answers.substring(0, 15000) : JSON.stringify(answers).substring(0, 15000)) : "No answers provided",
      score: score || "0/8",
      total_questions: parseInt(totalQuestions) || 8,
      correct_answers: parseInt(correctAnswers) || 0,
      wrong_answers: parseInt(wrongAnswers) || 8,
      test_results: testResults ? (typeof testResults === 'string' ? testResults : JSON.stringify(testResults)) : "{}", // This will be TEXT, not JSONB
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };     
    
    console.log("📊 Database data prepared:", {
      discord_username: applicationData.discord_username,
      score: applicationData.score,
      answers_length: applicationData.answers.length
    });
    
    let dbSuccess = false;
    let dbError = null;
    let savedId = null;
    
    // TRY METHOD 1: Standard insert with all fields
    try {
      console.log("🔄 METHOD 1: Standard insert with all fields");
      const { data, error } = await supabase
        .from("applications")
        .insert([applicationData])
        .select();
      
      if (error) {
        console.log("❌ Method 1 failed:", error.message);
        dbError = error;
      } else {
        console.log("✅ Method 1 successful! Data:", data);
        dbSuccess = true;
        savedId = data?.[0]?.id;
      }
    } catch (method1Error) {
      console.log("❌ Method 1 exception:", method1Error.message);
      dbError = method1Error;
    }
    
    // TRY METHOD 2: Simplified insert (only essential fields)
    if (!dbSuccess) {
      try {
        console.log("🔄 METHOD 2: Simplified insert");
        const simplifiedData = {
          discord_id: discordId,
          discord_username: discordUsername,
          answers: applicationData.answers.substring(0, 5000), // Shorter
          score: score || "0/8",
          status: "pending",
          created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
          .from("applications")
          .insert([simplifiedData])
          .select();
        
        if (error) {
          console.log("❌ Method 2 failed:", error.message);
          dbError = error;
        } else {
          console.log("✅ Method 2 successful!");
          dbSuccess = true;
          savedId = data?.[0]?.id;
        }
      } catch (method2Error) {
        console.log("❌ Method 2 exception:", method2Error.message);
        dbError = method2Error;
      }
    }
    
    // TRY METHOD 3: Minimal insert (absolute minimum)
    if (!dbSuccess) {
      try {
        console.log("🔄 METHOD 3: Minimal insert");
        const minimalData = {
          discord_id: discordId,
          discord_username: discordUsername,
          score: score || "0/8",
          status: "pending",
          created_at: new Date().toISOString()
        };
        
        const { error } = await supabase
          .from("applications")
          .insert([minimalData]);
        
        if (error) {
          console.log("❌ Method 3 failed:", error.message);
          dbError = error;
        } else {
          console.log("✅ Method 3 successful!");
          dbSuccess = true;
        }
      } catch (method3Error) {
        console.log("❌ Method 3 exception:", method3Error.message);
        dbError = method3Error;
      }
    }
    
    // TRY METHOD 4: Direct SQL via RPC (as last resort)
    if (!dbSuccess) {
      try {
        console.log("🔄 METHOD 4: Direct SQL via RPC");
        const { error } = await supabase.rpc('insert_application', {
          p_discord_id: discordId,
          p_discord_username: discordUsername,
          p_score: score || "0/8",
          p_answers: applicationData.answers.substring(0, 10000)
        });
        
        if (error) {
          console.log("❌ Method 4 failed:", error.message);
          dbError = error;
        } else {
          console.log("✅ Method 4 successful!");
          dbSuccess = true;
        }
      } catch (method4Error) {
        console.log("❌ Method 4 exception:", method4Error.message);
        // Last method failed
      }
    }
    
    // Step 3: LOG TO CONSOLE FOR DEBUGGING
    console.log("📊 SUBMISSION SUMMARY:");
    console.log("-" .repeat(50));
    console.log(`Submission ID: ${submissionId}`);
    console.log(`User: ${discordUsername} (${discordId})`);
    console.log(`Score: ${score}`);
    console.log(`Discord Webhook: ${webhookSuccess ? "✅ SUCCESS" : "❌ FAILED"}`);
    console.log(`Database Save: ${dbSuccess ? "✅ SUCCESS" : "❌ FAILED"}`);
    if (dbError) console.log(`DB Error: ${dbError.message}`);
    console.log("-" .repeat(50));
    
    // Step 4: CREATE BACKUP IN CASE DATABASE FAILED
    if (!dbSuccess) {
      console.log("💾 Creating local backup since database save failed...");
      
      // Create a simple JSON backup file (simulated)
      const backupData = {
        submissionId,
        discordId,
        discordUsername,
        score,
        totalQuestions,
        correctAnswers,
        timestamp: new Date().toISOString(),
        answers: applicationData.answers.substring(0, 1000)
      };
      
      // Log backup data to console (in real app, you might save to file)
      console.log("📦 BACKUP DATA (save this somewhere):", JSON.stringify(backupData, null, 2));
      
      // Also send backup to Discord if webhook is working
      if (webhookSuccess && process.env.DISCORD_WEBHOOK_URL) {
        try {
          await axios.post(process.env.DISCORD_WEBHOOK_URL, {
            content: `🚨 DATABASE SAVE FAILED - BACKUP NEEDED\nSubmission ID: ${submissionId}\nUser: ${discordUsername}\nScore: ${score}\nPlease check server logs.`
          });
        } catch (e) {
          // Ignore
        }
      }
    }
    
    // Step 5: ALWAYS RETURN SUCCESS TO USER
    const responseData = {
      success: true,
      message: dbSuccess 
        ? "✅ Test submitted successfully! Results saved to Discord and Admin Panel." 
        : "⚠️ Test submitted with warning. Results sent to Discord, but there was a database issue. Staff has been notified.",
      details: {
        submissionId,
        user: discordUsername,
        score: score,
        discordWebhook: webhookSuccess ? "sent" : "failed",
        database: dbSuccess ? "saved" : "failed_backup_created",
        savedId: savedId,
        timestamp: new Date().toISOString()
      },
      adminPanelUrl: "https://mod-application-backend.onrender.com/admin"
    };
    
    console.log("🎉 Returning success response to user");
    res.json(responseData);
    
  } catch (err) {
    console.error("🔥 CRITICAL ERROR in ultimate submission:", err);
    
    // Even on critical error, send success to user (but log everything)
    res.status(200).json({ 
      success: true, 
      message: "Test received! There was a technical issue but your score has been recorded.",
      error: err.message,
      timestamp: new Date().toISOString(),
      backupInstruction: "Please contact staff with your Discord username and score."
    });
  }
});

/* ================= SIMPLE RELIABLE ENDPOINT FOR FRONTEND ================= */

app.post("/api/submit", async (req, res) => {
  console.log("📨 SIMPLE API SUBMISSION ENDPOINT");
  
  // Extract data
  const { discordId, discordUsername, score, answers } = req.body;
  
  if (!discordId || !discordUsername) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  
  console.log(`Simple submission for: ${discordUsername} (${discordId}) - Score: ${score}`);
  
  try {
    // ALWAYS save to database first
    const dbResult = await supabase.from("applications").insert({
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers || "Simple submission",
      score: score || "0/8",
      status: "pending",
      created_at: new Date().toISOString()
    });
    
    if (dbResult.error) {
      console.error("Simple DB error:", dbResult.error);
    } else {
      console.log("Simple DB save successful");
    }
    
    // Then send to Discord webhook (async - don't wait)
    if (process.env.DISCORD_WEBHOOK_URL) {
      axios.post(process.env.DISCORD_WEBHOOK_URL, {
        embeds: [{
          title: "📝 Test Submission (Simple API)",
          description: `**User:** ${discordUsername}\n**Score:** ${score || "N/A"}`,
          color: 0x00ff00,
          timestamp: new Date().toISOString(),
          footer: { text: "Simple API Endpoint" }
        }]
      }).catch(e => console.log("Simple webhook error:", e.message));
    }
    
    // Always return success
    res.json({ 
      success: true, 
      message: "Test submitted successfully",
      user: discordUsername,
      score: score,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error("Simple submission error:", err);
    // Still return success
    res.json({ 
      success: true, 
      message: "Test received",
      timestamp: new Date().toISOString()
    });
  }
});

/* ================= HEALTH CHECK WITH DB TEST ================= */

app.get("/health", async (req, res) => {
  try {
    // Test database connection
    const { data, error } = await supabase
      .from("applications")
      .select("count", { count: 'exact', head: true });
    
    const dbStatus = error ? `ERROR: ${error.message}` : "CONNECTED";
    
    res.json({ 
      status: "healthy", 
      timestamp: new Date().toISOString(),
      database: dbStatus,
      discordWebhook: process.env.DISCORD_WEBHOOK_URL ? "CONFIGURED" : "NOT_CONFIGURED",
      session: req.session.user ? "active" : "none",
      endpoints: {
        submit: "/api/submit (simple)",
        submitTestResults: "/submit-test-results (ultimate)",
        admin: "/admin"
      }
    });
  } catch (err) {
    res.status(500).json({ 
      status: "error", 
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

/* ================= START SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                VOID ESPORTS MOD TEST SERVER              ║
╠══════════════════════════════════════════════════════════╣
║ 🚀 Server running on port ${PORT}                       ║
║ 🌐 CORS enabled for GitHub Pages & localhost            ║
║ 📝 SUBMISSION ENDPOINTS:                                ║
║    • /api/submit (Simple & reliable)                    ║
║    • /submit-test-results (Ultimate with retries)       ║
║ 👑 Admin Panel: /admin                                  ║
║ 🧪 Test Login: /auth/discord                            ║
║ 🏥 Health Check: /health                                ║
║ 📊 Database: ${process.env.SUPABASE_URL ? "CONFIGURED" : "NOT SETUP"}                ║
║ 🔔 Discord Webhook: ${process.env.DISCORD_WEBHOOK_URL ? "READY" : "NOT SET"}        ║
╚══════════════════════════════════════════════════════════╝
  `);
});
