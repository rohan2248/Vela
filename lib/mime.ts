import { randomBytes } from "node:crypto";

/**
 * Builds RFC 2822 messages for Gmail's `messages.send`.
 *
 * The plugin's send endpoint accepts exactly `{raw, userId?, threadId?}` — no
 * to/subject/body fields exist — so composing the wire format is unavoidable.
 *
 * Details that matter and are easy to get wrong:
 *   - headers and body are separated by CRLF CRLF, and every line break in a
 *     header must be CRLF; Gmail rejects bare LF
 *   - non-ASCII header values need RFC 2047 encoding, or subjects with accents
 *     or emoji arrive mangled
 *   - bodies are base64 with an explicit charset so UTF-8 survives
 */

export type EmailAddress = string;

export type ComposeOptions = {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject: string;
  /** Plain-text body. Always sent — HTML-only mail looks like spam. */
  text: string;
  /** Optional HTML alternative; triggers a multipart/alternative message. */
  html?: string;
  from?: EmailAddress;
  replyTo?: EmailAddress;
  /** Set both this and Corsair's `threadId` to reply within a thread. */
  inReplyTo?: string;
  references?: string[];
};

const CRLF = "\r\n";

const isAscii = (value: string) => /^[\x20-\x7E]*$/.test(value);

/**
 * RFC 2047 "encoded-word" form. Only applied when needed, since plain ASCII
 * headers are more readable in transit and in any debugging output.
 */
function encodeHeaderValue(value: string): string {
  if (isAscii(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Encodes the display-name portion of `Name <addr@host>` while leaving the
 * address itself alone — an encoded-word inside angle brackets is invalid.
 */
function encodeAddress(address: string): string {
  const match = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(address);
  if (!match) return address.trim();

  const [, name, addr] = match;
  if (!name) return `<${addr}>`;

  const quoted = isAscii(name) ? `"${name.replace(/"/g, '\\"')}"` : encodeHeaderValue(name);
  return `${quoted} <${addr}>`;
}

/** Folds long header lines per RFC 5322 without splitting an encoded word. */
function foldHeader(name: string, value: string): string {
  const line = `${name}: ${value}`;
  if (line.length <= 76) return line;

  const parts = value.split(", ");
  if (parts.length === 1) return line;

  return `${name}: ${parts.join(`,${CRLF} `)}`;
}

function base64Body(content: string): string {
  // 76-character lines, as required for base64 transfer encoding.
  return (
    Buffer.from(content, "utf8")
      .toString("base64")
      .match(/.{1,76}/g) ?? []
  ).join(CRLF);
}

export function buildMimeMessage(options: ComposeOptions): string {
  const headers: string[] = [];

  if (options.from) headers.push(foldHeader("From", encodeAddress(options.from)));
  headers.push(foldHeader("To", options.to.map(encodeAddress).join(", ")));
  if (options.cc?.length) {
    headers.push(foldHeader("Cc", options.cc.map(encodeAddress).join(", ")));
  }
  if (options.bcc?.length) {
    headers.push(foldHeader("Bcc", options.bcc.map(encodeAddress).join(", ")));
  }
  if (options.replyTo) {
    headers.push(foldHeader("Reply-To", encodeAddress(options.replyTo)));
  }

  headers.push(foldHeader("Subject", encodeHeaderValue(options.subject)));

  if (options.inReplyTo) {
    headers.push(`In-Reply-To: ${options.inReplyTo}`);
    // Threading clients follow References; include the parent at minimum.
    const references = options.references?.length
      ? options.references
      : [options.inReplyTo];
    headers.push(foldHeader("References", references.join(" ")));
  }

  headers.push("MIME-Version: 1.0");

  if (!options.html) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push("Content-Transfer-Encoding: base64");
    return headers.join(CRLF) + CRLF + CRLF + base64Body(options.text);
  }

  const boundary = `----=_Part_${randomBytes(12).toString("hex")}`;
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);

  const body = [
    "",
    // Plain part first: clients pick the last part they can render, so this
    // ordering is what makes HTML win where supported and text work elsewhere.
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(options.text),
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(options.html),
    "",
    `--${boundary}--`,
  ].join(CRLF);

  return headers.join(CRLF) + CRLF + body;
}

/** Gmail wants base64url: `+`→`-`, `/`→`_`, no padding. */
export function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function composeRawEmail(options: ComposeOptions): string {
  return toBase64Url(buildMimeMessage(options));
}
