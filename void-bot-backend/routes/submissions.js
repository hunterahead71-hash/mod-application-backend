const express = require("express");
const axios = require("axios");
const { supabase } = require("../config/supabase");
const { logger } = require("../utils/logger");

const router = express.Router();

// ==================== TEST START ENDPOINT ====================
router.get("/api/start-test", (req, res) => {
  console.log("🎯 Test start endpoint called");
  res.json({ 
    success: true, 
    message: "Test can be started",
    timestamp: new Date().toISOString()
  });
});

router.post("/api/start-test", (req, res) => {
  console.log("🎯 Test start endpoint called (POST)");
  res.json({ 
    success: true, 
    message: "Test can be started",
    timestamp: new Date().toISOString()
  });
});

router.options("/api/start-test", (req, res) => {
  res.header('Access-Control-Allow-Origin', 'https://hunterahead71-hash.github.io');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// ==================== MAIN SUBMISSION ENDPOINT ====================
router.post("/submit-test-results", async (req, res) => {
  logger.info("🚀 SUBMISSION ENDPOINT CALLED");
  
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
    
    logger.info(`Submission for: ${discordUsername} (${discordId})`);
    logger.info(`Score: ${score}`);
    
    if (!discordId || !discordUsername) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing discordId or discordUsername" 
      });
    }
    
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Parse test results if provided
    let parsedTestResults = {};
    try {
      parsedTestResults = testResults ? JSON.parse(testResults) : {};
    } catch (e) {
      parsedTestResults = { raw: testResults };
    }
    
    // Check if we need to send multiple messages (from testResults)
    const needsMultipleMessages = parsedTestResults.messageCount > 1;
    
    // Send webhook with conversation log
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        logger.info(`📤 Sending webhook to Discord...`);
        
        const scoreParts = score ? score.split('/') : ['0', '8'];
        const scoreValue = parseInt(scoreParts[0]) || 0;
        const scoreTotal = parseInt(scoreParts[1]) || 8;
        const passStatus = scoreValue >= 6 ? "✅ PASS" : "❌ FAIL";
        
        // Create the embed
        const embed = {
          title: "📝 New Mod Test Submission",
          description: `**${discordUsername}** has completed the certification test`,
          color: scoreValue >= 6 ? 0x10b981 : 0xed4245,
          fields: [
            {
              name: "👤 User Info",
              value: `**Username:** ${discordUsername}\n**Discord ID:** \`${discordId}\``,
              inline: true
            },
            {
              name: "📊 Score",
              value: `**${scoreValue}/${scoreTotal}**\n${passStatus}`,
              inline: true
            },
            {
              name: "📝 Message Count",
              value: needsMultipleMessages ? `**${parsedTestResults.messageCount || 1} messages**` : "**Complete transcript in following messages**",
              inline: true
            }
          ],
          footer: {
            text: `Submission ID: ${submissionId}`
          },
          timestamp: new Date().toISOString()
        };
        
        // Send the embed
        await axios({
          method: 'post',
          url: process.env.DISCORD_WEBHOOK_URL,
          data: { embeds: [embed] },
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        
        logger.success(`✅ Embed sent successfully!`);
        
        // Now send the conversation log - split if needed
        let conversationToSend = conversationLog || answers || "No conversation log provided";
        
        // If conversation is too long, split it
        const maxLength = 1900;
        if (conversationToSend.length > maxLength) {
          logger.info(`Conversation log length: ${conversationToSend.length}, splitting into multiple messages`);
          
          // Split by sections
          const sections = conversationToSend.split('┌──────────────────────────────────────────────────────────────────────────┐');
          let currentMessage = "";
          let messageCount = 0;
          
          for (let i = 1; i < sections.length; i++) {
            const section = '┌──────────────────────────────────────────────────────────────────────────┐' + sections[i];
            
            if ((currentMessage + section).length > maxLength) {
              // Send current message
              if (currentMessage) {
                await axios({
                  method: 'post',
                  url: process.env.DISCORD_WEBHOOK_URL,
                  data: { 
                    content: `\`\`\`\n${currentMessage}\n\`\`\``
                  },
                  headers: { 'Content-Type': 'application/json' },
                  timeout: 10000
                });
                messageCount++;
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              
              // Start new message
              currentMessage = `PART ${messageCount + 1}\n══════════════════════════════════════════════════════════════════════════════\n` + section;
            } else {
              currentMessage += section;
            }
          }
          
          // Send last message
          if (currentMessage) {
            await axios({
              method: 'post',
              url: process.env.DISCORD_WEBHOOK_URL,
              data: { 
                content: `\`\`\`\n${currentMessage}\n\`\`\``
              },
              headers: { 'Content-Type': 'application/json' },
              timeout: 10000
            });
            messageCount++;
          }
          
          logger.success(`✅ Sent ${messageCount} message parts`);
          
        } else {
          // Send as single message
          await axios({
            method: 'post',
            url: process.env.DISCORD_WEBHOOK_URL,
            data: { 
              content: `\`\`\`\n${conversationToSend}\n\`\`\``
            },
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          });
          
          logger.success(`✅ Conversation log sent successfully!`);
        }
        
      } catch (webhookError) {
        logger.error("❌ Webhook error:", webhookError.message);
        
        // Try alternative format
        try {
          logger.info("Attempting alternative webhook format...");
          
          let contentLog = conversationLog || answers || "No conversation log";
          if (contentLog.length > 1800) {
            contentLog = contentLog.substring(0, 1800) + "...(truncated)";
          }
          
          const contentMessage = {
            content: `**New Test Submission - ${discordUsername}**\nScore: ${score}\n\`\`\`\n${contentLog}\n\`\`\``
          };
          
          await axios({
            method: 'post',
            url: process.env.DISCORD_WEBHOOK_URL,
            data: contentMessage,
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
          });
          
          logger.success(`✅ Alternative webhook sent!`);
          
        } catch (altError) {
          logger.error("❌ Alternative webhook failed:", altError.message);
        }
      }
    } else {
      logger.warn("⚠️ DISCORD_WEBHOOK_URL not set - skipping webhook notification");
    }
    
    // Save to database
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: conversationLog || answers || "No conversation log",
      conversation_log: conversationLog || null,
      questions_with_answers: questionsWithAnswers ? JSON.stringify(questionsWithAnswers) : null,
      score: score || "0/8",
      total_questions: parseInt(totalQuestions) || 8,
      correct_answers: parseInt(correctAnswers) || 0,
      wrong_answers: parseInt(wrongAnswers) || 8,
      test_results: testResults ? JSON.stringify(testResults) : "{}",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const { data, error } = await supabase
      .from("applications")
      .insert([applicationData])
      .select();
    
    if (error) {
      logger.error("Database insert error:", error.message);
    } else {
      logger.success("✅ Database save successful");
    }
    
    res.json({
      success: true,
      message: "✅ Test submitted successfully!",
      details: {
        submissionId,
        user: discordUsername,
        score: score,
        savedId: data?.[0]?.id
      }
    });
    
  } catch (err) {
    logger.error("🔥 CRITICAL ERROR:", err);
    res.status(200).json({ 
      success: true, 
      message: "Test received!",
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== SIMPLE API ENDPOINT ====================
router.post("/api/submit", async (req, res) => {
  logger.info("📨 SIMPLE API SUBMISSION");
  
  const { discordId, discordUsername, score, answers, conversationLog, questionsWithAnswers } = req.body;
  
  if (!discordId || !discordUsername) {
    return res.status(400).json({ 
      success: false,
      error: "Missing required fields" 
    });
  }
  
  try {
    let correctAnswers = 0;
    let totalQuestions = 8;
    
    if (score && score.includes('/')) {
      const parts = score.split('/');
      correctAnswers = parseInt(parts[0]) || 0;
      totalQuestions = parseInt(parts[1]) || 8;
    }
    
    const applicationData = {
      discord_id: discordId,
      discord_username: discordUsername,
      answers: answers || "Simple submission",
      conversation_log: conversationLog || null,
      questions_with_answers: questionsWithAnswers ? JSON.stringify(questionsWithAnswers) : null,
      score: score || "0/8",
      total_questions: totalQuestions,
      correct_answers: correctAnswers,
      wrong_answers: totalQuestions - correctAnswers,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    const dbResult = await supabase.from("applications").insert([applicationData]);
    
    if (dbResult.error) {
      logger.error("Simple DB error:", dbResult.error);
    } else {
      logger.success("✅ Simple DB save successful");
    }
    
    // Send webhook
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        let logPreview = conversationLog || answers || "No log provided";
        if (logPreview.length > 1500) {
          logPreview = logPreview.substring(0, 1500) + "\n...(truncated)...";
        }
        
        const simpleEmbed = {
          title: "📝 Test Submission",
          description: `**User:** ${discordUsername}\n**Score:** ${score || "N/A"}`,
          fields: [
            {
              name: "📝 Conversation Log",
              value: `\`\`\`\n${logPreview}\n\`\`\``,
              inline: false
            }
          ],
          color: 0x5865f2,
          timestamp: new Date().toISOString()
        };
        
        await axios.post(process.env.DISCORD_WEBHOOK_URL, { embeds: [simpleEmbed] }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        });
        
        logger.success("✅ Simple API webhook sent");
      } catch (webhookError) {
        logger.error("Simple API webhook error:", webhookError.message);
      }
    }
    
    res.json({ 
      success: true, 
      message: "Test submitted successfully!",
      user: discordUsername,
      score: score || "0/8",
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    logger.error("Simple submission error:", err);
    res.json({ 
      success: true, 
      message: "Test received",
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
