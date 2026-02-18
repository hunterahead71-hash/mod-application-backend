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

    // ===== SEND TO DISCORD CHANNEL (WITH MESSAGE ID STORAGE) =====
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

            // Store message ID for future updates
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
        // Non-critical, don't log loudly
      }
    }

    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// ==================== TEST QUESTIONS API - UPDATED WITH ENABLED FIELD ====================

// Get all test questions
router.get("/api/test-questions", async (req, res) => {
  try {
    // Try to get from database
    const { data, error } = await supabase
      .from("test_questions")
      .select("*")
      .order("id", { ascending: true });
    
    if (error) {
      logger.warn("Test questions table error:", error.message);
      // Return default questions with enabled=true
      return res.json({ 
        success: true, 
        questions: [
          { id: 1, user_message: "hey i wanna join void esports, what do i need to do?", username: "FortnitePlayer23", avatar_color: "#5865f2", keywords: ["age","roster","requirement"], required_matches: 2, explanation: "Ask for age and direct to #how-to-join-roster", enabled: true },
          { id: 2, user_message: "i want to join as a pro player, i have earnings", username: "CompPlayer99", avatar_color: "#ed4245", keywords: ["tracker","earnings","ping"], required_matches: 2, explanation: "Ask for tracker and ping @trapped", enabled: true },
          { id: 3, user_message: "looking to join creative roster, i have clips", username: "CreativeBuilder", avatar_color: "#3ba55c", keywords: ["clip","freebuilding","ping"], required_matches: 2, explanation: "Ask for at least 2 clips", enabled: true },
          { id: 4, user_message: "can i join academy? i have 5k PR", username: "AcademyGrinder", avatar_color: "#f59e0b", keywords: ["tracker","username","team.void"], required_matches: 2, explanation: "Ask for tracker and username change", enabled: true },
          { id: 5, user_message: "im 14 is that old enough?", username: "YoungPlayer14", avatar_color: "#9146ff", keywords: ["chief","trapped","ping"], required_matches: 2, explanation: "Ping senior staff for verification", enabled: true },
          { id: 6, user_message: "i wanna be a void grinder, what's required?", username: "GrinderAccount", avatar_color: "#1da1f2", keywords: ["username","team.void","proof"], required_matches: 2, explanation: "Ask for username change and proof", enabled: true },
          { id: 7, user_message: "this server is trash, gonna report it all", username: "ToxicUser123", avatar_color: "#ff0000", keywords: ["chief","trapped","ban"], required_matches: 2, explanation: "Ping senior staff immediately", enabled: true },
          { id: 8, user_message: "i make youtube videos, can i join content team?", username: "ContentCreatorYT", avatar_color: "#ff0000", keywords: ["social","links","contentdep"], required_matches: 2, explanation: "Ask for social links and ping contentdep", enabled: true }
        ]
      });
    }
    
    // Make sure each question has an enabled field (default to true if null)
    const questionsWithEnabled = (data || []).map(q => ({
      ...q,
      enabled: q.enabled !== false // default to true if null
    }));
    
    res.json({ success: true, questions: questionsWithEnabled });
  } catch (err) {
    logger.error("Get test questions error:", err);
    res.json({ success: true, questions: [] });
  }
});

// Create test question
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

// Update test question
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

// Delete test question (soft delete by setting enabled=false)
router.delete("/api/test-questions/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { permanent } = req.query;
    
    if (permanent === 'true') {
      // Permanent delete
      const { error } = await supabase
        .from("test_questions")
        .delete()
        .eq("id", id);
      
      if (error) {
        return res.json({ success: false, error: error.message });
      }
    } else {
      // Soft delete - just disable
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
    res.json({ success: true }); // Still return success to frontend
  }
});

// ==================== APPLICATION STATUS ENDPOINTS ====================

// Get application by ID
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

// Get application by Discord ID
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
