"use client";
import { useState } from "react";
import { Car, Mail, Save } from "lucide-react";
import {
  canManage,
  myStaffId,
  money,
  type Workspace,
  type Customer,
  type Command,
} from "../lib/model";
import {
  emptyPreferences,
  preferencesSchema,
  matchInventory,
} from "../lib/sales-work";
import { Empty, SectionTitle, Modal } from "./ui";
type Run = (p: Command, message?: string) => Promise<{ ok: boolean }>;
export function BuyerPreferences({
  ws,
  customer,
  run,
  busy,
}: {
  ws: Workspace;
  customer: Customer;
  run: Run;
  busy: boolean;
}) {
  const saved = ws.buyer_preferences?.find((p) => p.id === customer.id);
  const [draft, setDraft] = useState(() => saved ?? emptyPreferences);
  const [error, setError] = useState("");
  const patch = (p: Partial<typeof draft>) => setDraft({ ...draft, ...p });
  const matches = matchInventory(
    {
      ...draft,
      id: customer.id,
      org_id: ws.org.id,
      revision: saved?.revision ?? 0,
    },
    ws.inventory,
    ws.inventory_prep,
  );
  return (
    <section className="profile-work-section">
      <SectionTitle
        title="Vehicle wish list"
        subtitle="Remember the customer's requirements and find suitable incoming stock."
      />
      <div className="form-grid">
        <label>
          Maximum vehicle price
          <input
            type="number"
            min="0"
            value={draft.max_price ?? ""}
            onChange={(e) =>
              patch({
                max_price: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        <label>
          Maximum mileage
          <input
            type="number"
            min="0"
            value={draft.max_miles ?? ""}
            onChange={(e) =>
              patch({
                max_miles: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        <label>
          Oldest model year
          <input
            type="number"
            min="1900"
            max="2100"
            value={draft.min_year ?? ""}
            onChange={(e) =>
              patch({
                min_year: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </label>
        {(
          [
            ["make", "Make"],
            ["model", "Model"],
            ["body", "Body style"],
            ["transmission", "Transmission"],
          ] as const
        ).map(([k, label]) => (
          <label key={k}>
            {label}
            <input
              value={draft[k]}
              onChange={(e) => patch({ [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label>
        Must-have features
        <textarea
          value={draft.features}
          onChange={(e) => patch({ features: e.target.value })}
          placeholder="Third row, backup camera, towing…"
        />
      </label>
      <label>
        Shopping notes
        <textarea
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
        />
      </label>
      <label className="check-line">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(e) => patch({ active: e.target.checked })}
        />
        Include this customer in inventory matching
      </label>
      {error && <p className="error-notice">{error}</p>}
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          const p = preferencesSchema.safeParse(draft);
          if (!p.success) {
            setError(p.error.issues[0].message);
            return;
          }
          const result = await run(
            {
              type: "save_buyer_preferences",
              id: customer.id,
              revision: saved?.revision ?? 0,
              preferences: p.data,
            },
            "Vehicle wish list saved",
          );
          if (result.ok) setError("");
        }}
      >
        <Save size={15} />
        Save wish list
      </button>
      <div className="wish-matches">
        <h3>{matches.length} potential inventory matches</h3>
        {matches.map((m) => (
          <div key={m.vehicle.id}>
            <Car size={16} />
            <span>
              <strong>{m.label}</strong>
              <small>
                Stock {m.vehicle.stock_number} ·{" "}
                {m.vehicle.mileage.toLocaleString()} miles
                {m.verify.length ? ` · Verify ${m.verify.join(", ")}` : ""}
              </small>
            </span>
            <strong>{money(m.vehicle.price)}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
export function BuyerMatches({
  ws,
  run,
  busy,
  onCustomer,
}: {
  ws: Workspace;
  run: Run;
  busy: boolean;
  onCustomer: (c: Customer) => void;
}) {
  const [draft, setDraft] = useState<{
    customer: Customer;
    subject: string;
    body: string;
  } | null>(null);
  const groups = (ws.buyer_preferences ?? [])
    .filter((p) => p.active)
    .flatMap((p) => {
      const c = ws.customers.find((c) => c.id === p.id);
      if (!c || (!canManage(ws.member.role) && c.assigned_to !== myStaffId(ws)))
        return [];
      return matchInventory(p, ws.inventory, ws.inventory_prep).map((m) => ({
        c,
        ...m,
      }));
    });
  return (
    <section className="panel buyer-match-panel">
      <SectionTitle
        title="Buyers for your inventory"
        subtitle="Matches update as vehicles arrive or CRM asking prices change. Verify equipment before offering it."
      />
      {!groups.length ? (
        <Empty
          title="Build your buyer list"
          body="Save a vehicle wish list inside customer profiles. Matching vehicles will appear here."
        />
      ) : (
        <div className="work-list">
          {groups.slice(0, 50).map((m) => (
            <article key={m.c.id + m.vehicle.id} className="work-row">
              <Car size={24} />
              <div className="work-person">
                <button onClick={() => onCustomer(m.c)}>
                  <strong>{m.c.name}</strong>
                </button>
                <span>
                  {m.label} · {money(m.vehicle.price)}
                </span>
                <small>
                  {m.verify.length
                    ? `Verify ${m.verify.join(", ")}`
                    : `Stock ${m.vehicle.stock_number} · ${m.vehicle.mileage.toLocaleString()} miles`}
                </small>
              </div>
              <button
                className="btn small"
                disabled={!m.c.email || m.c.email_opt_out}
                onClick={() =>
                  setDraft({
                    customer: m.c,
                    subject: "A vehicle to consider at Drive Max",
                    body: `Hi ${m.c.name.split(" ")[0]},\n\nWe have a ${m.label} that may fit your vehicle search. The current vehicle price is ${money(m.vehicle.price)}, plus our dealer administration fee, applicable tax, title and registration.\n\nWould you like more information or a time to see it? I'll confirm availability and the features that matter to you.\n\n${ws.member.name}\nDrive Max Used Cars\n(252) 541-0040`,
                  })
                }
              >
                <Mail size={14} />
                Prepare email
              </button>
            </article>
          ))}
        </div>
      )}
      {draft && (
        <Modal
          title="Review matching-vehicle email"
          subtitle="This saves a draft for review in the customer's email thread."
          onClose={() => setDraft(null)}
        >
          <div className="workflow-editor">
            <label>
              Subject
              <input
                value={draft.subject}
                onChange={(e) =>
                  setDraft({ ...draft, subject: e.target.value })
                }
              />
            </label>
            <label>
              Message
              <textarea
                rows={10}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              />
            </label>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                const r = await run(
                  {
                    type: "save_message",
                    id: crypto.randomUUID(),
                    revision: 0,
                    customer_id: draft.customer.id,
                    opportunity_id: null,
                    channel: "email",
                    recipient: draft.customer.email,
                    subject: draft.subject,
                    body: draft.body,
                    task_id: null,
                    quote_id: null,
                  },
                  "Draft saved in customer email thread",
                );
                if (r.ok) {
                  onCustomer(draft.customer);
                  setDraft(null);
                }
              }}
            >
              Save email draft
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
