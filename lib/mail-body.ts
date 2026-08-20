import { htmlToText } from "@/lib/indexer";

/**
 * Body extraction from a Gmail `format: "full"` payload.
 *
 * Gmail nests content arbitrarily deep under multipart/alternative and
 * multipart/related, so `payload.body` is empty for anything but the simplest
 * message — the tree has to be walked.
 */

export type MimePart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: MimePart[];
  headers?: { name?: string; value?: string }[];
};

export type Attachment = {
  filename: string;
  mimeType: string;
  size: number;
};

export function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

export function headerValue(
  part: MimePart | undefined,
  name: string,
): string | null {
  const found = part?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

type Collected = {
  text: string[];
  html: string[];
  attachments: Attachment[];
};

function walk(part: MimePart | undefined, out: Collected): void {
  if (!part) return;

  // A part with a filename is an attachment, never body content.
  if (part.filename) {
    out.attachments.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body?.size ?? 0,
    });
    return;
  }

  if (part.parts?.length) {
    for (const child of part.parts) walk(child, out);
    return;
  }

  if (part.mimeType === "text/plain") {
    out.text.push(decodeBase64Url(part.body?.data));
  } else if (part.mimeType === "text/html") {
    out.html.push(decodeBase64Url(part.body?.data));
  }
}

/**
 * Readable text plus the attachment manifest.
 *
 * Plain text wins when both alternatives exist — it is what the sender meant to
 * be read as prose. HTML is stripped rather than returned: this is somebody
 * else's markup and it is never going into the DOM.
 */
export function extractMailBody(payload: MimePart | undefined): {
  body: string;
  attachments: Attachment[];
} {
  const collected: Collected = { text: [], html: [], attachments: [] };
  walk(payload, collected);

  const body =
    collected.text.join("\n").trim() ||
    htmlToText(collected.html.join("\n")).trim();

  return { body, attachments: collected.attachments };
}
