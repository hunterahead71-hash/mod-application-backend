// discord-bot-worker.js - Discord Bot on Cloudflare Workers
export default {
  async fetch(request, env) {
    // This worker handles Discord interactions via webhooks
    // No need for WebSocket - use Discord's Interaction Webhook API
    
    if (request.method === 'POST') {
      const interaction = await request.json();
      
      // Handle slash commands
      if (interaction.type === 2) {
        const { name } = interaction.data;
        
        if (name === 'ping') {
          return new Response(JSON.stringify({
            type: 4,
            data: { content: 'Pong! Bot is online 🚀' }
          }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }
    
    return new Response('OK');
  },
  
  // You can also use Cron Triggers for scheduled tasks
  async scheduled(event, env, ctx) {
    // This runs on a schedule (free)
    console.log('Bot scheduled task running');
    
    // Check pending applications
    const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/applications?status=eq.pending`, {
      headers: {
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    
    const applications = await supabaseRes.json();
    console.log(`Found ${applications.length} pending applications`);
  }
};
