import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { corsair } from "@/server/corsair";

/** The tenant-scoped Corsair client: `t.gmail.api.*`, `t.gmail.db.*`, etc. */
export type TenantClient = ReturnType<typeof corsair.withTenant>;

export class UnauthorizedError extends Error {
  constructor(message = "Not authenticated") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class NotConnectedError extends Error {
  constructor(public readonly plugin: string) {
    super(`No ${plugin} account connected for this user`);
    this.name = "NotConnectedError";
  }
}

/**
 * The single place a Corsair tenant is derived, and the reason one user cannot
 * reach another's mailbox: the tenant id comes from the signed session cookie
 * and never from anything the caller can set.
 *
 * Nothing else in the app should call `corsair.withTenant` directly.
 */
export async function requireTenant(): Promise<{
  userId: string;
  email: string;
  t: TenantClient;
}> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new UnauthorizedError();

  return {
    userId: session.user.id,
    email: session.user.email,
    t: corsair.withTenant(session.user.id),
  };
}

/** Server-side use only (webhooks, cron), where there is no session to read. */
export function tenantFor(tenantId: string): TenantClient {
  return corsair.withTenant(tenantId);
}

/** Maps thrown auth/connection errors onto sensible HTTP responses. */
export function errorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof NotConnectedError) {
    return Response.json(
      { error: error.message, plugin: error.plugin, code: "not_connected" },
      { status: 409 },
    );
  }

  const message = error instanceof Error ? error.message : String(error);

  // Corsair's own "you never connected this account" signal, which surfaces as
  // a plain Error rather than a typed one.
  if (/Account not found for tenant/i.test(message)) {
    return Response.json(
      { error: "Account not connected", code: "not_connected" },
      { status: 409 },
    );
  }
  if (/\[auth-missing:/i.test(message)) {
    return Response.json(
      { error: "Account authorization expired", code: "reauth_required" },
      { status: 409 },
    );
  }

  console.error("[api] unhandled error:", error);
  return Response.json({ error: message }, { status: 500 });
}
