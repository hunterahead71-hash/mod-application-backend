export default {
  async fetch(request, env) {
    return new Response(
      JSON.stringify({ status: "worker alive" }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
};
