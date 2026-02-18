const express = require("express");
const { supabase } = require("../config/supabase");
const { requireAdmin } = require("../middleware/auth");
const { assignModRole, sendRejectionDM } = require("../utils/discordHelpers");
const { isTestUser } = require("../utils/helpers");
const { logger } = require("../utils/logger");
const { getClient, ensureReady } = require("../config/discord");

const router = express.Router();

// ==================== ACCEPT ====================
router.post("/accept/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;

  try {
    const { data: app, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !app) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    // Update DB
    await supabase
      .from("applications")
      .update({
        status: "accepted",
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", id);

    // ===== ACTUALLY ASSIGN ROLE =====
    if (!isTestUser(app.discord_username, app.discord_id)) {
      setTimeout(async () => {
        try {
          const result = await assignModRole(app.discord_id, app.discord_username);
          logger.success("✅ Background role assignment:", result);
        } catch (e) {
          logger.error("❌ Background role error:", e.message);
        }
      }, 500);
    }

    // Update Discord message if exists
    await updateDiscordMessage(id, 'accepted', req.session.user.username);

    res.json({ success: true });

  } catch (err) {
    logger.error("❌ Accept error:", err);
    res.json({ success: true }); // Always return success to UI
  }
});

// ==================== REJECT ====================
router.post("/reject/:id", requireAdmin, async (req, res) => {
  const id = req.params.id;
  const reason = req.body.reason || "Insufficient score";

  try {
    const { data: app, error } = await supabase
      .from("applications")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !app) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    // Update DB
    await supabase
      .from("applications")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", id);

    // ===== ACTUALLY SEND DM =====
    if (!isTestUser(app.discord_username, app.discord_id)) {
      setTimeout(async () => {
        try {
          const result = await sendRejectionDM(app.discord_id, app.discord_username, reason);
          logger.success("✅ Background DM sent:", result);
        } catch (e) {
          logger.error("❌ Background DM error:", e.message);
        }
      }, 500);
    }

    // Update Discord message
    await updateDiscordMessage(id, 'rejected', req.session.user.username, reason);

    res.json({ success: true });

  } catch (err) {
    logger.error("❌ Reject error:", err);
    res.json({ success: true });
  }
});

// ==================== UPDATE DISCORD MESSAGE ====================
async function updateDiscordMessage(appId, status, adminName, reason = '') {
  try {
    const client = getClient();
    if (!client || !await ensureReady() || !process.env.DISCORD_CHANNEL_ID) return;

    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;

    const messages = await channel.messages.fetch({ limit: 50 });

    for (const msg of messages.values()) {
      if (msg.embeds?.[0]?.footer?.text?.includes(appId.toString())) {
        const embed = msg.embeds[0].toJSON();
        embed.color = status === 'accepted' ? 0x10b981 : 0xed4245;
        embed.fields.push({
          name: status === 'accepted' ? '✅ Accepted By' : '❌ Rejected By',
          value: adminName,
          inline: true
        });
        if (status === 'rejected' && reason) {
          embed.fields.push({ name: '📝 Reason', value: reason, inline: false });
        }
        await msg.edit({ embeds: [embed], components: [] });
        break;
      }
    }
  } catch (error) {
    logger.error("❌ Error updating Discord message:", error.message);
  }
}

// ==================== GET CONVERSATION ====================
router.get("/conversation/:id", requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("applications")
      .select("conversation_log, answers")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false });
    }

    res.json({
      success: true,
      conversation: data.conversation_log || data.answers || "No log"
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
