const express = require("express");
const { supabase } = require("../config/supabase");
const { requireAdmin } = require("../middleware/auth");
const { assignModRole, sendRejectionDM } = require("../utils/discordHelpers");
const { logger } = require("../utils/logger");
const { getClient, ensureReady } = require("../config/discord");

const router = express.Router();

// ==================== ACCEPT ====================
// FIX: Removed isTestUser() check — it was blocking role assignment for the admin test user.
// Role assignment now always fires for every accepted application.
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

    // Update DB immediately
    await supabase
      .from("applications")
      .update({
        status: "accepted",
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", id);

    // Respond to UI first so it doesn't time out
    res.json({ success: true });

    // Then do Discord work in background
    setTimeout(async () => {
      try {
        logger.info(`🎯 [Admin Portal Accept] Assigning role to ${app.discord_username} (${app.discord_id})`);
        const result = await assignModRole(app.discord_id, app.discord_username);
        logger.info(`Role result: ${JSON.stringify(result)}`);

        if (!result.success) {
          logger.error(`❌ Role failed: ${result.error}`);
        } else if (result.assigned?.length > 0) {
          logger.success(`✅ Role(s) assigned: ${result.assigned.map(r => r.name).join(', ')}`);
          logger.info(`DM sent: ${result.dmSent}`);
        } else {
          logger.warn(`⚠️ No roles assigned (check MOD_ROLE_ID env var and role hierarchy)`);
        }

        // Update the Discord notification message
        await updateDiscordMessage(id, 'accepted', req.session?.user?.username || 'Admin');
      } catch (e) {
        logger.error(`❌ Background accept error: ${e.message}`);
      }
    }, 100);

  } catch (err) {
    logger.error("❌ Accept error:", err);
    res.json({ success: true }); // Always return success to UI
  }
});

// ==================== REJECT ====================
// FIX: Removed isTestUser() check — DM now always fires for every rejected application.
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

    // Update DB immediately
    await supabase
      .from("applications")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", id);

    // Respond to UI first
    res.json({ success: true });

    // Then do Discord work in background
    setTimeout(async () => {
      try {
        logger.info(`📨 [Admin Portal Reject] Sending rejection DM to ${app.discord_username} (${app.discord_id})`);
        const result = await sendRejectionDM(app.discord_id, app.discord_username, reason);
        logger.info(`DM result: ${result}`);

        if (!result) {
          logger.warn(`⚠️ Rejection DM failed — user may have DMs disabled or bot is not in their guild`);
        }

        await updateDiscordMessage(id, 'rejected', req.session?.user?.username || 'Admin', reason);
      } catch (e) {
        logger.error(`❌ Background reject error: ${e.message}`);
      }
    }, 100);

  } catch (err) {
    logger.error("❌ Reject error:", err);
    res.json({ success: true });
  }
});

// ==================== UPDATE DISCORD MESSAGE ====================
// Updates the notification embed in the Discord channel when reviewed via admin portal
async function updateDiscordMessage(appId, status, adminName, reason = '') {
  try {
    const client = getClient();
    if (!client) return;
    if (!await ensureReady()) return;
    if (!process.env.DISCORD_CHANNEL_ID) return;

    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;

    const messages = await channel.messages.fetch({ limit: 50 });

    for (const msg of messages.values()) {
      if (msg.embeds?.[0]?.footer?.text?.includes(appId.toString())) {
        const embed = msg.embeds[0].toJSON();
        embed.color = status === 'accepted' ? 0x10b981 : 0xed4245;

        // Remove old status fields to avoid duplication
        embed.fields = (embed.fields || []).filter(f =>
          !f.name.includes('Accepted By') && !f.name.includes('Rejected By')
        );

        embed.fields.push({
          name: status === 'accepted' ? '✅ Accepted By' : '❌ Rejected By',
          value: `${adminName} (Admin Portal)`,
          inline: true
        });

        if (status === 'rejected' && reason) {
          embed.fields.push({ name: '📝 Reason', value: reason, inline: false });
        }

        // Remove buttons so they can't be double-clicked
        await msg.edit({ embeds: [embed], components: [] });
        logger.success(`✅ Discord message updated to ${status}`);
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
      conversation: data.conversation_log || data.answers || "No log available"
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
