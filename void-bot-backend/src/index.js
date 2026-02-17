export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ✅ CORS (VERY IMPORTANT)
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // 🔹 START TEST ROUTE
    if (url.pathname === "/start-test" && request.method === "POST") {
      try {
        const body = await request.json();
        const { userId, testId } = body;

        if (!userId || !testId) {
          return new Response(
            JSON.stringify({ error: "Missing data" }),
            { status: 400, headers: cors() }
          );
        }

        // TODO: move your DB logic here
        return new Response(
          JSON.stringify({ success: true }),
          { headers: cors() }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ error: err.message }),
          { status: 500, headers: cors() }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  }
};

function cors() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };
}
