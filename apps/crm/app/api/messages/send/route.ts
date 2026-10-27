import { NextRequest, NextResponse, after } from "next/server";
import { session, db } from "../../../../lib/server";
import { emailConnection, dispatchEmail } from "../../../../lib/messaging";
import { buildCustomerQuotePdf } from "../../../../lib/quote-export";
import { canManage } from "../../../../lib/model";
import { z } from "zod";
export const maxDuration = 60;
const schema = z.object({ id: z.uuid(), revision: z.number().int().min(0) });
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(req: NextRequest) {
  if (req.headers.get("origin") !== new URL(req.url).origin)
    return json({ error: "Invalid request origin." }, 403);
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again." }, 401);
    const raw = await req.text();
    if (raw.length > 500) return json({ error: "Request too large." }, 413);
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success)
      return json({ error: "Choose a saved email draft." }, 400);
    const { id, revision } = parsed.data;
    const { data: m, error } = await db()
      .from("dmcrm_messages")
      .select("*")
      .eq("org_id", s.org_id)
      .eq("id", id)
      .maybeSingle();
    if (
      error ||
      !m ||
      m.channel !== "email" ||
      m.direction !== "outbound" ||
      (!canManage(s.role) && m.created_by !== s.user_id)
    )
      return json({ error: "Email draft unavailable." }, 403);
    if (["queued", "sent", "delivered"].includes(m.status))
      return json({ ok: true, id, status: m.status });
    if (m.status !== "draft" || m.revision !== revision)
      return json(
        { error: "Draft changed in another session. Reload before sending." },
        409,
      );
    if (!(await emailConnection(s.org_id)).connected)
      return json(
        {
          error:
            "Email is temporarily unavailable. Your draft has been saved; nothing was sent.",
        },
        503,
      );
    const attachments = [];
    if (m.quote_id) {
      const [quote, customer] = await Promise.all([
        db()
          .from("dmcrm_quotes")
          .select("*")
          .eq("org_id", s.org_id)
          .eq("id", m.quote_id)
          .eq("customer_id", m.customer_id)
          .maybeSingle(),
        db()
          .from("dmcrm_customers")
          .select("*")
          .eq("org_id", s.org_id)
          .eq("id", m.customer_id)
          .maybeSingle(),
      ]);
      if (
        quote.error ||
        customer.error ||
        !quote.data ||
        !customer.data ||
        quote.data.opportunity_id !== m.opportunity_id
      )
        return json(
          {
            error: "The saved customer quote is unavailable. Nothing was sent.",
          },
          409,
        );
      const pdf = await buildCustomerQuotePdf(quote.data, customer.data);
      attachments.push({
        filename: `drive-max-quote-${m.quote_id.slice(0, 8)}.pdf`,
        content_type: "application/pdf",
        content: Buffer.from(pdf).toString("base64"),
      });
    }
    const queued = await db().rpc("dmcrm_queue_email", {
      p_org: s.org_id,
      p_actor: s.user_id,
      p_id: id,
      p_revision: revision,
      p_attachments: attachments,
    });
    if (queued.error) {
      const safe = [
        "Draft changed in another session. Reload before sending.",
        "Only an unsent draft can be sent",
        "Email is stopped for this recipient. Review the customer email preference or delivery failure.",
        "Replace all personalization fields before sending.",
        "Enter a valid email recipient and subject.",
        "The customer quote attachment could not be prepared.",
      ];
      return json(
        {
          error: safe.includes(queued.error.message)
            ? queued.error.message
            : "This email could not be queued. Your draft is saved.",
        },
        409,
      );
    }
    after(async () => {
      await dispatchEmail(s.org_id, id);
    });
    return json({ ok: true, id, status: "queued" }, 202);
  } catch {
    return json(
      {
        error:
          "Could not prepare this email. Refresh its status before trying again.",
      },
      503,
    );
  }
}
