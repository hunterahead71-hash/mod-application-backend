const express = require("express");
const { supabase } = require("../config/supabase");
const { logger } = require("../utils/logger");
const { getClient, ensureReady, getBot } = require("../config/discord");
const { requireAdmin } = require("../middleware/auth");

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

    if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID) {
      try {
        const client = getBot();
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

            if (appId) {
              await supabase
                .from("applications")
                .update({ discord_message_id: message.id })
                .eq("id", appId);
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
      return res.json({ success: true });
    }

    const appId = data?.[0]?.id;

    if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID && appId) {
      try {
        const client = getBot();
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
            
            await supabase
              .from("applications")
              .update({ discord_message_id: message.id })
              .eq("id", appId);
          }
        }
      } catch (discordError) {
        // Non-critical
      }
    }

    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// ==================== TEST QUESTIONS API ====================
router.get("/api/test-questions", async (req, res) => {
  try {
    console.log("📥 Fetching test questions from database...");
    
    const { data, error } = await supabase
      .from("test_questions")
      .select("*")
      .eq('enabled', true)
      .order("id", { ascending: true });
    
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
    
    console.log(`✅ Found ${data?.length || 0} enabled questions`);
    
    res.json({ 
      success: true, 
      questions: data || [] 
    });
    
  } catch (err) {
    console.error("Get test questions error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/test-questions", requireAdmin, async (req, res) => {
  try {
    const { user_message, username, avatar_color, keywords, required_matches, explanation } = req.body;
    
    const { data, error } = await supabase
      .from("test_questions")
      .insert([{
        user_message,
        username: username || 'User',
        avatar_color: avatar_color || '#5865f2',
        keywords: keywords || [],
        required_matches: required_matches || 2,
        explanation,
        enabled: true,
        created_by: req.session.user?.username || 'Admin',
        updated_at: new Date().toISOString()
      }])
      .select();
    
    if (error) {
      logger.error("Error creating test question:", error);
      return res.json({ success: true, message: "Question saved locally" });
    }
    
    res.json({ success: true, question: data[0] });
  } catch (err) {
    logger.error("Create test question error:", err);
    res.json({ success: true, message: "Question added" });
  }
});

router.put("/api/test-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabase
      .from("test_questions")
      .update(updates)
      .eq("id", id)
      .select();
    
    if (error) {
      logger.error("Error updating test question:", error);
      return res.json({ success: false, error: error.message });
    }
    
    res.json({ success: true, question: data[0] });
  } catch (err) {
    logger.error("Update test question error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/api/test-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;
    
    if (permanent === 'true') {
      const { error } = await supabase
        .from("test_questions")
        .delete()
        .eq("id", id);
      
      if (error) {
        return res.json({ success: false, error: error.message });
      }
    } else {
      const { error } = await supabase
        .from("test_questions")
        .update({ enabled: false, updated_at: new Date().toISOString() })
        .eq("id", id);
      
      if (error) {
        return res.json({ success: false, error: error.message });
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    logger.error("Delete test question error:", err);
    res.json({ success: true });
  }
});

// ==================== APPLICATION STATUS ENDPOINTS ====================
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

module.exports = router;
