"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Plus, Printer, RefreshCw, Settings2 } from "lucide-react";
import { dayKey } from "../lib/model";
import { canPrintCompanyChecks, checkAmountWords, checkCommandSchema, checkFields, checkMoney, defaultCheckLayout, parseCheckAmount, type CheckAccount, type CheckCommand, type CheckLayout, type CheckRegister, type CompanyCheck } from "../lib/company-checks";
import { buildCompanyCheckPdf, sampleCheck } from "../lib/company-check-pdf";
import { Modal } from "./ui";

const accountLabel = (a: CheckAccount) => a.name + (a.last4 ? ` · ending ${a.last4}` : "");
type Preview = { url: string; title: string; sample: boolean; check?: CompanyCheck };

export function CompanyChecks({ role, demo }: { role: string; demo: boolean }) {
  const [data, setData] = useState<CheckRegister>(() => ({ accounts: [], checks: [], total: 0 }));
  const [loading, setLoading] = useState(!demo), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [settings, setSettings] = useState<CheckAccount | "new" | null>(null), [writing, setWriting] = useState(false);
  const [selected, setSelected] = useState<CompanyCheck | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState(0), [search, setSearch] = useState(""), [query, setQuery] = useState(""), [status, setStatus] = useState("");
  const demoData = useRef<CheckRegister>({ accounts: [], checks: [], total: 0 }), lock = useRef(false);
  const load = useCallback(async () => {
    if (demo) { setData({ ...demoData.current, total: demoData.current.checks.length }); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/company-checks?${new URLSearchParams({ page: String(page), q: query, status })}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Could not load company checks.");
      setData(result);
    } finally { setLoading(false); }
  }, [demo, page, query, status]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const run = async (command: CheckCommand): Promise<CheckAccount | CompanyCheck> => {
    const parsed = checkCommandSchema.safeParse(command);
    if (!parsed.success) throw Error(parsed.error.issues[0]?.message || "Review the check information.");
    command = parsed.data;
    if (!demo) {
      const response = await fetch("/api/company-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "The check could not be saved.");
      return result;
    }
    // Demo is entirely in memory and its PDFs are always visibly VOID.
    const d = demoData.current;
    if (command.action === "save_account") {
      await buildCompanyCheckPdf(sampleCheck, command.layout, true);
      const a: CheckAccount = { ...command, revision: command.revision + 1 };
      d.accounts = [...d.accounts.filter((x) => x.id !== a.id), a];
      return a;
    }
    if (command.action === "create") {
      const existing = d.checks.find((x) => x.id === command.id);
      if (existing) return existing;
      const a = d.accounts.find((x) => x.id === command.account_id)!;
      if (a.next_number !== command.check_number) throw Error("Refresh the next check number.");
      await buildCompanyCheckPdf({ ...command.details, check_number: command.check_number, account_name: a.name, account_last4: a.last4 }, a.layout, true);
      const check: CompanyCheck = { ...command.details, id: command.id, account_id: a.id, account_name: a.name, account_last4: a.last4, check_number: a.next_number, status: "prepared", revision: 1, pdf_count: 0, created_at: new Date().toISOString(), printed_at: null, voided_at: null, void_reason: "" };
      d.checks = [check, ...d.checks];
      d.accounts = d.accounts.map((x) => x.id === a.id ? { ...a, next_number: a.next_number + 1, revision: a.revision + 1 } : x);
      return check;
    }
    const c = d.checks.find((x) => x.id === command.id)!;
    if (!c || c.status === "voided" || c.revision !== command.revision) throw Error("Refresh this check before continuing.");
    const updated: CompanyCheck = { ...c, revision: c.revision + 1,
      ...(command.action === "void" ? { status: "voided" as const, voided_at: new Date().toISOString(), void_reason: command.reason } : command.action === "mark_printed" ? { status: "printed" as const, printed_at: new Date().toISOString() } : { pdf_count: c.pdf_count + 1 }) };
    d.checks = d.checks.map((x) => x.id === c.id ? updated : x);
    return updated;
  };
  const action = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); lock.current = false; }
  };
  const refresh = async () => { try { await load(); } catch { setError("Saved, but the register could not refresh. Refresh before making another change."); } };
  const showSample = async (layout: CheckLayout) => {
    const bytes = await buildCompanyCheckPdf(sampleCheck, layout, true);
    setPreview({ url: URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/pdf" })), title: "Alignment sample", sample: true });
  };
  const print = async (c: CompanyCheck, reason: string) => {
    const command = { action: "pdf" as const, id: c.id, revision: c.revision, stock_confirmed: true as const, reason };
    let blob: Blob, updated: CompanyCheck;
    if (demo) {
      const a = data.accounts.find((a) => a.id === c.account_id)!;
      blob = new Blob([new Uint8Array(await buildCompanyCheckPdf(c, a.layout, true))], { type: "application/pdf" });
      updated = await run(command) as CompanyCheck;
    } else {
      const response = await fetch("/api/company-checks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      if (!response.ok) throw Error((await response.json()).error || "Could not prepare the print PDF.");
      blob = await response.blob();
      updated = { ...c, revision: Number(response.headers.get("X-Check-Revision")), pdf_count: Number(response.headers.get("X-Check-Pdf-Count")) };
    }
    setSelected(null);
    setPreview({ url: URL.createObjectURL(blob), title: `Check #${c.check_number}`, sample: demo, check: updated });
    await refresh();
  };
  if (!canPrintCompanyChecks(role)) return null;
  const checks = demo ? data.checks.filter((c) => (!status || c.status === status) && (!query || c.payee.toLowerCase().includes(query.toLowerCase()) || String(c.check_number) === query)) : data.checks;
  return <section className="panel company-checks">
    <div className="section-heading"><div><h2><Printer size={18} /> Company checks</h2><p>Write, print and track checks from your company checking accounts.</p></div>
      <div className="ops-actions"><button className="btn small" disabled={busy || loading} onClick={() => action(load)}><RefreshCw size={15} /> Refresh</button><button className="btn primary" disabled={busy || loading || !data.accounts.length} onClick={() => { setError(""); setWriting(true); }}><Plus size={16} /> Write check</button></div></div>
    <div className="checks-stock-note"><strong>Use preprinted, check-on-top voucher checks.</strong><p>US Letter (8½ × 11 inches), one 3½-inch check at the top and two stubs below. Order with Drive Max’s company name, banking details and check numbers already printed. Print single-sided at 100% / Actual size. Sign the paper check after printing.</p><p>Start with an alignment sample on plain paper. Hold it behind your check stock and adjust any fields that do not line up.</p></div>
    <div className="checks-accounts">{data.accounts.map((a) => <button className="checks-account" key={a.id} onClick={() => { setError(""); setSettings(a); }} disabled={busy}><span><strong>{accountLabel(a)}</strong><small>Next check #{a.next_number}</small></span><Settings2 size={17} /></button>)}<button className="btn" disabled={busy || loading} onClick={() => { setError(""); setSettings("new"); }}><Plus size={16} /> Add checking account</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}{notice && <p role="status" className="checks-notice">{notice}</p>}
    <div className="section-heading"><div><h3>Check register</h3><p>Saved checks reserve their number. Printed means you confirmed the paper printed; it does not mean cleared by the bank.</p></div></div>
    <form className="checks-filters" onSubmit={(e) => { e.preventDefault(); setPage(0); setQuery(search); }}><label>Payee or check number<input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} /></label><label>Status<select value={status} onChange={(e) => { setPage(0); setStatus(e.target.value); }}><option value="">All statuses</option><option value="prepared">Prepared</option><option value="printed">Printed</option><option value="voided">Voided</option></select></label><button className="btn" type="submit">Search</button></form>
    <div className="table-scroll"><table><thead><tr><th>Check</th><th>Date</th><th>Payee / memo</th><th>Account</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>{checks.map((c) => <tr key={c.id}><td>#{c.check_number}</td><td>{c.check_date}</td><td><strong>{c.payee}</strong><small className="checks-block">{c.memo}</small></td><td>{c.account_name}{c.account_last4 && <small className="checks-block">Ending {c.account_last4}</small>}</td><td>{checkMoney(c.amount_cents)}</td><td><span className={`checks-status ${c.status}`}>{c.status}</span></td><td><button className="text-btn" disabled={busy} onClick={() => { setError(""); setSelected(c); }}>Review</button></td></tr>)}{!checks.length && <tr><td colSpan={7}>{loading ? "Loading check register…" : data.accounts.length ? "No checks match. Choose Write check to prepare your first payment." : "Add your checking account label and the first number on your check stock to get started."}</td></tr>}</tbody></table></div>
    {!demo && <div className="checks-pagination"><span>{data.total} check{data.total === 1 ? "" : "s"} · Page {page + 1}</span><button className="btn small" disabled={busy || loading || page === 0} onClick={() => setPage(page - 1)}>Previous</button><button className="btn small" disabled={busy || loading || (page + 1) * 25 >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
    <p className="ops-help">Owner access only. This register does not send payments, connect to your bank, update expense reports or mark commissions paid.</p>
    {settings && <AccountSettings account={settings === "new" ? undefined : settings} busy={busy} error={error} onClose={() => { if (!busy) { setSettings(null); setError(""); } }} onSample={(layout) => action(() => showSample(layout))} onSave={(command) => action(async () => { await run(command); setSettings(null); setNotice("Checking account and print alignment saved."); await refresh(); })} />}
    {writing && <WriteCheck accounts={data.accounts} busy={busy} error={error} onClose={() => { if (!busy) { setWriting(false); setError(""); } }} onSave={(command) => action(async () => { const saved = await run(command) as CompanyCheck; setWriting(false); setSelected(saved); await refresh(); })} />}
    {selected && <ReviewCheck check={selected} busy={busy} error={error} onClose={() => { if (!busy) { setSelected(null); setError(""); } }} onPrint={(reason) => action(() => print(selected, reason))} onPrinted={() => action(async () => { const c = await run({ action: "mark_printed", id: selected.id, revision: selected.revision }) as CompanyCheck; setSelected(c); setNotice(`Check #${c.check_number} marked printed.`); await refresh(); })} onVoid={(reason) => action(async () => { const c = await run({ action: "void", id: selected.id, revision: selected.revision, reason }) as CompanyCheck; setSelected(c); setNotice(`Check #${c.check_number} voided in the register.`); await refresh(); })} />}
    {preview && <Modal wide title={preview.title} subtitle="Letter · single-sided · 100% / Actual size · turn off Fit to page" onClose={() => { if (!busy) setPreview(null); }}>
      <div className="checks-dialog protection-pdf"><p>{preview.sample ? "VOID sample: print on plain paper only. No live check is issued." : "Open the PDF and use its Print button. Confirm that the number on your loaded check matches this record. Sign the paper after it prints."}</p>
      <div className="ops-actions"><a className="btn primary" href={preview.url} target="_blank" rel="noreferrer">Open / print PDF</a><a className="btn" href={preview.url} download={preview.sample ? "Drive-Max-Check-Alignment.pdf" : `Drive-Max-Check-${preview.check?.check_number}.pdf`}>Download PDF</a></div>
      <iframe title={preview.title} src={preview.url} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {preview.check && preview.check.status === "prepared" && <div className="checks-confirm"><p>After the paper prints correctly, confirm below. If you canceled printing, close this window and the check stays Prepared.</p><button className="btn primary" disabled={busy} onClick={() => action(async () => { const c = await run({ action: "mark_printed", id: preview.check!.id, revision: preview.check!.revision }) as CompanyCheck; setPreview(null); setNotice(`Check #${c.check_number} marked printed.`); await refresh(); })}><Check size={16} /> It printed correctly</button></div>}</div>
    </Modal>}
  </section>;
}

function AccountSettings({ account, busy, error, onClose, onSave, onSample }: { account?: CheckAccount; busy: boolean; error: string; onClose: () => void; onSave: (c: CheckCommand) => void; onSample: (l: CheckLayout) => void }) {
  const [id] = useState(() => account?.id ?? crypto.randomUUID());
  const [name, setName] = useState(account?.name ?? "Company checking"), [last4, setLast4] = useState(account?.last4 ?? "");
  const [next, setNext] = useState(account ? String(account.next_number) : ""), [layout, setLayout] = useState<CheckLayout>(account?.layout ?? defaultCheckLayout);
  const submit = (e: FormEvent) => { e.preventDefault(); onSave({ action: "save_account", id, revision: account?.revision ?? 0, name, last4, next_number: Number(next), layout }); };
  return <Modal wide title={account ? "Check account & alignment" : "Add checking account"} subtitle="Use the account label and first check number from your preprinted stock." onClose={onClose}><form className="checks-dialog" onSubmit={submit}><fieldset disabled={busy}>
    <div className="checks-form-grid"><label>Account label<input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label><label>Last four account digits (optional)<input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value)} /></label><label>Next check number<input required type="number" min={account?.next_number ?? 1} max={999999998} step={1} placeholder="Number on your first check" value={next} onChange={(e) => setNext(e.target.value)} /></label></div>
    <p className="ops-help">Use a separate account entry for each bank account. The full account number, routing number and signature stay on your paper checks. Numbers already used or voided cannot be reused.</p>
    <h3>Printer alignment</h3><p>Adjustments are in points: 72 points = 1 inch. Positive values move right or down; negative values move left or up. These settings are shared for this account.</p>
    <div className="checks-form-grid">{(["x", "y"] as const).map((axis) => <label key={axis}>{axis === "x" ? "Move all check text horizontally" : "Move all check text vertically"}<input type="number" min={-18} max={18} step={.5} value={layout[axis]} onChange={(e) => setLayout({ ...layout, [axis]: Number(e.target.value) })} /></label>)}</div>
    <details><summary>Adjust individual fields</summary><div className="checks-alignment"><strong>Field</strong><strong>Right / left</strong><strong>Down / up</strong>{checkFields.map((field) => <div className="checks-alignment-row" key={field}><span>{field === "words" ? "Written amount" : field}</span>{(["x", "y"] as const).map((axis) => <input aria-label={`${field} ${axis === "x" ? "horizontal" : "vertical"} adjustment`} key={axis} type="number" min={-18} max={18} step={.5} value={layout.fields[field][axis]} onChange={(e) => setLayout({ ...layout, fields: { ...layout.fields, [field]: { ...layout.fields[field], [axis]: Number(e.target.value) } } })} />)}</div>)}</div></details>
    <div className="ops-actions"><button className="btn" type="button" onClick={() => onSample(layout)}><Printer size={16} /> Print alignment sample</button><button className="text-btn" type="button" onClick={() => setLayout(defaultCheckLayout)}>Reset alignment</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="checks-footer"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Save account & alignment</button></div>
  </fieldset></form></Modal>;
}

function WriteCheck({ accounts, busy, error, onClose, onSave }: { accounts: CheckAccount[]; busy: boolean; error: string; onClose: () => void; onSave: (c: CheckCommand) => void }) {
  const [id] = useState(() => crypto.randomUUID());
  const [accountId, setAccountId] = useState(accounts[0].id), [payee, setPayee] = useState(""), [amount, setAmount] = useState(""), [date, setDate] = useState(dayKey()), [memo, setMemo] = useState(""), [address, setAddress] = useState(""), [confirmed, setConfirmed] = useState(false);
  const account = accounts.find((a) => a.id === accountId)!, cents = parseCheckAmount(amount);
  return <Modal wide title="Write company check" subtitle="Review the payee, amount and paper check number before reserving it." onClose={onClose}><form className="checks-dialog" onSubmit={(e) => { e.preventDefault(); if (cents && confirmed) onSave({ action: "create", id, account_id: accountId, check_number: account.next_number, details: { payee, amount_cents: cents, check_date: date, memo, address } }); }}><fieldset disabled={busy}>
    <div className="checks-form-grid"><label>Checking account<select value={accountId} onChange={(e) => { setAccountId(e.target.value); setConfirmed(false); }}>{accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select></label><label>Check number<input readOnly value={account.next_number} /></label><label>Check date<input required type="date" min="2000-01-01" max="2100-12-31" value={date} onChange={(e) => setDate(e.target.value)} /></label><label>Pay to the order of<input required autoFocus maxLength={100} value={payee} onChange={(e) => setPayee(e.target.value)} /></label><label>Amount ($)<input required inputMode="decimal" placeholder="0.00" pattern="[0-9]{1,6}(\.[0-9]{1,2})?" value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label>Memo (optional)<input maxLength={120} value={memo} onChange={(e) => setMemo(e.target.value)} /></label><label className="checks-wide">Payee mailing address (optional)<textarea rows={3} maxLength={240} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address&#10;City, state ZIP" /></label></div>
    <div className="checks-written"><small>Written amount</small><strong>{cents ? checkAmountWords(cents) + " Dollars" : "Enter an amount from $0.01 to $999,999.99."}</strong></div>
    <label className="checks-checkbox"><input required type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />The next unused sheet for {account.name} is check #{account.next_number}.</label>
    <p className="ops-help">Saving permanently reserves this number. To correct a saved payment, void it and create a new check with the next unused sheet.</p>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="checks-footer"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!cents || !confirmed} type="submit">Save & review check</button></div>
  </fieldset></form></Modal>;
}

function ReviewCheck({ check: c, busy, error, onClose, onPrint, onPrinted, onVoid }: { check: CompanyCheck; busy: boolean; error: string; onClose: () => void; onPrint: (reason: string) => void; onPrinted: () => void; onVoid: (reason: string) => void }) {
  const [confirmed, setConfirmed] = useState(false), [reason, setReason] = useState(""), [voidReason, setVoidReason] = useState(""), [voiding, setVoiding] = useState(false);
  return <Modal wide title={`Check #${c.check_number}`} subtitle={`${c.account_name}${c.account_last4 ? " · ending " + c.account_last4 : ""} · ${c.status}`} onClose={onClose}><div className="checks-dialog"><div className="checks-review"><span>{c.check_date}</span><h3>{c.payee}</h3><strong className="checks-amount">{checkMoney(c.amount_cents)}</strong><p>{checkAmountWords(c.amount_cents)} Dollars</p>{c.address && <p style={{ whiteSpace: "pre-line" }}>{c.address}</p>}<p>Memo: {c.memo || "—"}</p></div>
    {c.status === "voided" ? <p className="checks-voided">Voided: {c.void_reason}. This number remains reserved and cannot be printed.</p> : <>
      {c.pdf_count > 0 && <div className="checks-stock-note"><strong>A print PDF has already been prepared {c.pdf_count} time{c.pdf_count === 1 ? "" : "s"}.</strong><p>If the paper was spoiled, void this record and use the next numbered sheet. Only prepare another copy for the same number when the previous copy was never issued and is destroyed or securely retained.</p><label>Reason for another print PDF<input maxLength={240} value={reason} onChange={(e) => setReason(e.target.value)} /></label></div>}
      <label className="checks-checkbox"><input type="checkbox" disabled={busy} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I will load check #{c.check_number} for {c.account_name} and print one copy at Actual size.</label>
      <div className="ops-actions"><button className="btn primary" disabled={busy || !confirmed || (c.pdf_count > 0 && reason.trim().length < 3)} onClick={() => onPrint(reason)}><Printer size={16} /> Prepare print PDF</button>{c.status === "prepared" && c.pdf_count > 0 && <button className="btn" disabled={busy} onClick={onPrinted}>Confirm it already printed correctly</button>}<button className="text-btn" disabled={busy} onClick={() => setVoiding(!voiding)}>Void check</button></div>
      {voiding && <div className="checks-confirm"><p>Voiding updates this register only. If the check was issued, arrange any stop payment with your bank separately.</p><label>Reason for voiding<input maxLength={240} minLength={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} /></label><button className="btn" disabled={busy || voidReason.trim().length < 3} onClick={() => onVoid(voidReason)}>Confirm void check #{c.check_number}</button></div>}
    </>}{error && <p className="form-error" role="alert">{error}</p>}</div></Modal>;
}
