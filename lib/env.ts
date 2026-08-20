/**
 * Centralised environment access.
 *
 * Everything is read lazily through a getter rather than at module load, so an
 * unrelated route doesn't crash the whole app because an optional integration
 * isn't configured yet.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },

  /**
   * Neon serves DATABASE_URL through a `-pooler` (PgBouncer, transaction mode)
   * endpoint, which silently does not support LISTEN/NOTIFY. Set this to the
   * direct endpoint — the same host with `-pooler` removed — to enable
   * cross-process realtime fan-out. Optional: without it we fall back to an
   * in-process emitter plus a database tail query.
   */
  get databaseDirectUrl() {
    return optional("DATABASE_DIRECT_URL");
  },

  get corsairKek() {
    return required("CORSAIR_KEK");
  },

  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY");
  },

  get appUrl() {
    return (
      optional("BETTER_AUTH_URL") ??
      optional("NEXT_PUBLIC_APP_URL") ??
      "http://localhost:3000"
    );
  },

  /**
   * Where Google delivers webhooks. In development this is an ngrok tunnel;
   * it must be publicly reachable over HTTPS or Google refuses to register the
   * watch channel at all.
   */
  get webhookUrl() {
    const base = optional("WEBHOOK_PUBLIC_URL") ?? this.appUrl;
    return `${base.replace(/\/$/, "")}/api/webhooks`;
  },

  /**
   * Must be byte-identical between generateOAuthUrl and processOAuthCallback,
   * and registered verbatim in the Google Cloud console.
   */
  get corsairRedirectUri() {
    return (
      optional("CORSAIR_REDIRECT_URI") ??
      `${this.appUrl.replace(/\/$/, "")}/api/corsair/callback`
    );
  },

  /** projects/<project>/topics/<topic> that Gmail publishes change events to. */
  get gmailPubsubTopic() {
    return optional("GMAIL_PUBSUB_TOPIC");
  },

  /** Guards the watch-renewal endpoint so it isn't publicly triggerable. */
  get cronSecret() {
    return optional("CRON_SECRET");
  },

  /** Signs the X-Goog-Channel-Token we hand Google when opening a watch. */
  get webhookTenantSecret() {
    return optional("WEBHOOK_TENANT_SECRET") ?? this.corsairKek;
  },

  /**
   * HMAC key binding a tool-approval response to the tool call it approves.
   * Without it the browser could POST an approval for a `send_email` or
   * `run_script` call the model never made, and we would execute it.
   */
  get toolApprovalSecret() {
    return optional("TOOL_APPROVAL_SECRET") ?? this.corsairKek;
  },

  get embeddingProvider() {
    return (optional("EMBEDDING_PROVIDER") ?? "local").toLowerCase();
  },
  get voyageApiKey() {
    return optional("VOYAGE_API_KEY");
  },
  get openaiApiKey() {
    return optional("OPENAI_API_KEY");
  },
} as const;

export const CHAT_MODEL = "claude-opus-5";
