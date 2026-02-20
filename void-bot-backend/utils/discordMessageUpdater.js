const { getClient, ensureReady } = require("../config/discord");
const { supabase } = require("../config/supabase");
const { logger } = require("./logger");

async function updateDiscordMessage(appId, status, adminName, reason = "") {
  try {
    const client = getClient();
    if (!client || !(await ensureReady()) || !process.env.DISCORD_CHANNEL_ID) {
      logger.warn("Cannot update Discord message: Bot not ready or channel not configured");
      return false;
    }

    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    if (!channel) {
      logger.error(`Channel ${process.env.DISCORD_CHANNEL_ID} not found`);
      return false;
    }

    const messages = await channel.messages.fetch({ limit: 100 });

    for (const [, msg] of messages) {
      if (msg.embeds && msg.embeds.length > 0) {
        const embed = msg.embeds[0];
        const footerText = embed.footer?.text || "";

        if (footerText.includes(appId.toString())) {
          logger.info(`Found Discord message ${msg.id} for app ${appId}`);

          const updatedEmbed = {
            ...embed.toJSON(),
            color: status === "accepted" ? 0x10b981 : 0xed4245,
          };

          const fields = (embed.fields || []).filter(
            (f) =>
              !f.name.includes("Accepted") &&
              !f.name.includes("Rejected") &&
              !f.name.includes("Reason")
          );

          fields.push({
            name: status === "accepted" ? "✅ Accepted By" : "❌ Rejected By",
            value: adminName,
            inline: true,
          });

          if (status === "rejected" && reason) {
            fields.push({
              name: "📝 Reason",
              value: reason.substring(0, 100),
              inline: false,
            });
          }

          updatedEmbed.fields = fields;

          await msg.edit({
            embeds: [updatedEmbed],
            components: [],
          });

          logger.success(`✅ Updated Discord message ${msg.id} to ${status}`);

          try {
            await supabase
              .from("applications")
              .update({ discord_message_id: msg.id })
              .eq("id", appId);
          } catch (dbError) {}

          return true;
        }
      }
    }

    logger.warn(`No Discord message found for app ${appId} in last 100 messages`);
    return false;
  } catch (error) {
    logger.error("❌ Error updating Discord message:", error.message);
    return false;
  }
}

async function editReviewedEmbed(interaction, status, adminName, note, appId) {
  try {
    const originalEmbed = interaction.message?.embeds?.[0]?.toJSON();
    if (!originalEmbed) return;

    const embed = { ...originalEmbed };
    embed.color = status === "accepted" ? 0x10b981 : 0xed4245;

    embed.fields = (embed.fields || []).filter(
      (f) =>
        !f.name.includes("Accepted") &&
        !f.name.includes("Rejected") &&
        !f.name.includes("Reason")
    );

    embed.fields.push({
      name: status === "accepted" ? "✅ Accepted By" : "❌ Rejected By",
      value: `${adminName}${note || ""}`,
      inline: false,
    });

    await interaction.editReply({ embeds: [embed], components: [] });
    logger.success(`✅ Discord embed updated to ${status} for app ${appId}`);
  } catch (err) {
    logger.error("❌ editReviewedEmbed error:", err.message);
  }
}

module.exports = {
  updateDiscordMessage,
  editReviewedEmbed,
};
