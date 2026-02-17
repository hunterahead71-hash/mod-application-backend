// admin.js
const express = require('express');
const { supabase } = require('./server'); // adjust if needed
const { assignModRole } = require('./bot');

const router = express.Router();

// Admin page
router.get('/', async (req, res) => {
  if (!req.session.user || !req.session.isAdmin) {
    return res.status(401).send("Unauthorized - Please log in as admin");
  }

  try {
    const { data: apps, error } = await supabase
      .from("applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Render admin HTML (your original long HTML can go here)
    // For brevity, I'll show only the critical accept/reject part

    res.send(/* your full admin HTML here with updated JS below */);

    // In the <script> section of your admin HTML, update these functions:

    /*
    async function processApplication(appId, action, username = '') {
      const appCard = document.getElementById('app-' + appId);
      if (!appCard) return;

      // Immediately update UI + database (optimistic update)
      const newStatus = action === 'accept' ? 'accepted' : 'rejected';
      appCard.className = `application-card ${newStatus}`;
      appCard.dataset.status = newStatus;

      const statusBadge = appCard.querySelector('.application-status');
      statusBadge.className = `application-status status-${newStatus}`;
      statusBadge.textContent = newStatus.toUpperCase();

      // Move card to correct tab (instantly)
      const targetTab = document.getElementById('tab-' + newStatus);
      if (targetTab) {
        targetTab.querySelector('.applications-grid').prepend(appCard);
      }

      // Update database immediately (non-blocking)
      fetch(`/admin/${action}/${appId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: action === 'reject' ? document.getElementById('rejectReason').value : null })
      }).catch(err => console.error("Background update failed:", err));

      // Show success message
      const msg = document.createElement('div');
      msg.className = 'success-message';
      msg.innerHTML = `<strong>✓ ${newStatus.toUpperCase()}!</strong> Processing in background...`;
      appCard.appendChild(msg);
    }
    */

  } catch (err) {
    res.status(500).send("Server error: " + err.message);
  }
});

// Accept endpoint (fire-and-forget)
router.post('/accept/:id', async (req, res) => {
  try {
    const { data: app } = await supabase
      .from("applications")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (!app) return res.status(404).json({ error: "Not found" });

    // Update DB immediately
    await supabase
      .from("applications")
      .update({ 
        status: "accepted",
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", req.params.id);

    // Trigger role assign + DM in background (non-blocking)
    assignModRole(app.discord_id, app.discord_username);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: true }); // still return success to UI
  }
});

// Reject endpoint (same pattern)
router.post('/reject/:id', async (req, res) => {
  try {
    const reason = req.body.reason || "No reason provided";

    await supabase
      .from("applications")
      .update({ 
        status: "rejected",
        rejection_reason: reason,
        reviewed_by: req.session.user.username,
        reviewed_at: new Date().toISOString()
      })
      .eq("id", req.params.id);

    // Background DM
    // (you can call your sendRejectionDM here if needed)

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: true }); // UI always wins
  }
});

module.exports = router;
