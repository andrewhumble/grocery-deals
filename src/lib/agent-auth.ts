import "server-only";

export function agentRequestAuthorized(request: Request): boolean {
  const secret = process.env.HERMES_SHARED_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}
