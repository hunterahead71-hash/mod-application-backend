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
    timestamp: new Date().toISOString(),
    session: req.sessionID ? "active" : "none"
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

// ==================== SIMPLIFIED SUBMISSION ENDPOINT ====================

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
    
    if (!discordId || !discordUsername) {
      return res.status(400).json({ 
        success: false, 
        message: "Missing discordId or discordUsername" 
      });
    }
    
    const submissionId = `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Send webhook with SIMPLIFIED conversation log
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        logger.info(`📤 Sending webhook to: ${process.env.DISCORD_WEBHOOK_URL.substring(0, 50)}...`);
        
        // Use the provided conversation log (which should already be simplified)
        let conversationPreview = conversationLog || answers || "No conversation log provided";
        
        // Truncate if too long (Discord has 2000 char limit per field)
        if (conversationPreview.length > 1800) {
          conversationPreview = conversationPreview.substring(0, 1800) + "\n...(log truncated)...";
        }
        
        // Format the score nicely
        const scoreParts = score ? score.split('/') : ['0', '8'];
        const scoreValue = parseInt(scoreParts[0]) || 0;
        const scoreTotal = parseInt(scoreParts[1]) || 8;
        const passStatus = scoreValue >= 6 ? "✅ PASS" : "❌ FAIL";
        
        // Create a clean embed
        const embed = {
          title: "📝 New Mod Test Submission",
          description: `**${discordUsername}** has completed the certification test`,
          color: scoreValue >= 6 ? 0x3ba55c : 0xed4245, // Green for pass, red for fail
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
              name: "📝 Questions & Answers",
              value: `\`\`\`\n${conversationPreview}\n\`\`\``,
              inline: false
            }
          ],
          footer: {
            text: `Submission ID: ${submissionId} • ${new Date().toLocaleString()}`
          },
          timestamp: new Date().toISOString()
        };
        
        // Send the webhook
        const webhookResponse = await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          embeds: [embed]
        }, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        logger.success(`✅ Webhook sent successfully! Status: ${webhookResponse.status}`);
      } catch (webhookError) {
        logger.error("❌ Webhook error:", webhookError.message);
        
        // Try alternative format if first attempt fails
        try {
          logger.info("Attempting alternative webhook format...");
          
          // Simple text message as fallback
          const simpleMessage = {
            content: `**New Test Submission**\nUser: ${discordUsername}\nScore: ${score || "0/8"}\nDiscord ID: ${discordId}`
          };
          
          const fallbackResponse = await axios.post(process.env.DISCORD_WEBHOOK_URL, simpleMessage, {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 10000
          });
          
          logger.success(`✅ Fallback webhook sent! Status: ${fallbackResponse.status}`);
        } catch (fallbackError) {
          logger.error("❌ Fallback webhook also failed:", fallbackError.message);
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
    
    // Send webhook for simple API
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        let logPreview = conversationLog || answers || "No log provided";
        if (logPreview.length > 1000) {
          logPreview = logPreview.substring(0, 1000) + "\n...(truncated)...";
        }
        
        const simpleEmbed = {
          title: "📝 Test Submission (Simple API)",
          description: `**User:** ${discordUsername}\n**Score:** ${score || "N/A"}\n**Discord ID:** ${discordId}`,
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
