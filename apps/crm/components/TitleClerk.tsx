"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileCheck2,
  FileText,
  History,
  ListChecks,
  Plus,
  Printer,
  Save,
  Search,
  ShieldCheck,
  Ticket,
  Upload,
  X,
} from "lucide-react";
import {
  dayKey,
  canManage,
  fullMoney,
  type Command,
  type Customer,
  type Workspace,
} from "../lib/model";
import {
  pendingTitleTotals,
  titleAmounts,
  titleAmountsNeedReview,
} from "../lib/title-clerk-money";
import { TitleAmountEditor } from "./TitleAmountEditor";
import { titleFormGroups } from "../lib/title-form-catalog";
import {
  calendarDays,
  checklistProgress,
  dmvForms,
  isActiveTitle,
  shiftDate,
  tagStatuses,
  tagTiming,
  titleAge,
  titleChecks,
  titleDocumentPurposes,
  titleStatuses,
  titleValidation,
  titleValues,
  type CheckState,
  type TempTag,
  type TitleCase,
  type TitleCheck,
  type TitleEvent,
  type TitlePurpose,
  type TitleStatus,
} from "../lib/title-clerk";
import {
  completeDocument,
  PendingDocumentError,
  uploadDocument,
} from "../lib/document-upload";
import { Modal } from "./ui";
const SoldPack = dynamic(() => import("./SoldPack").then((m) => m.SoldPack), {
  ssr: false,
});
type Run = (command: Command, message?: string) => Promise<{ ok: boolean }>;
type Props = {
  ws: Workspace;
  demo: boolean;
  busy: boolean;
  run: Run;
  onRefresh: () => Promise<void>;
  onCustomer: (c: Customer) => void;
};
const dateLabel = (value: string | null | undefined) =>
  value
    ? new Date(value + "T12:00:00Z").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/New_York",
      })
    : "—";
function TitleBadge({ status }: { status: TitleStatus }) {
  return <span className={`tc-badge ${status}`}>{titleStatuses[status]}</span>;
}
function TagBadge({ tag, today }: { tag: TempTag; today: string }) {
  const t = tagTiming(tag, today);
  return (
    <span
      className={`tc-badge ${t.expired ? "pending" : t.expiring ? "warning" : tag.status === "active" ? "at_dmv" : "neutral"}`}
    >
      {t.expired
        ? `Expired ${-t.days}d ago`
        : t.expiring
          ? t.days === 0
            ? "Expires today"
            : `${t.days}d remaining`
          : tagStatuses[tag.status]}
    </span>
  );
}
export function TitleClerk(props: Props) {
  const { ws } = props,
    today = dayKey();
  const [page, setPage] = useState<"queue" | "tags" | "history">("queue"),
    [selected, setSelected] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  const cases = useMemo(
    () =>
      (ws.title_cases ?? []).filter(
        (c) =>
          canManage(ws.member.role) ||
          ws.opportunities.some(
            (o) =>
              o.id === c.opportunity_id && o.assigned_to === ws.member.staff_id,
          ),
      ),
    [ws],
  );
  const caseIds = new Set(cases.map((c) => c.id)),
    tags = (ws.temp_tags ?? []).filter((t) => caseIds.has(t.case_id));
  const open = cases.filter(
      (c) => isActiveTitle(ws, c) && c.status !== "complete",
    ),
    pending = open.filter((c) => c.status === "pending");
  const urgentTags = tags.filter(
    (t) => tagTiming(t, today).expiring || tagTiming(t, today).expired,
  );
  const totals = pendingTitleTotals(ws, cases);
  const reviewCount = open.filter((c) => titleAmountsNeedReview(ws, c)).length;
  const matches = (c: TitleCase) =>
    search
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((q) =>
        [
          c.customer_name,
          c.vehicle_label,
          c.stock_number,
          c.vin,
          ...tags.filter((t) => t.case_id === c.id).map((t) => t.number),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
  const selectedCase = cases.find((c) => c.id === selected);
  if (selectedCase)
    return (
      <TitleCaseDetail
        key={selectedCase.id}
        {...props}
        record={selectedCase}
        onBack={() => setSelected(null)}
      />
    );
  const rows = (
    page === "queue"
      ? open
      : cases.filter((c) => c.status === "complete" || !isActiveTitle(ws, c))
  )
    .filter(matches)
    .filter(
      (c) =>
        filter === "all" ||
        (filter === "aging"
          ? titleAge(c, today) >= 30
          : filter === "due"
            ? !!c.next_action_on && c.next_action_on <= today
            : filter === "missing_amounts"
              ? titleAmounts(ws, c).total === null
              : filter === "review_amounts"
                ? titleAmountsNeedReview(ws, c)
                : c.status === filter),
    )
    .sort((a, b) => a.sold_on.localeCompare(b.sold_on));
  const tagRows = tags
    .filter((t) => {
      const c = cases.find((c) => c.id === t.case_id);
      const timing = tagTiming(t, today);
      return (
        c &&
        matches(c) &&
        (filter === "all" ||
          (filter === "active" && t.status === "active") ||
          (filter === "urgent" && (timing.expired || timing.expiring)) ||
          (filter === "closed" && t.status !== "active"))
      );
    })
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        a.expires_on.localeCompare(b.expires_on),
    );
  function switchPage(value: typeof page, status = "all") {
    setPage(value);
    setFilter(status);
  }
  return (
    <div className="title-clerk">
      <section className="tc-hero">
        <div>
          <span className="tc-eyebrow">
            <ShieldCheck size={16} /> TITLE & REGISTRATION
          </span>
          <h2>A clear path from sold to filed.</h2>
          <p>
            Your DMV queue, paperwork and temporary tags, together in one place.
          </p>
        </div>
        <div className="tc-hero-count">
          <FileCheck2 size={28} />
          <strong>{open.length}</strong>
          <span>deals in progress</span>
        </div>
      </section>
      <section
        className="tc-money-panel"
        aria-label="DMV amounts for all unfinished deals"
      >
        <div className="tc-section-heading">
          <div>
            <h3>DMV amounts on open deals</h3>
            <p>
              All {totals.count} unfinished title files, including files at DMV
              and pending items.
            </p>
          </div>
          <span className="tc-eyebrow">TITLE-WORK AMOUNTS</span>
        </div>
        <div className="tc-money-grid">
          <div>
            <span>DMV fees due</span>
            <output aria-label="Total DMV fees due">
              {totals.fees === null ? "Not recorded" : fullMoney(totals.fees)}
            </output>
            <small>
              Title / registration fees
              {totals.missingFees > 0
                ? ` · ${totals.missingFees} not recorded`
                : ""}
            </small>
          </div>
          <div>
            <span>Taxes due</span>
            <output aria-label="Total taxes due">
              {totals.taxes === null ? "Not recorded" : fullMoney(totals.taxes)}
            </output>
            <small>
              Highway-use tax + other verified taxes
              {totals.missingTaxes > 0
                ? ` · ${totals.missingTaxes} not recorded`
                : ""}
            </small>
          </div>
          <div>
            <span>
              {totals.missingDeals ? "Known fees + taxes" : "DMV fees + taxes"}
            </span>
            <output aria-label="Total DMV fees plus taxes">
              {totals.total === null ? "Not recorded" : fullMoney(totals.total)}
            </output>
            <small>The two totals added together · before DMV payments</small>
          </div>
        </div>
        {totals.missingDeals > 0 && (
          <div className="tc-money-missing">
            <span>
              {totals.missingDeals}{" "}
              {totals.missingDeals === 1 ? "deal needs" : "deals need"} saved
              fee or tax amounts. Missing amounts are excluded from the totals.
            </span>
            <button
              className="text-btn"
              onClick={() => {
                setSearch("");
                switchPage("queue", "missing_amounts");
              }}
            >
              Review deals <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </section>
      {reviewCount > 0 && (
        <div className="tc-money-review" role="status">
          <span>
            {reviewCount} {reviewCount === 1 ? "deal has" : "deals have"}{" "}
            missing or unconfirmed $0 amounts. Review them before relying on
            these totals.
          </span>
          <button
            className="text-btn"
            onClick={() => {
              setSearch("");
              switchPage("queue", "review_amounts");
            }}
          >
            Review amounts <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      <div className="tc-stats">
        <button onClick={() => switchPage("queue")}>
          <span>
            <ListChecks size={18} /> Open paperwork
          </span>
          <strong>{open.length}</strong>
          <small>Sold deals awaiting completion</small>
        </button>
        <button onClick={() => switchPage("queue", "aging")}>
          <span>
            <Clock size={18} /> 30+ days old
          </span>
          <strong>{open.filter((c) => titleAge(c, today) >= 30).length}</strong>
          <small>Give these deals a closer look</small>
        </button>
        <button onClick={() => switchPage("queue", "pending")}>
          <span>
            <History size={18} /> Pending
          </span>
          <strong>{pending.length}</strong>
          <small>Waiting on a document or next step</small>
        </button>
        <button onClick={() => switchPage("tags", "urgent")}>
          <span>
            <Ticket size={18} /> Tags to review
          </span>
          <strong>{urgentTags.length}</strong>
          <small>Expired or expiring within 7 days</small>
        </button>
      </div>
      <section className="tc-panel">
        <nav className="tc-tabs" aria-label="Title clerk sections">
          {(
            [
              ["queue", "DMV queue", ListChecks],
              ["tags", "Temporary tags", Ticket],
              ["history", "Completed & unwound", CheckCircle2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              aria-current={page === key ? "page" : undefined}
              onClick={() => switchPage(key)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="tc-toolbar">
          <label className="tc-search">
            <Search size={17} />
            <input
              aria-label="Search title files"
              placeholder="Customer, vehicle, stock, VIN or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="tc-filter">
            <span className="sr-only">Filter title records</span>
            <select
              aria-label="Filter title records"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">
                {page === "tags" ? "All tags" : "All statuses"}
              </option>
              {page === "tags" ? (
                <>
                  <option value="active">Assigned tags</option>
                  <option value="urgent">Expiring / expired</option>
                  <option value="closed">Closed tags</option>
                </>
              ) : (
                <>
                  {Object.entries(titleStatuses).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                  <option value="aging">30+ days old</option>
                  <option value="due">Follow-up due</option>
                  <option value="missing_amounts">
                    Missing fee / tax amounts
                  </option>
                  <option value="review_amounts">Amounts to review</option>
                </>
              )}
            </select>
          </label>
        </div>
        {page === "tags" ? (
          tagRows.length ? (
            <div className="tc-table-wrap">
              <table className="tc-table">
                <thead>
                  <tr>
                    <th>Tag / customer</th>
                    <th>Vehicle</th>
                    <th>Issued</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Open deal</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tagRows.map((t) => {
                    const c = cases.find((c) => c.id === t.case_id)!;
                    return (
                      <tr key={t.id}>
                        <td>
                          <button
                            className="tc-row-link"
                            onClick={() => setSelected(c.id)}
                          >
                            <strong>{t.number}</strong>
                            <span>{c.customer_name}</span>
                          </button>
                        </td>
                        <td>
                          {c.vehicle_label || "Vehicle not recorded"}
                          <small>{c.stock_number || c.vin}</small>
                        </td>
                        <td>{dateLabel(t.issued_on)}</td>
                        <td>{dateLabel(t.expires_on)}</td>
                        <td>
                          <TagBadge tag={t} today={today} />
                        </td>
                        <td>
                          <button
                            className="icon-btn"
                            aria-label={`Open ${c.customer_name}'s tag ${t.number}`}
                            onClick={() => setSelected(c.id)}
                          >
                            <ChevronRight size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <TitleEmpty
              title="No tags in this view"
              detail="Open a sold deal to record its assigned temporary tag."
            />
          )
        ) : rows.length ? (
          <div className="tc-table-wrap">
            <table className="tc-table">
              <thead>
                <tr>
                  <th>Customer / vehicle</th>
                  <th>Sold / age</th>
                  <th>DMV fees / taxes</th>
                  <th>Paperwork</th>
                  <th>Next step</th>
                  <th>Temporary tag</th>
                  <th>
                    <span className="sr-only">Open deal</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const count = checklistProgress(c),
                    tag = tags.find(
                      (t) => t.case_id === c.id && t.status === "active",
                    ),
                    active = isActiveTitle(ws, c),
                    money = titleAmounts(ws, c);
                  return (
                    <tr key={c.id}>
                      <td>
                        <button
                          className="tc-row-link"
                          onClick={() => setSelected(c.id)}
                        >
                          <strong>{c.customer_name}</strong>
                          <span>
                            {c.vehicle_label || "Vehicle not recorded"}
                          </span>
                          <small>
                            {c.stock_number
                              ? `Stock ${c.stock_number}`
                              : "No stock number"}
                            {c.vin ? ` · ${c.vin.slice(-6)}` : ""}
                          </small>
                        </button>
                      </td>
                      <td>
                        <span
                          className={
                            titleAge(c, today) >= 30 && c.status !== "complete"
                              ? "tc-age late"
                              : "tc-age"
                          }
                        >
                          {titleAge(c, today)} days
                          {c.status === "complete" ? " to finish" : ""}
                        </span>
                        <small>{dateLabel(c.sold_on)}</small>
                      </td>
                      <td className="tc-row-amounts">
                        <strong>
                          Fees{" "}
                          {money.fees === null
                            ? "Not recorded"
                            : fullMoney(money.fees)}
                        </strong>
                        <small>
                          Tax{" "}
                          {money.taxes === null
                            ? "Not recorded"
                            : fullMoney(money.taxes)}
                        </small>
                        {titleAmountsNeedReview(ws, c) && (
                          <span className="tc-amount-review-label">
                            Review amounts
                          </span>
                        )}
                      </td>
                      <td>
                        {active ? (
                          <TitleBadge status={c.status} />
                        ) : (
                          <span className="tc-badge neutral">Unwound</span>
                        )}
                        <small>
                          {count.done} / {count.total} checklist items
                        </small>
                      </td>
                      <td>
                        <span className="tc-next-step">
                          {!active
                            ? "Sale unwound"
                            : c.status === "pending"
                              ? c.pending_reason
                              : c.status === "complete"
                                ? "Filed & completed"
                                : c.status === "at_dmv" && c.submitted_on
                                  ? `At DMV since ${dateLabel(c.submitted_on)}`
                                  : c.status === "ready"
                                    ? "Deliver paperwork to DMV"
                                    : "Review paperwork"}
                        </span>
                        {c.next_action_on && (
                          <small
                            className={
                              c.next_action_on <= today &&
                              c.status !== "complete"
                                ? "tc-late"
                                : ""
                            }
                          >
                            Follow up {dateLabel(c.next_action_on)}
                          </small>
                        )}
                      </td>
                      <td>
                        {tag ? (
                          <>
                            <strong>{tag.number}</strong>
                            <small>
                              <TagBadge tag={tag} today={today} />
                            </small>
                          </>
                        ) : (
                          <span className="tc-muted">No active tag</span>
                        )}
                      </td>
                      <td>
                        <button
                          className="icon-btn"
                          aria-label={`Open title file for ${c.customer_name}`}
                          onClick={() => setSelected(c.id)}
                        >
                          <ChevronRight size={17} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <TitleEmpty
            title={
              search || filter !== "all"
                ? "No matching title files"
                : page === "queue"
                  ? "Your DMV queue is clear"
                  : "Completed files will appear here"
            }
            detail="Sold deals enter this workspace automatically. Older open deals appear first."
          />
        )}
        <div className="tc-panel-foot">
          {page === "tags"
            ? `${tagRows.length} tags shown · Keep the printed tag dates with the sale.`
            : `${rows.length} deals shown · Oldest sold dates first · Age pauses when paperwork is complete.`}
        </div>
      </section>
    </div>
  );
}
function TitleEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="tc-empty">
      <FileCheck2 size={30} />
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function TitleCaseDetail({
  record: c,
  onBack,
  ...props
}: Props & { record: TitleCase; onBack: () => void }) {
  const { ws, demo, busy, run, onCustomer } = props,
    today = dayKey(),
    active = isActiveTitle(ws, c);
  const [tab, setTab] = useState("Checklist"),
    [draft, setDraft] = useState(() => titleValues(c)),
    [revision, setRevision] = useState(c.revision),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [formSearch, setFormSearch] = useState(""),
    [editingAmounts, setEditingAmounts] = useState(false),
    [printForms, setPrintForms] = useState<string[] | null>(null);
  useEffect(() => {
    if (!dirty) {
      setDraft(titleValues(c));
      setRevision(c.revision);
    }
  }, [c, dirty]);
  const customer = ws.customers.find((x) => x.id === c.customer_id),
    opportunity = ws.opportunities.find((o) => o.id === c.opportunity_id);
  const amounts = titleAmounts(ws, c);
  const progress = checklistProgress(draft),
    stale = dirty && c.revision !== revision;
  function change(values: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...values }));
    setDirty(true);
    setError("");
  }
  function setStatus(status: TitleStatus) {
    change({
      status,
      ready_on: status === "ready" ? draft.ready_on || today : draft.ready_on,
      submitted_on:
        status === "at_dmv" ? draft.submitted_on || today : draft.submitted_on,
      completed_on: status === "complete" ? draft.completed_on || today : null,
    });
  }
  async function save() {
    const invalid = titleValidation(c, draft, today);
    if (invalid) {
      setError(invalid);
      return;
    }
    const result = await run(
      { type: "save_title_case", id: c.id, revision, values: draft },
      "Title paperwork saved",
    );
    if (result.ok) {
      setDirty(false);
      setError("");
    } else
      setError(
        "The changes were not saved. Check the message above, or refresh the file and try again.",
      );
  }
  function leave(action: () => void) {
    if (
      !dirty ||
      window.confirm(
        "Leave this title file without saving your checklist changes?",
      )
    )
      action();
  }
  const steps = ["sold", "ready", "at_dmv", "complete"] as const,
    step =
      draft.status === "pending"
        ? draft.submitted_on
          ? 2
          : draft.ready_on
            ? 1
            : 0
        : steps.indexOf(draft.status);
  return (
    <div className="title-clerk">
      <div className="tc-back-row">
        <button className="text-btn" onClick={() => leave(onBack)}>
          <ArrowLeft size={16} /> Back to title clerk
        </button>
        <span className="tc-muted">
          Sale {c.sale_id.slice(0, 8).toUpperCase()}
        </span>
      </div>
      <section className="tc-case-head">
        <div>
          <span className="tc-eyebrow">
            TITLE FILE · SOLD {dateLabel(c.sold_on).toUpperCase()}
          </span>
          <h2>{c.customer_name}</h2>
          <p>{c.vehicle_label || "Vehicle not recorded"}</p>
          <div className="tc-facts">
            <span>
              Stock <strong>{c.stock_number || "—"}</strong>
            </span>
            <span>
              VIN <strong>{c.vin || "—"}</strong>
            </span>
          </div>
        </div>
        <div className="tc-case-meta">
          {active ? (
            <TitleBadge status={c.status} />
          ) : (
            <span className="tc-badge neutral">Unwound sale</span>
          )}
          <strong>
            {titleAge(c, today)}{" "}
            <small>
              days {c.status === "complete" ? "to finish" : "since sold"}
            </small>
          </strong>
          {customer && (
            <button
              className="text-btn"
              onClick={() => leave(() => onCustomer(customer))}
            >
              Customer record <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      </section>
      <div className="tc-deal-amounts" aria-label="This sale's DMV amounts">
        <span>
          DMV fees{" "}
          <strong>
            {amounts.fees === null ? "Not recorded" : fullMoney(amounts.fees)}
          </strong>
        </span>
        <span>
          Taxes{" "}
          <strong>
            {amounts.taxes === null ? "Not recorded" : fullMoney(amounts.taxes)}
          </strong>
        </span>
        <span>
          DMV fees + taxes{" "}
          <strong>
            {amounts.total === null
              ? "Incomplete amounts"
              : fullMoney(amounts.total)}
          </strong>
        </span>
        <small>
          {c.amounts ? "Reviewed for title work" : "Saved sale amounts"} ·
          before DMV payments.
        </small>
        {canManage(ws.member.role) && (
          <button
            className="text-btn"
            onClick={() => setEditingAmounts(true)}
            disabled={!active || busy || dirty}
            title={
              dirty
                ? "Save checklist changes before reviewing amounts"
                : undefined
            }
          >
            Review / correct amounts
          </button>
        )}
      </div>
      {titleAmountsNeedReview(ws, c) && (
        <p className="tc-money-review">
          This file has missing or unconfirmed $0 amounts. A manager can verify
          or correct them using Review / correct amounts.
        </p>
      )}
      {c.amounts && (
        <p className="tc-amount-note">Amount verification: {c.amounts.note}</p>
      )}
      {editingAmounts && (
        <TitleAmountEditor
          ws={ws}
          record={c}
          run={run}
          onClose={() => setEditingAmounts(false)}
        />
      )}
      {!active && (
        <div className="tc-notice">
          This sale was unwound. Its documents and history remain available;
          active temporary tags were voided.
        </div>
      )}
      <ol
        className={`tc-steps ${draft.status === "pending" ? "is-pending" : ""}`}
        aria-label="Paperwork progress"
      >
        {steps.map((s, i) => (
          <li
            key={s}
            className={i <= step ? "reached" : ""}
            aria-current={draft.status === s ? "step" : undefined}
          >
            <span>
              {i < step || (s === "complete" && draft.status === "complete") ? (
                <Check size={16} />
              ) : (
                i + 1
              )}
            </span>
            <div>
              <strong>{titleStatuses[s]}</strong>
              <small>
                {dateLabel(
                  s === "sold"
                    ? c.sold_on
                    : s === "ready"
                      ? draft.ready_on
                      : s === "at_dmv"
                        ? draft.submitted_on
                        : draft.completed_on,
                )}
              </small>
            </div>
          </li>
        ))}
      </ol>
      <section className="tc-panel">
        <nav className="tc-tabs" aria-label="Title file sections">
          {[
            ["Checklist", ListChecks],
            ["Documents", Upload],
            ["DMV paperwork", Printer],
            ["Temporary tags", Ticket],
            ["History", History],
          ].map(([label, Icon]) => {
            const I = Icon as typeof ListChecks;
            return (
              <button
                key={String(label)}
                aria-current={tab === label ? "page" : undefined}
                onClick={() => setTab(String(label))}
              >
                <I size={16} />
                {String(label)}
              </button>
            );
          })}
        </nav>
        {tab === "Checklist" && (
          <div className="tc-detail-grid">
            <div>
              <div className="tc-section-heading">
                <div>
                  <h3>Paperwork checklist</h3>
                  <p>Mark each item done, or N/A when it does not apply.</p>
                </div>
                <span className="tc-completion">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <div className="tc-progress">
                <span
                  style={{
                    width: `${(progress.done / progress.total) * 100}%`,
                  }}
                />
              </div>
              <fieldset disabled={busy || !active} className="tc-checklist">
                {Object.entries(titleChecks).map(([key, label]) => (
                  <label
                    key={key}
                    className={
                      draft.checklist[key as TitleCheck] === "done"
                        ? "done"
                        : ""
                    }
                  >
                    <span>
                      <CheckCircle2 size={17} />
                      {label}
                    </span>
                    <select
                      aria-label={label}
                      value={draft.checklist[key as TitleCheck] ?? "todo"}
                      onChange={(e) =>
                        change({
                          checklist: {
                            ...draft.checklist,
                            [key]: e.target.value as CheckState,
                          },
                        })
                      }
                    >
                      <option value="todo">To do</option>
                      <option value="done">Done</option>
                      <option value="not_needed">N/A</option>
                    </select>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="tc-status-editor">
              <h3>Status & next step</h3>
              <fieldset disabled={busy || !active}>
                <label>
                  Paperwork status
                  <select
                    value={draft.status}
                    onChange={(e) => setStatus(e.target.value as TitleStatus)}
                  >
                    {Object.entries(titleStatuses).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {draft.status === "pending" && (
                  <label>
                    What are we waiting on?
                    <textarea
                      maxLength={1000}
                      value={draft.pending_reason}
                      placeholder="Missing title, signature, DMV correction…"
                      onChange={(e) =>
                        change({ pending_reason: e.target.value })
                      }
                    />
                  </label>
                )}
                <label>
                  Next follow-up
                  <input
                    type="date"
                    value={draft.next_action_on ?? ""}
                    onChange={(e) =>
                      change({ next_action_on: e.target.value || null })
                    }
                  />
                </label>
                <div className="tc-date-grid">
                  {(
                    [
                      ["ready_on", "Ready for DMV"],
                      ["submitted_on", "Delivered to DMV"],
                      ["completed_on", "Completed"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="date"
                        min={c.sold_on}
                        max={today}
                        disabled={
                          key === "completed_on" && draft.status !== "complete"
                        }
                        value={draft[key] ?? ""}
                        onChange={(e) =>
                          change({ [key]: e.target.value || null })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  Clerk notes
                  <textarea
                    maxLength={4000}
                    value={draft.notes}
                    placeholder="DMV office, missing items, who to call…"
                    onChange={(e) => change({ notes: e.target.value })}
                  />
                </label>
              </fieldset>
              {stale && (
                <p className="tc-notice">
                  Another person updated this file. Refresh it before saving.
                  <button
                    className="text-btn"
                    onClick={() => {
                      if (
                        window.confirm(
                          "Replace your unsaved changes with the latest saved file?",
                        )
                      ) {
                        setDirty(false);
                        setError("");
                      }
                    }}
                  >
                    Load latest file
                  </button>
                </p>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="btn primary"
                disabled={busy || !active || !dirty || stale}
                onClick={save}
              >
                <Save size={16} /> {busy ? "Saving…" : "Save paperwork"}
              </button>
              <small className="tc-save-note">
                {dirty
                  ? "You have unsaved changes."
                  : "Checklist and status changes are saved together."}
              </small>
            </div>
          </div>
        )}
        {tab === "Documents" && (
          <TitleDocuments {...props} record={c} active={active} />
        )}
        {tab === "DMV paperwork" && (
          <div className="tc-section">
            <div className="tc-section-heading">
              <div>
                <h3>Reprint DMV paperwork</h3>
                <p>
                  Uses this sold deal’s saved buyer and vehicle information.
                  Review the preview before printing.
                </p>
              </div>
              <button
                className="btn primary"
                disabled={!active || !customer || !opportunity}
                onClick={() => setPrintForms(dmvForms.map((f) => f.id))}
              >
                <Printer size={16} /> DMV packet
              </button>
            </div>
            {!active && (
              <p className="tc-notice">
                Open archived copies in Documents for an unwound sale.
              </p>
            )}
            <label className="tc-form-search">
              <Search size={16} />
              <input
                type="search"
                aria-label="Find DMV form"
                placeholder="Find a form by name or MVR number…"
                value={formSearch}
                onChange={(e) => setFormSearch(e.target.value)}
              />
            </label>
            {titleFormGroups.map((group) => {
              const matches = group.forms.filter((f) =>
                `${f.label} ${f.detail} ${f.help}`
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "")
                  .includes(formSearch.toLowerCase().replace(/[^a-z0-9]/g, "")),
              );
              return matches.length > 0 ? (
                <section className="tc-form-group" key={group.label}>
                  <h4>{group.label}</h4>
                  <div className="tc-print-grid">
                    {matches.map((f) => (
                      <button
                        key={f.id}
                        disabled={!active || !customer || !opportunity}
                        onClick={() => setPrintForms([f.id])}
                      >
                        <FileText size={23} />
                        <strong>{f.label}</strong>
                        <small>{f.detail}</small>
                        <p>{f.help}</p>
                        <span>
                          Preview & print <ArrowUpRight size={15} />
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null;
            })}
            {!titleFormGroups.some((g) =>
              g.forms.some((f) =>
                `${f.label} ${f.detail} ${f.help}`
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "")
                  .includes(formSearch.toLowerCase().replace(/[^a-z0-9]/g, "")),
              ),
            ) && (
              <p className="tc-notice">
                No matching forms. Try an MVR number or “lien”.
              </p>
            )}
            <p className="tc-muted">
              A reprinted form needs any required signatures. Previously
              uploaded signed copies stay in Documents.
            </p>
          </div>
        )}
        {tab === "Temporary tags" && (
          <TitleTags {...props} record={c} active={active} />
        )}
        {tab === "History" && (
          <div className="tc-section">
            <h3>Title file history</h3>
            <p className="tc-muted">
              Status, checklist, document and tag changes are kept with this
              sale.
            </p>
            <ol className="tc-history">
              {(ws.title_events ?? [])
                .filter((e) => e.case_id === c.id)
                .slice()
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((e) => (
                  <li key={e.id}>
                    <span className="tc-history-dot" />
                    <div>
                      <strong>{e.event}</strong>
                      <small>
                        {e.actor_name} ·{" "}
                        {new Date(e.created_at).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </small>
                      {eventSummary(e).map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                  </li>
                ))}
            </ol>
          </div>
        )}
      </section>
      {printForms && customer && opportunity && (
        <SoldPack
          workspace={ws}
          customer={customer}
          opportunity={opportunity}
          mode={printForms[0] === "MVR-2" ? "mvr2" : "pack"}
          formIds={printForms[0] === "MVR-2" ? undefined : printForms}
          titleCaseId={c.id}
          demo={demo}
          busy={busy}
          run={run}
          onClose={() => {
            setPrintForms(null);
            if (!demo) void props.onRefresh();
          }}
        />
      )}
    </div>
  );
}
function eventSummary(e: TitleEvent): string[] {
  const before = e.detail.before as Record<string, unknown> | undefined,
    after = e.detail.after as Record<string, unknown> | undefined;
  if (e.event === "DMV amounts reviewed" && after)
    return [
      `DMV fees: ${typeof before?.fees === "number" ? fullMoney(before.fees) : "Not recorded"} → ${fullMoney(Number(after.fees))}`,
      `Taxes: ${typeof before?.taxes === "number" ? fullMoney(before.taxes) : "Not recorded"} → ${fullMoney(Number(after.taxes))}`,
      String(after.note ?? ""),
    ];
  if (e.event === "Document filed")
    return [
      `${titleDocumentPurposes[e.detail.purpose as TitlePurpose] ?? "Document"}: ${String(e.detail.name ?? "")}`,
    ];
  if (!after)
    return e.detail.reason
      ? [String(e.detail.reason)]
      : e.detail.number
        ? [String(e.detail.number)]
        : [];
  if (e.event.startsWith("Temporary tag"))
    return [
      `${after.number} · ${dateLabel(String(after.issued_on))} → ${dateLabel(String(after.expires_on))}`,
      tagStatuses[after.status as TempTag["status"]],
      ...(after.closed_on
        ? [`Closed ${dateLabel(String(after.closed_on))}`]
        : []),
      ...(after.notes ? [String(after.notes)] : []),
    ];
  const lines: string[] = [];
  if (before?.status !== after.status)
    lines.push(
      `Status: ${titleStatuses[before?.status as TitleStatus] ?? "—"} → ${titleStatuses[after.status as TitleStatus]}`,
    );
  const oldChecks = before?.checklist as Record<string, string> | undefined,
    checks = after.checklist as Record<string, string> | undefined;
  for (const [key, label] of Object.entries(titleChecks))
    if ((oldChecks?.[key] ?? "todo") !== (checks?.[key] ?? "todo"))
      lines.push(
        `${label}: ${checks?.[key] === "done" ? "Done" : checks?.[key] === "not_needed" ? "N/A" : "To do"}`,
      );
  for (const [key, label] of [
    ["pending_reason", "Pending"],
    ["notes", "Notes"],
    ["next_action_on", "Next follow-up"],
    ["ready_on", "Ready for DMV"],
    ["submitted_on", "Delivered to DMV"],
    ["completed_on", "Completed"],
  ])
    if (before?.[key] !== after[key])
      lines.push(`${label}: ${after[key] || "Cleared"}`);
  return lines.length ? lines : ["File reviewed and saved."];
}

function TitleDocuments({
  record: c,
  active,
  ...props
}: Props & { record: TitleCase; active: boolean }) {
  const { ws, demo, busy, run, onRefresh } = props;
  const [purpose, setPurpose] = useState<TitlePurpose>("dmv_receipt"),
    [date, setDate] = useState(dayKey()),
    [notes, setNotes] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [existing, setExisting] = useState(""),
    [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [recovery, setRecovery] = useState<{
      id: string;
      complete: boolean;
      purpose: TitlePurpose;
    } | null>(null),
    [fileKey, setFileKey] = useState(0);
  const links = (ws.title_documents ?? []).filter((d) => d.case_id === c.id),
    files = links.flatMap((d) => {
      const f = ws.deal_files?.find((f) => f.id === d.file_id);
      return f ? [{ ...f, purpose: d.purpose }] : [];
    });
  const available = (ws.deal_files ?? []).filter(
    (f) =>
      f.opportunity_id === c.opportunity_id &&
      f.customer_id === c.customer_id &&
      !ws.title_documents?.some((d) => d.file_id === f.id),
  );
  async function attach(id: string, p: TitlePurpose) {
    setRecovery({ id, complete: false, purpose: p });
    setStage("Filing with title case…");
    const result = await run(
      { type: "attach_title_document", id: c.id, file_id: id, purpose: p },
      "Document filed with title case",
    );
    if (!result.ok)
      throw Error(
        "Your file is saved in the vault. Retry attaching it to this title file.",
      );
    setRecovery(null);
    setFile(null);
    setExisting("");
    setNotes("");
    setFileKey((k) => k + 1);
  }
  async function upload() {
    setError("");
    try {
      if (recovery) {
        setStage("Finishing upload…");
        if (recovery.complete) await completeDocument(recovery.id);
        await attach(recovery.id, recovery.purpose);
      } else if (existing) await attach(existing, purpose);
      else if (file && !demo) {
        const result = await uploadDocument(
          file,
          {
            customer_id: c.customer_id,
            opportunity_id: c.opportunity_id,
            inventory_id: null,
            kind: "title",
            document_date: date || dayKey(),
            notes,
          },
          setStage,
        );
        await attach(result.id, purpose);
      }
    } catch (e) {
      if (e instanceof PendingDocumentError)
        setRecovery({ id: e.id, complete: true, purpose });
      setError(e instanceof Error ? e.message : "Unable to file the document.");
    } finally {
      setStage("");
      if (!demo) await onRefresh();
    }
  }
  return (
    <div className="tc-detail-grid">
      <div>
        <div className="tc-section-heading">
          <div>
            <h3>Receipts & proof</h3>
            <p>Private files kept with this sale and in the Document Vault.</p>
          </div>
          <span className="tc-completion">{files.length}</span>
        </div>
        {files.length ? (
          <div className="tc-files">
            {files.map((f) => (
              <div key={f.id}>
                <FileText size={23} />
                <div>
                  <strong>{f.name}</strong>
                  <span>{titleDocumentPurposes[f.purpose]}</span>
                  <small>
                    {dateLabel(f.document_date)} ·{" "}
                    {Math.max(1, Math.round(f.size / 1024))} KB
                    {f.notes ? ` · ${f.notes}` : ""}
                  </small>
                </div>
                {!demo && (
                  <a
                    className="btn small"
                    href={`/api/deal-files/${f.id}?view=inline`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open <ArrowUpRight size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <TitleEmpty
            title="Keep the proof with the deal"
            detail="Upload DMV receipts, title transfer confirmations, tag copies and supporting paperwork."
          />
        )}
      </div>
      <div className="tc-status-editor">
        <h3>File a document</h3>
        {demo && (
          <p className="tc-notice">
            Uploads are available in the signed-in CRM.
          </p>
        )}
        {!active && (
          <p className="tc-notice">
            This sale is archived. Its filed copies remain available.
          </p>
        )}
        <fieldset disabled={busy || !!stage || !!recovery || !active}>
          <label>
            Document type
            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as TitlePurpose)}
            >
              {Object.entries(titleDocumentPurposes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Document date
            <input
              type="date"
              value={date}
              max={dayKey()}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Upload PDF, JPG or PNG · up to 25 MB
            <input
              key={fileKey}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              disabled={demo || !!existing}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {available.length > 0 && (
            <label>
              Or attach a saved deal document
              <select
                value={existing}
                disabled={!!file}
                onChange={(e) => setExisting(e.target.value)}
              >
                <option value="">Choose an existing document…</option>
                {available.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} · {dateLabel(f.document_date)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Document note
            <textarea
              maxLength={2000}
              value={notes}
              disabled={!!existing}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Receipt number, office or transfer confirmation…"
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {recovery && (
          <p className="tc-notice">
            Your uploaded file is retained. Retry filing below; unfinished
            uploads can also be recovered in Document Vault.
          </p>
        )}
        <button
          className="btn primary"
          disabled={
            busy ||
            !!stage ||
            !active ||
            (!recovery && !existing && (!file || demo))
          }
          onClick={upload}
        >
          <Upload size={16} />
          {stage || (recovery ? "Retry filing" : "File document")}
        </button>
        <small className="tc-save-note">
          Filing a document does not automatically check off a task. Review it,
          then update the checklist.
        </small>
      </div>
    </div>
  );
}

function TitleTags({
  record: c,
  active,
  ...props
}: Props & { record: TitleCase; active: boolean }) {
  const tags = (props.ws.temp_tags ?? [])
    .filter((t) => t.case_id === c.id)
    .slice()
    .sort((a, b) => b.issued_on.localeCompare(a.issued_on));
  const [editing, setEditing] = useState<TempTag | "new" | null>(null),
    today = dayKey();
  return (
    <div className="tc-section">
      <div className="tc-section-heading">
        <div>
          <h3>Assigned temporary tags</h3>
          <p>
            {c.customer_name} · {c.vehicle_label} · {c.stock_number || c.vin}
          </p>
        </div>
        <button
          className="btn primary"
          disabled={!active || tags.some((t) => t.status === "active")}
          onClick={() => setEditing("new")}
        >
          <Plus size={16} /> Record tag
        </button>
      </div>
      {tags.some((t) => t.status === "active") && (
        <p className="tc-notice">
          Close the current tag when permanent registration arrives, or record
          why it was voided or replaced, before adding another.
        </p>
      )}
      {tags.length ? (
        <div className="tc-tag-cards">
          {tags.map((t) => (
            <article key={t.id}>
              <div className="tc-tag-card-head">
                <div>
                  <span className="tc-eyebrow">TEMPORARY TAG</span>
                  <h3>{t.number}</h3>
                </div>
                <TagBadge tag={t} today={today} />
              </div>
              <dl>
                <div>
                  <dt>Issued</dt>
                  <dd>{dateLabel(t.issued_on)}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{dateLabel(t.expires_on)}</dd>
                </div>
                {t.closed_on && (
                  <div>
                    <dt>{tagStatuses[t.status]}</dt>
                    <dd>{dateLabel(t.closed_on)}</dd>
                  </div>
                )}
              </dl>
              {t.notes && <p>{t.notes}</p>}
              <button
                className="text-btn"
                disabled={!active || props.busy}
                onClick={() => setEditing(t)}
              >
                Update tag record <ArrowUpRight size={14} />
              </button>
            </article>
          ))}
        </div>
      ) : (
        <TitleEmpty
          title="No temporary tags recorded"
          detail="Record the tag number assigned to this customer and vehicle, along with its printed dates."
        />
      )}
      <p className="tc-muted">
        Dates default to 60 days from issue. Match the dates printed on the tag.
        Recording a tag here does not issue, extend or authorize a replacement
        tag.
      </p>
      {editing && (
        <TagEditor
          record={c}
          tag={editing === "new" ? null : editing}
          busy={props.busy}
          run={props.run}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
function TagEditor({
  record: c,
  tag,
  busy,
  run,
  onClose,
}: {
  record: TitleCase;
  tag: TempTag | null;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const today = dayKey(),
    [id] = useState(() => tag?.id ?? crypto.randomUUID()),
    [values, setValues] = useState(() => ({
      number: tag?.number ?? "",
      issued_on: tag?.issued_on ?? today,
      expires_on: tag?.expires_on ?? shiftDate(today, 60),
      status: tag?.status ?? ("active" as TempTag["status"]),
      closed_on: tag?.closed_on ?? null,
      notes: tag?.notes ?? "",
    })),
    [error, setError] = useState("");
  const days = calendarDays(values.issued_on, values.expires_on);
  return (
    <Modal
      title={tag ? "Update temporary tag" : "Record temporary tag"}
      subtitle={`${c.customer_name} · ${c.vehicle_label}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="tc-tag-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (days < 0 || days > 60) {
            setError("Expiration must be within 60 days of the issue date.");
            return;
          }
          const result = await run(
            {
              type: "save_temp_tag",
              id,
              case_id: c.id,
              revision: tag?.revision ?? 0,
              values,
            },
            "Temporary tag saved",
          );
          if (result.ok) onClose();
          else
            setError(
              "The tag was not saved. Check the message above and correct the record.",
            );
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Tag number
            <input
              autoFocus
              required
              maxLength={40}
              pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*"
              value={values.number}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  number: e.target.value.toUpperCase().trim(),
                }))
              }
              placeholder="Enter the printed tag number"
            />
          </label>
          <div className="tc-date-grid">
            <label>
              Issue date
              <input
                type="date"
                required
                min={c.sold_on}
                max={today}
                value={values.issued_on}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    issued_on: e.target.value,
                    ...(!tag && e.target.value
                      ? { expires_on: shiftDate(e.target.value, 60) }
                      : {}),
                  }))
                }
              />
            </label>
            <label>
              Expiration date
              <input
                type="date"
                required
                min={values.issued_on}
                max={
                  values.issued_on ? shiftDate(values.issued_on, 60) : undefined
                }
                value={values.expires_on}
                onChange={(e) =>
                  setValues((v) => ({ ...v, expires_on: e.target.value }))
                }
              />
            </label>
          </div>
          <label>
            Status
            <select
              value={values.status}
              onChange={(e) => {
                const status = e.target.value as TempTag["status"];
                setValues((v) => ({
                  ...v,
                  status,
                  closed_on:
                    status === "active" ? null : (v.closed_on ?? today),
                }));
              }}
            >
              {Object.entries(tagStatuses).map(([key, label]) => (
                <option
                  key={key}
                  value={key}
                  disabled={
                    key === "active" && !!tag && tag.status !== "active"
                  }
                >
                  {label}
                </option>
              ))}
            </select>
          </label>
          {values.status !== "active" && (
            <label>
              Closed date
              <input
                type="date"
                required
                min={values.issued_on}
                max={today}
                value={values.closed_on ?? ""}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    closed_on: e.target.value || null,
                  }))
                }
              />
            </label>
          )}
          <label>
            Notes / reason
            {["void", "replaced"].includes(values.status) ? " (required)" : ""}
            <textarea
              maxLength={2000}
              required={["void", "replaced"].includes(values.status)}
              value={values.notes}
              onChange={(e) =>
                setValues((v) => ({ ...v, notes: e.target.value }))
              }
            />
          </label>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="tc-form-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onClose}
          >
            <X size={15} /> Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            <Save size={15} /> {busy ? "Saving…" : "Save tag"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
