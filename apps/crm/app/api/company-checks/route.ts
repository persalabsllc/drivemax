import { db, session } from "../../../lib/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canPrintCompanyChecks, checkCommandSchema, checkErrors, formatCheckNumber, isBlankCheckStock, type CheckAccount, type CompanyCheck } from "../../../lib/company-checks";
import { buildCompanyCheckPdf, sampleCheck } from "../../../lib/company-check-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const checkLogo = () => readFile(join(process.cwd(), "public/print-materials/drive-max-logo.png"));
const pdfResponse = (bytes: Uint8Array, number: number, extra: Record<string, string> = {}) => new Response(new Uint8Array(bytes), { headers: {
  "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="Drive-Max-Check-${formatCheckNumber(number)}.pdf"`,
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", ...extra,
} });

export async function GET(request: Request) {
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again to access company checks." }, 401);
    if (!canPrintCompanyChecks(s.role)) return json({ error: checkErrors.check_owner_required }, 403);
    const params = new URL(request.url).searchParams;
    const page = Number(params.get("page") || 0), q = (params.get("q") || "").trim().slice(0, 100), status = params.get("status");
    if (!Number.isInteger(page) || page < 0 || page > 100000 || (status && !["prepared", "printed", "voided"].includes(status))) return json({ error: "Invalid register filter." }, 400);
    let query = db().from("dmcrm_checks").select("*", { count: "exact" }).eq("org_id", s.org_id);
    if (status) query = query.eq("status", status);
    if (/^\d{1,9}$/.test(q)) query = query.eq("check_number", Number(q));
    else if (q) query = query.ilike("payee", "%" + q.replace(/[\\%_]/g, "\\$&") + "%");
    const [accounts, checks] = await Promise.all([
      db().from("dmcrm_check_accounts").select("id,name,last4,next_number,layout,revision").eq("org_id", s.org_id).order("created_at"),
      query.order("created_at", { ascending: false }).order("id").range(page * 25, page * 25 + 24),
    ]);
    if (accounts.error || checks.error) return json({ error: "The check register could not be loaded. Try refreshing." }, 503);
    return json({ accounts: accounts.data, checks: checks.data, total: checks.count ?? 0 });
  } catch {
    return json({ error: "Company checks are temporarily unavailable. Try again." }, 503);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid request origin." }, 403);
  if (Number(request.headers.get("content-length") || 0) > 12000) return json({ error: "Request too large." }, 413);
  try {
    const s = await session();
    if (!s) return json({ error: "Sign in again to access company checks." }, 401);
    if (!canPrintCompanyChecks(s.role)) return json({ error: checkErrors.check_owner_required }, 403);
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "Request too large." }, 413);
    const parsed = checkCommandSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message || "Review the check information." }, 400);
    const command = parsed.data;
    // Preview is read-only: it neither creates a ledger entry nor consumes a number.
    if (command.action === "preview") {
      const result = await db().from("dmcrm_check_accounts").select("*").eq("org_id", s.org_id).eq("id", command.account_id).maybeSingle();
      if (result.error) return json({ error: "Unable to load the check template." }, 503);
      const account = result.data as CheckAccount | null;
      if (!account) return json({ error: checkErrors.check_account_missing }, 404);
      try {
        const bytes = await buildCompanyCheckPdf({ ...command.details, check_number: account.next_number, account_name: account.name, account_last4: account.last4 }, account.layout, true, await checkLogo());
        return pdfResponse(bytes, account.next_number, { "X-Check-Preview": "true" });
      } catch (e) { return json({ error: e instanceof Error ? e.message : "Unable to preview this check." }, 400); }
    }
    let pdf: Uint8Array | undefined;
    // Validate the complete printable payload before reserving a number or logging a print.
    if (command.action === "save_account") {
      try { await buildCompanyCheckPdf(sampleCheck, command.layout, true, await checkLogo()); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Invalid check alignment." }, 400); }
    }
    if (command.action === "pdf" || command.action === "create") {
      let check: CompanyCheck | null = null;
      if (command.action === "pdf") {
        const result = await db().from("dmcrm_checks").select("*").eq("org_id", s.org_id).eq("id", command.id).maybeSingle();
        if (result.error) return json({ error: "Unable to load this check." }, 503);
        check = result.data;
        if (!check) return json({ error: checkErrors.check_missing }, 404);
        if (check.status === "voided") return json({ error: checkErrors.check_voided }, 409);
      }
      const accountResult = await db().from("dmcrm_check_accounts").select("*").eq("org_id", s.org_id).eq("id", check?.account_id ?? (command.action === "create" ? command.account_id : "")).maybeSingle();
      if (accountResult.error) return json({ error: "Unable to load check alignment." }, 503);
      const account = accountResult.data as CheckAccount | null;
      if (!account) return json({ error: checkErrors.check_account_missing }, 404);
      if (isBlankCheckStock(account.layout)) return json({ error: checkErrors.check_bank_details_pending }, 409);
      const printable = check ?? (command.action === "create" ? { ...command.details, check_number: command.check_number, account_name: account.name, account_last4: account.last4 } : null);
      if (!printable) return json({ error: checkErrors.check_missing }, 404);
      try { pdf = await buildCompanyCheckPdf(printable, account.layout); }
      catch (e) { return json({ error: e instanceof Error ? e.message : "Unable to prepare this check." }, 400); }
    }
    const { data, error } = await db().rpc("dmcrm_check_command", { p_org: s.org_id, p_actor: s.user_id, p_data: command });
    if (error) {
      const known = Object.keys(checkErrors).find((key) => error.message.includes(key));
      return json({ error: known ? checkErrors[known] : "The change could not be saved. Refresh before retrying." }, known ? 409 : 503);
    }
    if (command.action === "pdf" && pdf) return pdfResponse(pdf, data.check_number, {
      "X-Check-Revision": String(data.revision), "X-Check-Pdf-Count": String(data.pdf_count),
    });
    return json(data);
  } catch (e) {
    return json({ error: e instanceof SyntaxError ? "Invalid request." : "The check could not be saved. Refresh the register before retrying." }, e instanceof SyntaxError ? 400 : 503);
  }
}
