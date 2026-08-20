import { extractMailBody, headerValue, type MimePart } from "@/lib/mail-body";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One message, with its body.
 *
 * Search deliberately fetches `format: "metadata"` — it needs headers for 25
 * results at a time and bodies would be enormous. So nothing in the app could
 * show an email's contents until this route. It is the only place that pays for
 * `format: "full"`, and only for the single message being opened.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { t } = await requireTenant();
    const { id } = await params;

    const message = await t.gmail.api.messages.get({ id, format: "full" });
    const payload = message.payload as MimePart | undefined;
    const { body, attachments } = extractMailBody(payload);

    return Response.json({
      messageId: message.id,
      threadId: message.threadId ?? null,
      subject: headerValue(payload, "Subject"),
      from: headerValue(payload, "From"),
      to: headerValue(payload, "To"),
      cc: headerValue(payload, "Cc"),
      sentAt: message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : null,
      labelIds: message.labelIds ?? [],
      snippet: message.snippet ?? null,
      body,
      attachments,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
