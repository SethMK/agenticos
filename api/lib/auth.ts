export const AUTH_HEADER = "cf-access-authenticated-user-email";
export const WHITELIST = ["kokott.marcin@gmail.com"];

export function requireAuth(req: Request): Response | null {
  const email = req.headers.get(AUTH_HEADER);
  if (!email || !WHITELIST.includes(email)) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
