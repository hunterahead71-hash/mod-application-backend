const express = require("express");
const { supabase } = require("../config/supabase");
const { logger } = require("../utils/logger");
const { getClient, ensureReady, getBot } = require("../config/discord");

const router = express.Router();

// ==================== SUBMIT TEST RESULTS ====================
router.post("/submit-test-results", async (req, res) => {
  logger.info("📨 Submission received");

  try {
    const {
      discordId,
      discordUsername,
      answers,
      conversationLog,
      score,
      totalQuestions = 8,
      correctAnswers = 0,
      testResults
    } = req.body;

    if (!discordId || !discordUsername) {
      return res.status(400).json({ success: false, error: "Missing user info" });
    }

    // Save to database
    const { data, error } = await supabase
      .from("applications")
      .insert([{
        discord_id: discordId,
        discord_username: discordUsername,
        answers: answers || "No answers",
        conversation_log: conversationLog || null,
        score: score || `${correctAnswers}/${totalQuestions}`,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        wrong_answers: totalQuestions - correctAnswers,
        test_results: testResults || "{}",
        status: "pending",
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) {
      logger.error("❌ DB error:", error);
    } else {
      logger.success("✅ Saved to DB");
    }

    const appId = data?.[0]?.id;

    // Log test submission to channel
    try {
      const { logToChannel } = require("../utils/channelLogger");
      if (typeof logToChannel === 'function') await logToChannel(
        '📝 Test Submission',
        `A new test submission was received`,
        0x5865f2,
        [
          { name: '👤 User', value: discordUsername, inline: true },
          { name: '📊 Score', value: score || `${correctAnswers}/${totalQuestions}`, inline: true },
          { name: '🆔 Application ID', value: String(appId || 'pending'), inline: true }
        ]
      );
    } catch (logError) {
      logger.warn("Failed to log submission to channel:", logError?.message || logError);
    }

    // ===== SEND TO DISCORD CHANNEL (WITH MESSAGE ID STORAGE) =====
    if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID) {
      try {
        const client = getBot(); // Use getBot() instead of getClient()
        if (client && await ensureReady()) {
          const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);

          if (channel) {
            const scoreParts = (score || "0/8").split('/');
            const scoreVal = parseInt(scoreParts[0]) || 0;
            const scoreTotal = parseInt(scoreParts[1]) || 8;

            const embed = {
              title: "📝 New Mod Test Submission",
              description: `**${discordUsername}** completed the test`,
              color: scoreVal >= 6 ? 0x10b981 : 0xed4245,
              fields: [
                {
                  name: "👤 User",
                  value: `**${discordUsername}**\n\`${discordId}\``,
                  inline: true
                },
                {
                  name: "📊 Score",
                  value: `**${scoreVal}/${scoreTotal}**\n${scoreVal >= 6 ? '✅ PASS' : '❌ FAIL'}`,
                  inline: true
                }
              ],
              footer: { text: `ID: ${appId || 'pending'}` },
              timestamp: new Date().toISOString()
            };

            const row = {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 3,
                  label: "✅ Accept",
                  custom_id: `accept_${appId || 'temp'}_${discordId}`,
                  emoji: { name: "✅" }
                },
                {
                  type: 2,
                  style: 4,
                  label: "❌ Reject",
                  custom_id: `reject_${appId || 'temp'}_${discordId}`,
                  emoji: { name: "❌" }
                },
                {
                  type: 2,
                  style: 2,
                  label: "📋 Conversation",
                  custom_id: `convo_${appId || 'temp'}_${discordId}`,
                  emoji: { name: "📋" }
                }
              ]
            };

            const message = await channel.send({ embeds: [embed], components: [row] });
            logger.success(`✅ Sent to Discord #${channel.name}`);

            // Store message ID for future updates (critical for sync)
            if (appId) {
              await supabase
                .from("applications")
                .update({ discord_message_id: message.id })
                .eq("id", appId);
              logger.info(`📝 Stored Discord message ID: ${message.id} for app ${appId}`);
            }
          }
        }
      } catch (discordError) {
        logger.error("❌ Discord send error:", discordError.message);
      }
    }

    res.json({
      success: true,
      message: "Test submitted!",
      id: appId
    });

  } catch (error) {
    logger.error("❌ Submission error:", error);
    res.status(200).json({ success: true, message: "Received" });
  }
});

// ===== FALLBACK SUBMIT ENDPOINT =====
router.post("/api/submit", async (req, res) => {
  const { discordId, discordUsername, score } = req.body;

  if (!discordId || !discordUsername) {
    return res.status(400).json({ success: false });
  }

  try {
    const { data, error } = await supabase
      .from("applications")
      .insert([{
        discord_id: discordId,
        discord_username: discordUsername,
        score: score || "0/8",
        status: "pending",
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) {
      logger.error("Fallback DB error:", error);
      return res.json({ success: true }); // Still return success to frontend
    }

    const appId = data?.[0]?.id;

    // Try to send to Discord if possible (without blocking)
    if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID && appId) {
      try {
        const client = getBot(); // Use getBot() instead of getClient()
        if (client && await ensureReady()) {
          const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
          if (channel) {
            const scoreParts = (score || "0/8").split('/');
            const scoreVal = parseInt(scoreParts[0]) || 0;
            const scoreTotal = parseInt(scoreParts[1]) || 8;

            const embed = {
              title: "📝 New Mod Test Submission (Fallback)",
              description: `**${discordUsername}** completed the test`,
              color: scoreVal >= 6 ? 0x10b981 : 0xed4245,
              fields: [
                { name: "👤 User", value: `**${discordUsername}**\n\`${discordId}\``, inline: true },
                { name: "📊 Score", value: `**${scoreVal}/${scoreTotal}**`, inline: true }
              ],
              footer: { text: `ID: ${appId}` },
              timestamp: new Date().toISOString()
            };

            const row = {
              type: 1,
              components: [
                { type: 2, style: 3, label: "✅ Accept", custom_id: `accept_${appId}_${discordId}`, emoji: { name: "✅" } },
                { type: 2, style: 4, label: "❌ Reject", custom_id: `reject_${appId}_${discordId}`, emoji: { name: "❌" } },
                { type: 2, style: 2, label: "📋 Conversation", custom_id: `convo_${appId}_${discordId}`, emoji: { name: "📋" } }
              ]
            };

            const message = await channel.send({ embeds: [embed], components: [row] });
            
            // Store message ID
            await supabase
              .from("applications")
              .update({ discord_message_id: message.id })
              .eq("id", appId);
          }
        }
      } catch (discordError) {
        // Non-critical, don't log loudly
      }
    }

    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// ===== GET APPLICATION STATUS =====
router.get("/application/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from("applications")
      .select("id, discord_username, status, score, reviewed_by, reviewed_at, rejection_reason")
      .eq("id", id)
      .single();
    
    if (error || !data) {
      return res.status(404).json({ success: false, error: "Application not found" });
    }
    
    res.json({ success: true, application: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== GET APPLICATION BY DISCORD ID =====
router.get("/user/:discordId", async (req, res) => {
  try {
    const { discordId } = req.params;
    
    const { data, error } = await supabase
      .from("applications")
      .select("*")
      .eq("discord_id", discordId)
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    
    res.json({ 
      success: true, 
      hasApplication: data && data.length > 0,
      application: data?.[0] || null
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== GET ACTIVE TEST QUESTIONS (PUBLIC - NO AUTH REQUIRED) =====
router.get("/api/test-questions/active", async (req, res) => {
  try {
    const { supabase } = require("../config/supabase");
    // CRITICAL: Only fetch questions where enabled = true
    const { data, error } = await supabase
      .from("test_questions")
      .select("*")
      .eq("enabled", true)  // Only enabled questions
      .order("order", { ascending: true })
      .order("id", { ascending: true });
    
    if (error) {
      logger.warn("Active test questions error:", error.message);
      // Return empty array if DB fails - frontend will use defaults
      return res.json({ success: true, questions: [] });
    }
    
    // Double-check: filter out any questions that might have enabled = false
    const enabledQuestions = (data || []).filter(q => q.enabled === true);
    
    logger.info(`📋 Returning ${enabledQuestions.length} enabled question(s) out of ${data?.length || 0} total`);
    
    res.json({ success: true, questions: enabledQuestions });
  } catch (err) {
    logger.error("Get active test questions error:", err);
    res.json({ success: true, questions: [] });
  }
});

module.exports = router;
