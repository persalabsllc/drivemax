"use client";

import { loadStripe } from "@stripe/stripe-js/pure";
import type { PaymentIntentResult, Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { CreditCard, LockKeyhole, Printer, RefreshCw } from "lucide-react";
import type { Workspace } from "../lib/model";
import type { Payment, PaymentCommand } from "../lib/payments";
import { vehicleName } from "../lib/vehicles";

type Register = { payments: Payment[]; total: number; configured: boolean; livemode: boolean | null };
type Attempt = { payment: Payment; client_secret?: string; publishable_key?: string };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const amount = (cents: number) => usd.format(cents / 100);
const date = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
});
const statusText: Record<Payment["status"], string> = {
  pending: "Awaiting payment", processing: "Processing", paid: "Paid", canceled: "Canceled",
};
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
  const [register, setRegister] = useState<Register | null>(demo ? { configured: false, total: 0, payments: [], livemode: null } : null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(!demo);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useState(false);
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
    if (mounted.current) { setRegister(data); setPage(target); }
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
    lock.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (e) { if (mounted.current) setError(errorText(e)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function review(id: string, own = true) {
    void run(async () => {
      try {
        const next = await command({ action: own ? "resume" : "verify", id });
        accept(next);
        heading.current?.scrollIntoView({ block: "start" });
      } catch (e) {
        if (e instanceof PaymentRequestError && e.status === 404 && pendingId === id) {
          remember(storageKey, null); attemptId.current = null; setPendingId(null);
        }
        throw e;
      }
    });
  }
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (paused || !register?.configured || !employee || demo) return;
    const form = new FormData(e.currentTarget);
    const dollars = String(form.get("amount") || "").trim();
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(dollars)) {
      setError("Enter an amount in dollars with up to two decimal places."); return;
    }
    const [whole, fraction = ""] = dollars.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (cents < 50 || cents > 99999999) { setError("Enter an amount from $0.50 to $999,999.99."); return; }
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
          payer_name: String(form.get("payer") || "").trim(), purpose: String(form.get("purpose") || "").trim(), amount_cents: cents,
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
      const verified = await command({ action: "verify", id: current.payment.id });
      if (verified.payment.status === "pending") {
        const retry = await command({ action: "resume", id: current.payment.id });
        accept(retry);
        if (mounted.current && retry.payment.status === "pending") setError(cardMessage || "Payment is still awaiting confirmation. Check the card details and try again.");
      } else {
        accept(verified);
      }
    });
  }
  const active = attempt?.payment;
  useEffect(() => {
    if (demo || active?.status !== "processing") return;
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
  }, [active?.id, active?.status, accept, demo]);

  function close() {
    remember(storageKey, null); attemptId.current = null;
    setAttempt(null); setPendingId(null); setManualEntry(false); setError("");
    if (!demo) void run(() => load(0));
  }

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
      {!active && register?.livemode === false && <p className="dm-payment-message">Stripe test mode. Use a test card for this payment.</p>}
      {initializing ? <p className="dm-payment-hint" role="status">Loading payments…</p> : active ? <>
        {active.livemode === false && <p className="dm-payment-message">Stripe test mode. Use a test card for this payment.</p>}
        <div className="dm-payment-summary">
          <div><span>Amount</span><strong>{amount(active.amount_cents)}</strong></div>
          <div><span>Customer</span><b>{active.payer_name}</b></div>
          <div>
            <span>{active.inventory_id ? "Stock number" : "Stock number or reference"}</span><b>{active.stock_number}</b>
            {active.vehicle_name && <span>{active.vehicle_name}</span>}
          </div>
          <div><span>Payment for</span><b>{active.purpose}</b></div>
          <div className="dm-payment-collected"><span>Collected by</span><b>{active.employee_name}</b><small>Employee ID {active.employee_id}</small></div>
        </div>
        {attempt?.client_secret && attempt.publishable_key && active.status === "pending" ?
          <CardEntry key={active.id} attempt={attempt} busy={busy} onConfirm={confirm} /> :
          <div className="dm-payment-state">
            <span role="status">{active.status === "processing" ? "Stripe is processing this payment. The receipt opens when payment is confirmed." :
              active.status === "canceled" ? "This payment was canceled." :
              "Check this payment’s current status before continuing."}</span>
            {active.status !== "canceled" && <button type="button" className="btn" disabled={paused}
              onClick={() => review(active.id, employee === active.employee_id)}><RefreshCw size={15} />Check payment status</button>}
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
      {register?.payments.length ? <>
        <div className="dm-payment-scroll"><table className="dm-payment-table">
          <thead><tr><th>Customer / date</th><th>Stock or reference / purpose</th><th>Employee</th><th>Amount</th><th>Status</th><th><span className="dm-payment-sr">Actions</span></th></tr></thead>
          <tbody>{register.payments.map(p => <tr key={p.id}>
            <td><strong>{p.payer_name}</strong><small>{date.format(new Date(p.paid_at || p.created_at))}</small></td>
            <td><strong>{p.stock_number}</strong>{p.vehicle_name && <small>{p.vehicle_name}</small>}<small>{p.purpose}</small></td>
            <td>{p.employee_name}</td>
            <td className="dm-payment-value">{amount(p.amount_cents)}</td>
            <td><span className={`dm-payment-status ${p.status}`}>{statusText[p.status]}</span>{p.livemode === false && <small>Test mode</small>}</td>
            <td>{p.status === "paid" ? <a className="btn small" href={receiptPath(p.id)}><Printer size={14} />Print receipt</a> :
              p.status !== "canceled" && <button type="button" className="btn small" disabled={paused} onClick={() => review(p.id, p.employee_id === employee)}>
                {p.status === "pending" && p.employee_id === employee ? "Resume" : "Check status"}
              </button>}</td>
          </tr>)}</tbody>
        </table></div>
        {register.total > 25 && <div className="dm-payment-pagination">
          <span>Page {page + 1} of {Math.ceil(register.total / 25)}</span>
          <button type="button" className="btn small" disabled={!page || paused} onClick={() => void run(() => load(page - 1))}>Previous</button>
          <button type="button" className="btn small" disabled={(page + 1) * 25 >= register.total || paused} onClick={() => void run(() => load(page + 1))}>Next</button>
        </div>}
      </> : <p className="dm-payment-hint">{register ? "No payments recorded." : initializing ? "Loading payment history…" : "Payment history is unavailable. Refresh to try again."}</p>}
    </section>
  </div>;
}
