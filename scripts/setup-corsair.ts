import "dotenv/config";
import { setupCorsair } from "corsair/setup";
import { corsair } from "@/server/corsair";
import { pool } from "@/lib/db";

/**
 * One-time (idempotent) provisioning: creates the corsair_integrations rows and
 * stores the integration-level Google credentials.
 *
 * This must run before anything else touches Corsair. Without the integration
 * row every call fails with `Integration "gmail" not found`, and without the
 * client id/secret the OAuth connect flow has nothing to exchange a code with.
 *
 * Per-user corsair_accounts rows are NOT created here — those are created by
 * processOAuthCallback when a user connects, keyed by their better-auth user id.
 *
 *   pnpm corsair:setup
 */
async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set before running setup",
    );
  }

  console.log("→ Creating Corsair integration rows...");
  const summary = await setupCorsair(corsair, { caller: "script" });
  console.log(summary);

  console.log("→ Storing integration credentials...");
  for (const plugin of ["gmail", "googlecalendar"] as const) {
    const keys = corsair.keys[plugin];
    await keys.set_client_id(clientId);
    await keys.set_client_secret(clientSecret);
    console.log(`   ${plugin}: client_id + client_secret stored`);
  }

  // Gmail push delivery is a Pub/Sub topic the mailbox publishes to; the plugin
  // reads it back from integration-level storage at watch time.
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (topic) {
    await corsair.keys.gmail.set_topic_id(topic);
    console.log(`   gmail: topic_id = ${topic}`);
  } else {
    console.warn(
      "   gmail: GMAIL_PUBSUB_TOPIC unset — Gmail realtime will be disabled",
    );
  }

  console.log("\n✓ Setup complete. Users can now connect at /api/corsair/connect/gmail");
}

main()
  .catch((error) => {
    console.error("\n✗ Setup failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
