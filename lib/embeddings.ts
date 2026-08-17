import { env } from "@/lib/env";

/**
 * Pluggable text embedding.
 *
 * ⚠️ The vector column's dimension is fixed in DDL (`vector(384)`), so changing
 * provider is a schema change, not just a config change:
 *
 *     ALTER TABLE email_index ALTER COLUMN embedding TYPE vector(<new dim>);
 *     REINDEX INDEX email_index_embedding_hnsw;
 *     -- then re-run the backfill; old vectors are not convertible
 *
 * `assertDimensionMatchesSchema` fails loudly at startup rather than letting
 * mismatched vectors reach Postgres, where the error is far less obvious.
 */

export const SCHEMA_EMBEDDING_DIM = 384;

export type EmbeddingProvider = {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
};

// ---------------------------------------------------------------------------
// Local (default) — no API key, no network after the first model download
// ---------------------------------------------------------------------------

let localExtractor: Promise<unknown> | null = null;

const localProvider: EmbeddingProvider = {
  name: "local:Xenova/all-MiniLM-L6-v2",
  dim: 384,
  async embed(texts) {
    // Imported lazily: the ONNX runtime is heavy and most requests never
    // touch an embedding at all.
    const { pipeline } = await import("@huggingface/transformers");

    localExtractor ??= pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );

    const extractor = (await localExtractor) as (
      input: string[],
      options: { pooling: "mean"; normalize: boolean },
    ) => Promise<{ tolist(): number[][] }>;

    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  },
};

// ---------------------------------------------------------------------------
// Voyage
// ---------------------------------------------------------------------------

const voyageProvider: EmbeddingProvider = {
  name: "voyage-3.5-lite",
  dim: 1024,
  async embed(texts) {
    const apiKey = env.voyageApiKey;
    if (!apiKey) throw new Error("VOYAGE_API_KEY is not set");

    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3.5-lite",
        input: texts,
        input_type: "document",
      }),
    });

    if (!response.ok) {
      throw new Error(`Voyage embedding failed (${response.status}): ${await response.text()}`);
    }

    const json = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    // The API does not guarantee input order is preserved.
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  },
};

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

const openaiProvider: EmbeddingProvider = {
  name: "text-embedding-3-small",
  dim: 1536,
  async embed(texts) {
    const apiKey = env.openaiApiKey;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI embedding failed (${response.status}): ${await response.text()}`);
    }

    const json = (await response.json()) as {
      data: { index: number; embedding: number[] }[];
    };
    return json.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  },
};

const PROVIDERS: Record<string, EmbeddingProvider> = {
  local: localProvider,
  voyage: voyageProvider,
  openai: openaiProvider,
};

export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = PROVIDERS[env.embeddingProvider];
  if (!provider) {
    throw new Error(
      `Unknown EMBEDDING_PROVIDER "${env.embeddingProvider}". Expected one of: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }
  return provider;
}

export function assertDimensionMatchesSchema(provider = getEmbeddingProvider()) {
  if (provider.dim !== SCHEMA_EMBEDDING_DIM) {
    throw new Error(
      `Embedding provider "${provider.name}" produces ${provider.dim}-dimensional vectors, ` +
        `but email_index.embedding is vector(${SCHEMA_EMBEDDING_DIM}). ` +
        `Run: ALTER TABLE email_index ALTER COLUMN embedding TYPE vector(${provider.dim}); ` +
        `then REINDEX and re-run the backfill.`,
    );
  }
}

/** pgvector's text input format. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
