import { convert } from "html-to-text";

/** Store readable text only. Never load tracking pixels, run HTML, or fetch attachments. */
export function receivedEmailText(
  email: {
    text?: string | null;
    html?: string | null;
    attachments?: unknown[];
  },
  max = 16000,
) {
  const text =
    email.text?.trim() ||
    convert((email.html || "").slice(0, 250000), {
      wordwrap: false,
      limits: { maxInputLength: 250000, maxDepth: 50, maxChildNodes: 5000 },
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
      ],
    }).trim() ||
    "This reply contains no readable message text. Open the original email in Resend to view it.";
  const attachmentNote = email.attachments?.length
    ? `\n\n[${email.attachments.length} attachment(s) received. Open the original email in Resend to view attachments.]`
    : "";
  const clipped = text.length + attachmentNote.length > max;
  const suffix = `${clipped ? "\n\n[Long message shortened. Open the original email in Resend for the full message.]" : ""}${attachmentNote}`;
  return text.slice(0, max - suffix.length) + suffix;
}
