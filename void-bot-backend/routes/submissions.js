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
    
    // Save to database FIRST (so we have the application ID)
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
    
    let applicationId = null;
    const { data, error } = await supabase
      .from("applications")
      .insert([applicationData])
      .select();
    
    if (error) {
      logger.error("Database insert error:", error.message);
    } else {
      logger.success("✅ Database save successful");
      applicationId = data?.[0]?.id;
    }
    
    // ===== BOT MESSAGE TO CHANNEL =====
    // Send to Discord channel using bot (not webhook)
    if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID) {
      try {
        logger.info(`📤 Sending bot message to channel ${process.env.DISCORD_CHANNEL_ID}...`);
        
        const scoreParts = score ? score.split('/') : ['0', '8'];
        const scoreValue = parseInt(scoreParts[0]) || 0;
        const scoreTotal = parseInt(scoreParts[1]) || 8;
        const passStatus = scoreValue >= 6 ? "✅ PASS" : "❌ FAIL";
        
        // Create the embed with action buttons
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
            }
          ],
          footer: {
            text: `Application ID: ${applicationId || 'pending'}`
          },
          timestamp: new Date().toISOString()
        };
        
        // Get bot instance
        const { getBot, ensureBotReady } = require("../config/discord");
        const bot = getBot();
        
        if (bot && await ensureBotReady()) {
          // Get the channel
          const channel = await bot.channels.fetch(process.env.DISCORD_CHANNEL_ID);
          
          if (channel) {
            // Send the embed
            const message = await channel.send({ embeds: [embed] });
            
            // Add buttons as components
            const row = {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: "✅ Accept",
                  custom_id: `accept_${applicationId || submissionId}_${discordId}`,
                  emoji: { name: "✅" }
                },
                {
                  type: 2,
                  style: 4,
                  label: "❌ Reject",
                  custom_id: `reject_${applicationId || submissionId}_${discordId}`,
                  emoji: { name: "❌" }
                },
                {
                  type: 2,
                  style: 2,
                  label: "📋 Conversation Log",
                  custom_id: `convo_${applicationId || submissionId}_${discordId}`,
                  emoji: { name: "📋" }
                }
              ]
            };
            
            // Edit message to add components
            await message.edit({ embeds: [embed], components: [row] });
            
            // FIX: ONLY send conversation log if it's not already included and if it's not too long
            // REMOVED the automatic sending of conversation log parts to avoid duplication
            // The conversation log is now only accessible via the button
            
            logger.success(`✅ Main submission message sent with buttons!`);
            
          } else {
            logger.error("❌ Could not fetch channel");
          }
        } else {
          logger.error("❌ Bot not ready");
        }
        
      } catch (botError) {
        logger.error("❌ Bot message error:", botError.message);
      }
    } else {
      logger.warn("⚠️ DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID not set - skipping bot notification");
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
    
    const { data, error } = await supabase.from("applications").insert([applicationData]).select();
    
    if (error) {
      logger.error("Simple DB error:", error);
    } else {
      logger.success("✅ Simple DB save successful");
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
