"use client";

import { loadStripe } from "@stripe/stripe-js/pure";
import type { PaymentIntentResult, Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CreditCard, LockKeyhole, Printer, RefreshCw } from "lucide-react";
import type { Workspace } from "../lib/model";
import { canManagePayment, type Payment, type PaymentCommand } from "../lib/payments";
import { vehicleName } from "../lib/vehicles";

type Register = { payments: Payment[]; total: number; page: number; configured: boolean; livemode: boolean | null };
type Attempt = { payment: Payment; client_secret?: string; publishable_key?: string };
type PaymentChange = { action: "edit_amount" | "delete"; payment: Payment; location: "history" | "details" };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const amount = (cents: number) => usd.format(cents / 100);
const date = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
});
const statusText: Record<Payment["status"], string> = {
  pending: "Awaiting payment", failed: "Failed", processing: "Processing", paid: "Paid", canceled: "Canceled",
};
const canEnterCard = (p: Payment) => p.status === "pending" || p.status === "failed";
const receiptPath = (id: string) => `/payments/receipt/${encodeURIComponent(id)}?print=1`;
const errorText = (e: unknown) => e instanceof Error ? e.message : "Could not reach the payment service. Try again.";

class PaymentRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new PaymentRequestError(result?.error || "Could not load the payment. Try again.", response.status);
  return result as T;
}
function command(input: PaymentCommand) {
  return api<Attempt>("/api/payments", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
}
function remember(key: string, id: string | null) {
  try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* History still supports recovery. */ }
}

function readAmount(value: string): { cents: number; error?: undefined } | { error: string; cents?: undefined } {
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value.trim()))
    return { error: "Enter a dollar amount with up to two decimal places." };
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 50 || cents > 99999999) return { error: "Enter an amount from $0.50 to $999,999.99." };
  return { cents };
}

function PaymentChangeDialog({ change, busy, error, onClose, onSubmit }: {
  change: PaymentChange; busy: boolean; error: string; onClose: () => void;
  onSubmit: (input: Extract<PaymentCommand, { action: "edit_amount" | "delete" }>) => void;
}) {
  const { payment, action } = change;
  const editing = action === "edit_amount";
  const [value, setValue] = useState((payment.amount_cents / 100).toFixed(2));
  const [touched, setTouched] = useState(false);
  const replacement = useRef<{ cents: number; id: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const parsed = readAmount(value);
  const amountError = parsed.error ?? (parsed.cents === payment.amount_cents ? "Enter a different amount." : "");
  const submitLabel = editing && parsed.cents !== undefined ? `Save amount ${amount(parsed.cents)}`
    : editing ? "Save amount" : "Delete payment";

  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!editing) { onSubmit({ action: "delete", id: payment.id }); return; }
    if (amountError || parsed.cents === undefined) return;
    if (replacement.current?.cents !== parsed.cents)
      replacement.current = { cents: parsed.cents, id: crypto.randomUUID() };
    onSubmit({ action: "edit_amount", id: payment.id, replacement_id: replacement.current.id, amount_cents: parsed.cents });
  }

  return <dialog ref={dialog} className="modal dm-payment-dialog" aria-labelledby="dm-payment-change-title"
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="modal-head"><h2 id="dm-payment-change-title">{editing ? "Edit payment amount" : "Delete this payment?"}</h2></header>
    <form onSubmit={submit} className="dm-payment-change">
      <p className="dm-payment-identify"><strong>{payment.payer_name}</strong><span>Stock or reference · {payment.stock_number}</span></p>
      <p>Current amount <strong>{amount(payment.amount_cents)}</strong></p>
      {editing ? <>
        <label>New amount (USD)
          <input type="text" inputMode="decimal" autoComplete="off" autoFocus value={value} disabled={busy}
            onFocus={e => e.currentTarget.select()} onChange={e => { setValue(e.target.value); setTouched(true); }}
            aria-invalid={touched && !!amountError} aria-describedby="dm-payment-amount-help" />
        </label>
        <p id="dm-payment-amount-help" aria-live="polite" className={touched && amountError ? "dm-payment-field-error" : "dm-payment-hint"}>
          {touched && amountError ? amountError : "Saving updates the amount. Collect the payment separately through card entry."}
        </p>
      </> : <p className="dm-payment-hint">This removes the unpaid entry from payment history and closes card entry for it.</p>}
      {error && <p className="dm-payment-message error" role="alert">{error}</p>}
      <div className="dm-payment-dialog-actions">
        <button type="button" className="btn" disabled={busy} autoFocus={!editing} onClick={onClose}>Cancel</button>
        <button type="submit" className={editing ? "btn primary" : "btn danger"} disabled={busy || (editing && !!amountError)}>
          {busy ? "Please wait…" : submitLabel}
        </button>
      </div>
    </form>
  </dialog>;
}

function CardEntry({ attempt, busy, onConfirm }: {
  attempt: Attempt; busy: boolean; onConfirm: (confirm: () => Promise<PaymentIntentResult>) => void;
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const sdk = useRef<{ stripe: Stripe; elements: StripeElements } | null>(null);
  const { publishable_key: key, client_secret: secret, payment } = attempt;

  useEffect(() => {
    if (!host.current || !key || !secret) return;
    const target = host.current;
    let live = true;
    let card: StripePaymentElement | undefined;
    setReady(false);
    setError("");
    const loadingError = () => {
      if (live) { setReady(false); setError("Card entry could not load. Refresh the page to reopen this payment."); }
    };
    void loadStripe(key).then(stripe => {
      if (!live) return;
      if (!stripe) { loadingError(); return; }
      const elements = stripe.elements({ clientSecret: secret });
      card = elements.create("payment", {
        defaultValues: { billingDetails: { name: payment.payer_name } },
        wallets: { applePay: "never", googlePay: "never", link: "never" },
      });
      card.on("ready", () => { if (live) { setError(""); setReady(true); } });
      card.on("loaderror", loadingError);
      card.mount(target);
      sdk.current = { stripe, elements };
    }).catch(loadingError);
    return () => { live = false; sdk.current = null; card?.destroy(); };
  }, [key, secret, payment.payer_name]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const client = sdk.current;
    if (!client || !ready || busy) return;
    const back = new URL("/", window.location.origin);
    back.searchParams.set("view", "payments");
    back.searchParams.set("payment", payment.id);
    onConfirm(() => client.stripe.confirmPayment({
      elements: client.elements, confirmParams: { return_url: back.href }, redirect: "if_required",
    }));
  }
  return <form className="dm-payment-card" onSubmit={submit}>
    <h3><LockKeyhole size={16} /> Customer card details</h3>
    <p className="dm-payment-hint dm-payment-card-instruction">Have the customer enter their card in Stripe’s secure form below.</p>
    <div ref={host} />
    {error ? <p className="dm-payment-message error" role="alert">{error}</p> :
      !ready && <p className="dm-payment-hint" role="status">Loading secure card entry…</p>}
    <button type="submit" className="btn primary" disabled={!ready || busy}>
      <CreditCard size={16} />{busy ? "Please wait…" : `Pay ${amount(payment.amount_cents)}`}
    </button>
  </form>;
}

export function Payments({ ws, demo }: { ws: Workspace; demo: boolean }) {
  const [register, setRegister] = useState<Register | null>(demo ? { configured: false, total: 0, page: 0, payments: [], livemode: null } : null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(!demo);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
  const [change, setChange] = useState<PaymentChange | null>(null);
  const [changeError, setChangeError] = useState("");
  const [notice, setNotice] = useState<{ location: PaymentChange["location"]; text: string; error?: boolean } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const attemptId = useRef<string | null>(null);
  const employee = ws.member.staff_id || "";
  const storageKey = `dmcrm:payment:${ws.org.id}:${ws.member.id}`;
  const stock = ws.inventory;
  const manual = manualEntry || stock.length === 0;
  const paused = busy || initializing;

  const load = useCallback(async (target: number) => {
    const data = await api<Register>(`/api/payments?page=${target}`);
    if (mounted.current) {
      setRegister(data); setPage(data.page ?? target);
      setAttempt(current => {
        const row = current && data.payments.find(p => p.id === current.payment.id);
        return row && current && row.status !== current.payment.status ? { payment: row } : current;
      });
    }
  }, []);
  const accept = useCallback((next: Attempt) => {
    if (!mounted.current) return;
    const p = next.payment;
    setPendingId(null);
    setRegister(prev => prev && ({
      ...prev, payments: prev.payments.map(row => row.id === p.id ? p : row),
    }));
    if (p.status === "paid") {
      remember(storageKey, null);
      window.location.assign(receiptPath(p.id));
      return;
    }
    setAttempt(next);
    attemptId.current = p.id;
    remember(storageKey, p.status !== "canceled" && p.employee_id === employee ? p.id : null);
  }, [storageKey, employee]);

  useEffect(() => {
    mounted.current = true;
    let live = true;
    if (!demo) {
      const url = new URL(window.location.href);
      let id = url.searchParams.get("payment");
      if (!id) { try { id = sessionStorage.getItem(storageKey); } catch { /* Optional persistence. */ } }
      if (url.searchParams.has("payment") || url.searchParams.has("payment_intent_client_secret")) {
        for (const key of ["payment", "payment_intent", "payment_intent_client_secret", "redirect_status"]) url.searchParams.delete(key);
        window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
      }
      // Keep only the CRM ID for reloads. Card details and Stripe secrets stay in Stripe's frame or memory.
      if (id) remember(storageKey, id);
      (async () => {
        try {
          await load(0);
          if (!live || !id) return;
          setPendingId(id);
          const resumed = await command({ action: "resume", id });
          if (live) accept(resumed);
        } catch (e) {
          if (!live) return;
          if (e instanceof PaymentRequestError && e.status === 404 && id) {
            remember(storageKey, null); setPendingId(null);
          } else {
            if (id) setPendingId(id);
            setError(errorText(e));
          }
        } finally { if (live) setInitializing(false); }
      })();
    }
    return () => { live = false; mounted.current = false; };
  }, [demo, storageKey, load, accept]);

  async function run(work: () => Promise<void>) {
    if (lock.current || demo) return;
    lock.current = true; setBusy(true); setError(""); setNotice(null);
    try { await work(); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function forget(id: string) {
    if (attemptId.current === id || pendingId === id) {
      remember(storageKey, null); attemptId.current = null; setPendingId(null);
    }
    setAttempt(current => current?.payment.id === id ? null : current);
  }
  async function openAttempt(id: string, action: "resume" | "verify") {
    try { return await command({ action, id }); }
    catch (e) {
      if (mounted.current && e instanceof PaymentRequestError && e.status === 404) {
        forget(id);
        await load(page);
      }
      throw e;
    }
  }
  function review(id: string, own = true) {
    void run(async () => {
      accept(await openAttempt(id, own ? "resume" : "verify"));
      heading.current?.scrollIntoView({ block: "start" });
    });
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (paused || !register?.configured || !employee || demo) return;
    const form = new FormData(e.currentTarget);
    const parsed = readAmount(String(form.get("amount") || ""));
    if (parsed.cents === undefined) { setError(parsed.error); return; }
    const reference = String(form.get("reference") || "").trim();
    const description = String(form.get("description") || "").trim();
    if (manual && !reference) { setError("Enter a stock number or payment reference."); return; }
    const stockFields = manual
      ? { manual_stock_number: reference, ...(description ? { manual_vehicle_name: description } : {}) }
      : { inventory_id: String(form.get("stock") || "") };
    void run(async () => {
      const id = attemptId.current ?? crypto.randomUUID();
      attemptId.current = id;
      remember(storageKey, id);
      try {
        const next = await command({
          action: "create", id, employee_id: employee, ...stockFields,
          payer_name: String(form.get("payer") || "").trim(), purpose: String(form.get("purpose") || "").trim(), amount_cents: parsed.cents,
        });
        accept(next);
      } catch (e) {
        if (mounted.current) {
          if (e instanceof PaymentRequestError && [400, 404, 422].includes(e.status)) {
            remember(storageKey, null); attemptId.current = null;
          } else { setPendingId(id); }
        }
        throw e;
      }
      await load(0);
    });
  }
  function confirm(send: () => Promise<PaymentIntentResult>) {
    const current = attempt;
    if (!current) return;
    void run(async () => {
      let cardMessage: string | undefined;
      try { cardMessage = (await send()).error?.message; }
      catch { cardMessage = "The connection was interrupted during payment."; }
      // A browser result (including a network error) can arrive after the card was charged.
      // Hide the pay button until the server reconciles this same intent.
      if (!mounted.current) return;
      setAttempt({ payment: current.payment });
      const verified = await openAttempt(current.payment.id, "verify");
      if (canEnterCard(verified.payment)) {
        const retry = await openAttempt(current.payment.id, "resume");
        accept(retry);
        if (mounted.current && canEnterCard(retry.payment)) setError(cardMessage || (retry.payment.status === "failed"
          ? "Payment failed. Check the card details before trying again." : "Payment is still awaiting confirmation. Check the card details and try again."));
      } else {
        accept(verified);
      }
    });
  }
  const active = attempt?.payment;
  useEffect(() => {
    if (demo || change || active?.status !== "processing") return;
    let live = true;
    let checks = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!live) return;
      try {
        const result = await command({ action: "verify", id: active.id });
        if (!live) return;
        accept(result);
        if (result.payment.status !== "processing") return;
      } catch { /* The manual status button remains available. */ }
      if (live && ++checks < 6) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => { live = false; clearTimeout(timer); };
  }, [active?.id, active?.status, accept, demo, change]);

  function close() {
    remember(storageKey, null); attemptId.current = null;
    setAttempt(null); setPendingId(null); setManualEntry(false); setError("");
    if (!demo) void run(() => load(page));
  }

  function managementButtons(p: Payment, location: PaymentChange["location"]) {
    if (!canManagePayment(p, ws.member.role, employee)) return null;
    const open = (action: PaymentChange["action"]) => {
      setChangeError(""); setError(""); setNotice(null); setChange({ action, payment: p, location });
    };
    return <>
      <button type="button" className="btn small" disabled={paused} onClick={() => open("edit_amount")}>Edit amount</button>
      <button type="button" className="btn small danger" disabled={paused} onClick={() => open("delete")}>Delete</button>
    </>;
  }

  function submitChange(input: Extract<PaymentCommand, { action: "edit_amount" | "delete" }>) {
    if (!change) return;
    const { payment: old, location } = change;
    const selected = attempt?.payment.id === old.id || pendingId === old.id;
    void run(async () => {
      setChangeError("");
      // Discard the old card form before a change can invalidate its intent.
      setAttempt(current => current?.payment.id === old.id ? { payment: current.payment } : current);
      let result: Attempt;
      try {
        result = await command(input);
      } catch (e) {
        if (!mounted.current) return;
        if (!(e instanceof PaymentRequestError) || ![403, 404, 409].includes(e.status)) {
          setChangeError(errorText(e)); return;
        }
        if (e.status === 404) forget(old.id);
        if (e.status === 409 && selected) {
          try {
            const verified = await command({ action: "verify", id: old.id });
            if (!mounted.current) return;
            setAttempt(verified); setPendingId(null);
            if (verified.payment.status === "paid" || verified.payment.status === "canceled") remember(storageKey, null);
          } catch (checkError) {
            if (!mounted.current) return;
            if (checkError instanceof PaymentRequestError && checkError.status === 404) forget(old.id);
          }
        }
        setChange(null); setNotice({ location, text: errorText(e), error: true });
        await load(page);
        return;
      }
      if (!mounted.current) return;
      const deleted = input.action === "delete";
      if (deleted) forget(old.id);
      else if (selected) accept(result);
      setRegister(prev => prev && ({
        ...prev, total: deleted ? Math.max(0, prev.total - 1) : prev.total,
        payments: deleted ? prev.payments.filter(p => p.id !== old.id)
          : prev.payments.map(p => p.id === old.id ? result.payment : p),
      }));
      setChange(null);
      const who = `${old.payer_name} · ${old.stock_number}`;
      setNotice({ location, text: deleted ? `Deleted the ${amount(old.amount_cents)} payment for ${who}.`
        : `Updated the payment for ${who} from ${amount(old.amount_cents)} to ${amount(result.payment.amount_cents)}.` });
      const lastPage = Math.max(0, Math.ceil(((register?.total ?? 1) - 1) / 25) - 1);
      await load(deleted ? Math.min(page, lastPage) : page);
    });
  }

  function changeNotice(location: PaymentChange["location"]) {
    return notice?.location === location && <p className={`dm-payment-message ${notice.error ? "error" : "success"}`}
      role={notice.error ? "alert" : "status"}>{notice.text}</p>;
  }
  const detailManagement = active && managementButtons(active, "details");

  return <div className="dm-payments">
    <section className="panel dm-payment-panel" aria-labelledby="dm-payment-title">
      <div className="section-heading">
        <div><h2 id="dm-payment-title" ref={heading}>{active ? "Payment details" : "Take a payment"}</h2></div>
        <CreditCard size={21} aria-hidden="true" />
      </div>
      {demo && <p className="dm-payment-message">Demo workspace. Sign in to the live CRM to collect a payment.</p>}
      {!demo && register?.configured === false && <p className="dm-payment-message" role="status">
        Stripe setup is pending. A Drive Max administrator needs to connect the CRM’s Stripe keys before card payments can be collected.
      </p>}
      {!demo && !employee && <p className="dm-payment-message error">Your account needs an active employee ID to collect a payment.</p>}
      {error && <p className="dm-payment-message error" role="alert">{error}</p>}
      {changeNotice("details")}
      {!active && register?.livemode === false && <p className="dm-payment-message">Stripe test mode. Use a test card for this payment.</p>}
      {initializing ? <p className="dm-payment-hint" role="status">Loading payments…</p> : active ? <>
        {active.livemode === false && <p className="dm-payment-message">Stripe test mode. Use a test card for this payment.</p>}
        <div className="dm-payment-summary">
          <div><span>Amount</span><strong>{amount(active.amount_cents)}</strong>
            <small className={`dm-payment-status ${active.status}`}>{statusText[active.status]}</small>
          </div>
          <div><span>Customer</span><b>{active.payer_name}</b></div>
          <div>
            <span>{active.inventory_id ? "Stock number" : "Stock number or reference"}</span><b>{active.stock_number}</b>
            {active.vehicle_name && <span>{active.vehicle_name}</span>}
          </div>
          <div><span>Payment for</span><b>{active.purpose}</b></div>
          <div className="dm-payment-collected"><span>Collected by</span><b>{active.employee_name}</b><small>Employee ID {active.employee_id}</small></div>
        </div>
        {detailManagement && <div className="dm-payment-actions dm-payment-detail-actions">{detailManagement}</div>}
        {attempt?.client_secret && attempt.publishable_key && canEnterCard(active) ?
          <CardEntry key={active.id} attempt={attempt} busy={busy} onConfirm={confirm} /> :
          <div className="dm-payment-state">
            <span role="status">{active.status === "processing" ? "Stripe is processing this payment. The receipt opens when payment is confirmed." :
              active.status === "canceled" ? "This payment was canceled." : active.status === "paid" ? "Payment received." :
              active.status === "failed" ? "The last payment attempt failed." : "Awaiting payment."}</span>
            {active.status === "paid" ? <a className="btn" href={receiptPath(active.id)}><Printer size={15} />Print receipt</a> :
              active.status !== "canceled" && <button type="button" className="btn" disabled={paused}
                onClick={() => review(active.id, employee === active.employee_id)}>
                {canEnterCard(active) && employee === active.employee_id ? "Continue to card entry" : "Check payment status"}
              </button>}
          </div>}
        <button type="button" className="text-btn dm-payment-back" disabled={paused} onClick={close}>Back to payments</button>
      </> : pendingId ? <div className="dm-payment-state">
        <span>Your last payment can be reopened using its original transaction.</span>
        <button type="button" className="btn" disabled={paused} onClick={() => review(pendingId)}><RefreshCw size={15} />Reopen payment</button>
        <button type="button" className="text-btn" disabled={paused} onClick={close}>Back to payments</button>
      </div> : <form className="dm-payment-form" onSubmit={create}>
        <div className="dm-payment-fields">
          <label>Customer name<input name="payer" autoComplete="off" maxLength={120} required /></label>
          <label>Amount (USD)<input name="amount" type="number" step="0.01" min="0.50" max="999999.99" inputMode="decimal" placeholder="0.00" autoComplete="off" required /></label>
          <div className="dm-payment-source">
            {manual ? <label>Stock number or reference<input name="reference" maxLength={250} autoComplete="off" required /></label> :
              <label>Stock number<select name="stock" defaultValue="" required>
                <option value="" disabled>Select a vehicle</option>
                {stock.map(v => <option key={v.id} value={v.id}>{v.stock_number} · {vehicleName(v)}{v.status === "sold" ? " (sold)" : v.status === "archived" ? " (archived)" : ""}</option>)}
              </select></label>}
            {stock.length > 0 && <button type="button" className="text-btn" disabled={paused} onClick={() => setManualEntry(!manual)}>
              {manual ? "Select from inventory" : "Enter stock or reference manually"}
            </button>}
          </div>
          <label>Payment for<input name="purpose" maxLength={160} list="dm-payment-purposes" placeholder="e.g. Vehicle deposit" required />
            <datalist id="dm-payment-purposes"><option value="Vehicle deposit" /><option value="Down payment" /><option value="Vehicle balance" /></datalist>
          </label>
          {manual && <label className="dm-payment-description">Vehicle or item description (optional)
            <input name="description" maxLength={160} autoComplete="off" />
          </label>}
        </div>
        <div className="dm-payment-footer">
          <div className="dm-payment-collected"><span>Collected by</span><b>{ws.member.name}</b><small>Employee ID {employee || "unavailable"}</small></div>
          <button type="submit" className="btn primary" disabled={paused || !employee || !register?.configured || demo}>
            <CreditCard size={16} />{busy ? "Please wait…" : "Continue to card entry"}
          </button>
        </div>
      </form>}
    </section>
    <section className="panel dm-payment-panel" aria-labelledby="dm-payment-history">
      <div className="section-heading">
        <div><h2 id="dm-payment-history">Payment history</h2></div>
        <button type="button" className="btn small" disabled={paused || demo} onClick={() => void run(() => load(page))}><RefreshCw size={14} />Refresh</button>
      </div>
      {changeNotice("history")}
      {register?.payments.length ? <>
        <div className="dm-payment-scroll"><table className="dm-payment-table">
          <thead><tr><th>Customer / date</th><th>Stock or reference / purpose</th><th>Employee</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>{register.payments.map(p => <tr key={p.id}>
            <td><strong>{p.payer_name}</strong><small>{date.format(new Date(p.paid_at || p.created_at))}</small></td>
            <td><strong>{p.stock_number}</strong>{p.vehicle_name && <small>{p.vehicle_name}</small>}<small>{p.purpose}</small></td>
            <td><span className="dm-payment-mobile-label">Collected by </span>{p.employee_name}</td>
            <td className="dm-payment-value">{amount(p.amount_cents)}</td>
            <td><span className={`dm-payment-status ${p.status}`}>{statusText[p.status]}</span>{p.livemode === false && <small>Test mode</small>}</td>
            <td><div className="dm-payment-actions">{p.status === "paid" ? <a className="btn small" href={receiptPath(p.id)}><Printer size={14} />Print receipt</a> :
              p.status !== "canceled" && <button type="button" className="btn small" disabled={paused} onClick={() => review(p.id, p.employee_id === employee)}>
                {canEnterCard(p) && p.employee_id === employee ? "Resume" : "Check status"}
              </button>}
              {managementButtons(p, "history")}
            </div></td>
          </tr>)}</tbody>
        </table></div>
        {register.total > 25 && <div className="dm-payment-pagination">
          <span>Page {page + 1} of {Math.ceil(register.total / 25)}</span>
          <button type="button" className="btn small" disabled={!page || paused} onClick={() => void run(() => load(page - 1))}>Previous</button>
          <button type="button" className="btn small" disabled={(page + 1) * 25 >= register.total || paused} onClick={() => void run(() => load(page + 1))}>Next</button>
        </div>}
      </> : <p className="dm-payment-hint">{register ? "No payments recorded." : initializing ? "Loading payment history…" : "Payment history is unavailable. Refresh to try again."}</p>}
    </section>
    {change && <PaymentChangeDialog change={change} busy={busy} error={changeError}
      onClose={() => { if (!lock.current) setChange(null); }} onSubmit={submitChange} />}
  </div>;
}
