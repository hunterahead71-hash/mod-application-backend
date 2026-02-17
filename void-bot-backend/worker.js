// worker.js - Cloudflare Worker (100% free, no sleep)
import { Router } from 'itty-router';

// Create router
const router = Router();

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://hunterahead71-hash.github.io',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

// Helper for responses
const json = (data, status = 200) => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
};

// ==================== SESSION MANAGEMENT ====================
// Cloudflare Workers don't have persistent sessions, so we use KV store
async function getSession(request, env) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return null;
  
  const sessionId = cookie.split('session=')[1]?.split(';')[0];
  if (!sessionId) return null;
  
  return await env.SESSIONS.get(sessionId, { type: 'json' });
}

async function setSession(env, sessionId, data) {
  await env.SESSIONS.put(sessionId, JSON.stringify(data), {
    expirationTtl: 86400, // 24 hours
  });
}

// ==================== AUTH ENDPOINTS ====================
router.get('/auth/discord', async (request, env) => {
  const url = new URL(request.url);
  const intent = url.searchParams.get('intent') || 'test';
  
  // Generate state for CSRF protection
  const state = crypto.randomUUID();
  await env.SESSIONS.put(`oauth_${state}`, intent, { expirationTtl: 300 });
  
  const discordAuthUrl = new URL('https://discord.com/api/oauth2/authorize');
  discordAuthUrl.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  discordAuthUrl.searchParams.set('redirect_uri', env.REDIRECT_URI);
  discordAuthUrl.searchParams.set('response_type', 'code');
  discordAuthUrl.searchParams.set('scope', 'identify');
  discordAuthUrl.searchParams.set('state', state);
  
  return Response.redirect(discordAuthUrl.toString(), 302);
});

router.get('/auth/discord/callback', async (request, env) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  
  // Verify state
  const intent = await env.SESSIONS.get(`oauth_${state}`);
  if (!intent) {
    return new Response('Invalid state', { status: 400 });
  }
  await env.SESSIONS.delete(`oauth_${state}`);
  
  // Exchange code for token
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.REDIRECT_URI,
    }),
  });
  
  const tokenData = await tokenRes.json();
  
  // Get user info
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  
  const userData = await userRes.json();
  
  // Create session
  const sessionId = crypto.randomUUID();
  const sessionData = {
    user: userData,
    isAdmin: env.ADMIN_IDS?.split(',').includes(userData.id) || false,
    intent,
  };
  
  await setSession(env, sessionId, sessionData);
  
  // Redirect based on intent
  if (intent === 'admin' && sessionData.isAdmin) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: 'https://hunterahead71-hash.github.io/void.training/admin',
        'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`,
        ...corsHeaders,
      },
    });
  }
  
  // Test intent - redirect to frontend with user data
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://hunterahead71-hash.github.io/void.training/?startTest=1&discord_username=${encodeURIComponent(userData.username)}&discord_id=${userData.id}`,
      'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`,
      ...corsHeaders,
    },
  });
});

// ==================== SET INTENT ENDPOINTS ====================
router.get('/set-test-intent', async (request, env) => {
  const sessionId = crypto.randomUUID();
  await env.SESSIONS.put(`intent_${sessionId}`, 'test', { expirationTtl: 300 });
  
  return json({ 
    success: true, 
    message: 'Test intent set',
    sessionId,
  }, 200, {
    'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=300`,
  });
});

router.get('/set-admin-intent', async (request, env) => {
  const sessionId = crypto.randomUUID();
  await env.SESSIONS.put(`intent_${sessionId}`, 'admin', { expirationTtl: 300 });
  
  return json({ 
    success: true, 
    message: 'Admin intent set',
    sessionId,
  }, 200, {
    'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=300`,
  });
});

// ==================== SUBMISSION ENDPOINT ====================
router.post('/submit-test-results', async (request, env) => {
  try {
    const data = await request.json();
    
    // Save to Supabase
    const supabaseRes = await fetch(`${env.SUPABASE_URL}/rest/v1/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        discord_id: data.discordId,
        discord_username: data.discordUsername,
        answers: data.answers || data.conversationLog,
        conversation_log: data.conversationLog,
        questions_with_answers: data.questionsWithAnswers,
        score: data.score || '0/8',
        total_questions: data.totalQuestions || 8,
        correct_answers: data.correctAnswers || 0,
        wrong_answers: (data.totalQuestions || 8) - (data.correctAnswers || 0),
        status: 'pending',
        created_at: new Date().toISOString(),
      }),
    });
    
    // Send to Discord webhook
    if (env.DISCORD_WEBHOOK_URL) {
      const embed = {
        title: '📝 New Mod Test Submission',
        description: `**${data.discordUsername}** completed the test`,
        color: data.correctAnswers >= 6 ? 0x10b981 : 0xed4245,
        fields: [
          { name: 'Score', value: data.score || '0/8', inline: true },
          { name: 'User ID', value: `\`${data.discordId}\``, inline: true },
        ],
        timestamp: new Date().toISOString(),
      };
      
      // Don't await - fire and forget
      fetch(env.DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      }).catch(() => {});
    }
    
    return json({ success: true, message: 'Test submitted successfully' });
    
  } catch (error) {
    return json({ success: true, message: 'Test received' }, 200); // Always return success to user
  }
});

// ==================== HEALTH CHECK ====================
router.get('/health', () => {
  return json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    platform: 'Cloudflare Workers',
  });
});

// ==================== DISCORD BOT (WebSocket) ====================
// For Discord bot, we need a separate worker with WebSocket support
// Create a separate file: discord-bot-worker.js

// ==================== MAIN HANDLER ====================
export default {
  async fetch(request, env, ctx) {
    // Handle OPTIONS requests (CORS preflight)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders,
      });
    }
    
    try {
      return await router.handle(request, env, ctx);
    } catch (error) {
      return json({ error: error.message }, 500);
    }
  },
};
