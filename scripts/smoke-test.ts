import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import { getEmbeddingProvider, SCHEMA_EMBEDDING_DIM } from "@/lib/embeddings";
import { buildGmailQuery, parseGmailQuery } from "@/lib/gmail-query";
import { indexEntity } from "@/lib/indexer";
import { buildMimeMessage, composeRawEmail } from "@/lib/mime";
import { searchSemantic } from "@/lib/search";

/**
 * Exercises the parts of the backend that don't need a live Google connection:
 * the query builder, the MIME encoder, and the full embed → index → hybrid
 * search path against real Postgres.
 *
 * Creates a throwaway tenant and deletes it again, so it is safe to re-run.
 *
 *   pnpm tsx scripts/smoke-test.ts
 */

const TENANT = `smoketest-${randomUUID().slice(0, 8)}`;
let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

async function testGmailQuery() {
  console.log("\n[gmail-query] build + parse round-trip");

  const filters = {
    from: ["jane@corsair.dev"],
    subject: ["quarterly report"],
    includes: ["budget"],
    excludes: ["draft"],
    isUnread: true,
    hasAttachment: true,
    newerThan: "7d",
  };

  const query = buildGmailQuery(filters);
  check("builds a query", query.length > 0, query);
  check("quotes multi-word values", query.includes('subject:"quarterly report"'));
  check("negates exclusions", query.includes("-draft"));

  const parsed = parseGmailQuery(query);
  check("round-trips from", parsed.from?.[0] === "jane@corsair.dev");
  check("round-trips subject", parsed.subject?.[0] === "quarterly report");
  check("round-trips excludes", parsed.excludes?.[0] === "draft");
  check("round-trips isUnread", parsed.isUnread === true);
  check("round-trips hasAttachment", parsed.hasAttachment === true);
  check("round-trips newer_than", parsed.newerThan === "7d");
  check("rebuild is stable", buildGmailQuery(parsed) === query, buildGmailQuery(parsed));

  const hand = parseGmailQuery('from:a@b.com "exact phrase" -spam is:starred');
  check("parses quoted phrase", hand.includes?.includes("exact phrase") === true);
  check("parses starred", hand.isStarred === true);
}

async function testMime() {
  console.log("\n[mime] RFC 2822 encoding");

  const mime = buildMimeMessage({
    to: ["friend@corsair.dev"],
    subject: "Café ☕ meeting",
    text: "I look forward to our meeting.",
    from: "me@example.com",
  });

  check("uses CRLF line endings", mime.includes("\r\n") && !/[^\r]\n/.test(mime));
  check("RFC 2047-encodes non-ASCII subject", /Subject: =\?UTF-8\?B\?/.test(mime));
  check("declares charset", mime.includes('charset="UTF-8"'));
  check("has header/body separator", mime.includes("\r\n\r\n"));

  const subjectLine = mime.split("\r\n").find((l) => l.startsWith("Subject:"))!;
  const encoded = /=\?UTF-8\?B\?(.+)\?=/.exec(subjectLine)![1];
  check(
    "subject decodes back",
    Buffer.from(encoded, "base64").toString("utf8") === "Café ☕ meeting",
  );

  const raw = composeRawEmail({
    to: ["a@b.com"],
    subject: "Plain",
    text: "hi",
    html: "<p>hi</p>",
  });
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  check("base64url is decodable", decoded.includes("To: a@b.com"));
  check("html builds multipart", decoded.includes("multipart/alternative"));
  check("multipart includes both parts", decoded.includes("text/plain") && decoded.includes("text/html"));
}

async function testEmbeddings() {
  console.log("\n[embeddings] provider");

  const provider = getEmbeddingProvider();
  console.log(`  provider: ${provider.name} (${provider.dim}d)`);

  const [a, b] = await provider.embed([
    "The quarterly budget review meeting is on Thursday",
    "Let us discuss the finances for Q3 next week",
  ]);
  const [c] = await provider.embed(["Pizza delivery order confirmation"]);

  check("dimension matches schema", provider.dim === SCHEMA_EMBEDDING_DIM);
  check("returns correct vector length", a.length === provider.dim);

  const cosine = (x: number[], y: number[]) =>
    x.reduce((sum, value, i) => sum + value * y[i], 0);

  const related = cosine(a, b);
  const unrelated = cosine(a, c);
  check(
    "related text scores higher than unrelated",
    related > unrelated,
    `related=${related.toFixed(3)} unrelated=${unrelated.toFixed(3)}`,
  );
}

async function seedEntities() {
  // Reuse the gmail integration row; create a throwaway account for our tenant.
  const { rows: integrations } = await pool.query<{ id: string }>(
    `SELECT id FROM corsair_integrations WHERE name = 'gmail' LIMIT 1`,
  );
  if (!integrations[0]) throw new Error("gmail integration row missing — run corsair:setup");

  const accountId = randomUUID();
  await pool.query(
    `INSERT INTO corsair_accounts (id, created_at, updated_at, tenant_id, integration_id, config)
     VALUES ($1, now(), now(), $2, $3, '{}'::jsonb)`,
    [accountId, TENANT, integrations[0].id],
  );

  const samples = [
    {
      subject: "Q3 budget review",
      from: "cfo@corsair.dev",
      body: "Attaching the quarterly financial statements ahead of Thursday's planning session. Revenue is up 12 percent.",
    },
    {
      subject: "Lunch tomorrow?",
      from: "friend@corsair.dev",
      body: "Fancy grabbing a sandwich around noon? There's a new deli near the office.",
    },
    {
      subject: "Invoice INV-4471 overdue",
      from: "billing@stripe.com",
      body: "Your payment of $240.00 for invoice INV-4471 is now 14 days past due. Please settle at your earliest convenience.",
    },
  ];

  const ids: string[] = [];
  for (const [index, sample] of samples.entries()) {
    const id = randomUUID();
    ids.push(id);
    await pool.query(
      `INSERT INTO corsair_entities
         (id, created_at, updated_at, account_id, entity_id, entity_type, version, data)
       VALUES ($1, now(), now(), $2, $3, 'messages', '1.0.0', $4::jsonb)`,
      [
        id,
        accountId,
        `msg-${index}`,
        JSON.stringify({
          id: `msg-${index}`,
          threadId: `thread-${index}`,
          subject: sample.subject,
          from: sample.from,
          to: "me@example.com",
          body: sample.body,
          snippet: sample.body.slice(0, 60),
          internalDate: String(Date.now() - index * 86_400_000),
          labelIds: ["INBOX"],
        }),
      ],
    );
  }

  return { accountId, ids };
}

async function testIndexAndSearch() {
  console.log("\n[vector] index + hybrid search against Postgres");

  const { ids } = await seedEntities();

  for (const id of ids) {
    const result = await indexEntity(id);
    if (result.status !== "indexed") {
      check(`indexed ${id.slice(0, 8)}`, false, result.reason);
    }
  }

  const { rows: counted } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM email_index WHERE tenant_id = $1 AND embedding IS NOT NULL`,
    [TENANT],
  );
  check("all rows indexed with vectors", counted[0].count === String(ids.length), `${counted[0].count}/${ids.length}`);

  // Re-indexing identical content must be a no-op, or every Corsair re-fetch
  // would pay for a fresh embedding.
  const repeat = await indexEntity(ids[0]);
  check("re-index skips unchanged content", repeat.status === "skipped" && repeat.reason === "unchanged");

  const { rows: fts } = await pool.query<{ has: boolean }>(
    `SELECT fts IS NOT NULL AS has FROM email_index WHERE tenant_id = $1 LIMIT 1`,
    [TENANT],
  );
  check("generated tsvector populated", fts[0]?.has === true);

  // Paraphrase: none of these words appear in the target email.
  const started = Date.now();
  const semantic = await searchSemantic(TENANT, "money we are owed that hasn't been paid", 3);
  const tookMs = Date.now() - started;

  check("semantic search returns hits", semantic.length > 0, `${semantic.length} hits in ${tookMs}ms`);
  check(
    "paraphrase finds the overdue invoice",
    semantic[0]?.subject === "Invoice INV-4471 overdue",
    `top hit: ${semantic[0]?.subject}`,
  );
  check("search is sub-second", tookMs < 1000, `${tookMs}ms`);

  const exact = await searchSemantic(TENANT, "INV-4471", 3);
  check(
    "exact token still matches (lexical side)",
    exact[0]?.subject === "Invoice INV-4471 overdue",
    `top hit: ${exact[0]?.subject}`,
  );

  const lunch = await searchSemantic(TENANT, "getting food with a friend", 3);
  check(
    "unrelated query ranks the right email first",
    lunch[0]?.subject === "Lunch tomorrow?",
    `top hit: ${lunch[0]?.subject}`,
  );
}

async function cleanup() {
  // corsair_entities cascades into email_index via the FK added in the migration.
  await pool.query(
    `DELETE FROM corsair_entities WHERE account_id IN
       (SELECT id FROM corsair_accounts WHERE tenant_id = $1)`,
    [TENANT],
  );
  await pool.query(`DELETE FROM corsair_accounts WHERE tenant_id = $1`, [TENANT]);

  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) FROM email_index WHERE tenant_id = $1`,
    [TENANT],
  );
  check("cascade removed index rows", rows[0].count === "0");
}

async function main() {
  console.log(`Smoke test — tenant ${TENANT}`);
  await testGmailQuery();
  await testMime();
  await testEmbeddings();
  try {
    await testIndexAndSearch();
  } finally {
    console.log("\n[cleanup]");
    await cleanup();
  }

  console.log(
    failures === 0 ? "\n✓ All checks passed" : `\n✗ ${failures} check(s) failed`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((error) => {
    console.error("\n✗ Smoke test crashed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
