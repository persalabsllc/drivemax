"use client";
import { ServiceOrderEditor } from "./ServiceWorkspace";
import { serviceBlank, type ServiceInput } from "../lib/service";
import { useState } from "react";
import { Plus, Trash2, Wrench } from "lucide-react";
import { type Workspace, type Command, canManage, money } from "../lib/model";
import {
  emptyPrep,
  prepSchema,
  prepStages,
  type InventoryPrep,
} from "../lib/sales-work";
import { vehicleName, type InventoryVehicle } from "../lib/vehicles";
import { SectionTitle, Modal } from "./ui";
type Run = (p: Command, message?: string) => Promise<{ ok: boolean }>;
export function InventoryPreparation({
  ws,
  run,
  busy,
}: {
  ws: Workspace;
  run: Run;
  busy: boolean;
}) {
  const [repair, setRepair] = useState<ServiceInput | null>(null);
  const [selected, setSelected] = useState<InventoryVehicle | null>(null),
    [filter, setFilter] = useState("all"),
    [expanded, setExpanded] = useState(false);
  const stock = ws.inventory.filter((v) =>
    ["in_stock", "pending"].includes(v.status),
  );
  return (
    <section className="panel prep-panel">
      <SectionTitle
        title="Inventory preparation"
        subtitle="Track repairs, title status, photos and what is holding up each vehicle."
        action={
          <button className="btn" onClick={() => setExpanded(!expanded)}>
            <Wrench size={15} />
            {expanded ? "Collapse" : "Open preparation board"}
          </button>
        }
      />
      {expanded && (
        <>
          <div className="work-toolbar">
            <label>
              Stage
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All stages</option>
                {Object.entries(prepStages).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="prep-grid">
            {stock
              .filter(
                (v) =>
                  filter === "all" ||
                  (ws.inventory_prep?.find((p) => p.id === v.id)?.stage ??
                    "intake") === filter,
              )
              .map((v) => {
                const p = ws.inventory_prep?.find((p) => p.id === v.id);
                return (
                  <article key={v.id}>
                    <small>STOCK {v.stock_number}</small>
                    <h3>{vehicleName(v)}</h3>
                    <span className="prep-stage">
                      {prepStages[p?.stage ?? "intake"]}
                    </span>
                    <p>{p?.blocker || "No blocker recorded"}</p>
                    <div>
                      <small>
                        {p?.title_received
                          ? "Title received"
                          : "Title needs review"}
                        {p?.due_on ? ` · Due ${p.due_on}` : ""}
                      </small>
                    </div>
                    <small>
                      {ws.staff.find((s) => s.id === p?.assigned_to)?.name ??
                        "No preparation owner"}
                    </small>
                    <button
                      className="btn small"
                      disabled={!canManage(ws.member.role)}
                      onClick={() => setSelected(v)}
                    >
                      Manage preparation
                    </button>
                    {canManage(ws.member.role) && (
                      <>
                        <button
                          className="btn small"
                          onClick={() =>
                            setRepair(
                              serviceBlank(ws, undefined, undefined, v.id),
                            )
                          }
                        >
                          Create repair order
                        </button>
                        <small>
                          {
                            (ws.service_orders ?? []).filter(
                              (o) => o.inventory_id === v.id,
                            ).length
                          }{" "}
                          linked repair orders · review in Service
                        </small>
                      </>
                    )}
                  </article>
                );
              })}
          </div>
        </>
      )}
      {repair && (
        <ServiceOrderEditor
          ws={ws}
          initial={repair}
          run={run}
          busy={busy}
          onClose={() => setRepair(null)}
        />
      )}
      {selected && (
        <PrepEditor
          key={selected.id}
          ws={ws}
          vehicle={selected}
          saved={ws.inventory_prep?.find((p) => p.id === selected.id)}
          busy={busy}
          run={run}
          close={() => setSelected(null)}
        />
      )}
    </section>
  );
}
function PrepEditor({
  ws,
  vehicle,
  saved,
  busy,
  run,
  close,
}: {
  ws: Workspace;
  vehicle: InventoryVehicle;
  saved?: InventoryPrep;
  busy: boolean;
  run: Run;
  close: () => void;
}) {
  const [draft, setDraft] = useState(() => saved ?? emptyPrep),
    [sync, setSync] = useState(false),
    [error, setError] = useState("");
  const patch = (p: Partial<typeof draft>) => setDraft({ ...draft, ...p });
  return (
    <Modal
      title={`Prepare stock ${vehicle.stock_number}`}
      subtitle={vehicleName(vehicle)}
      wide
      onClose={close}
    >
      <div className="workflow-editor">
        <div className="form-grid">
          <label>
            Preparation stage
            <select
              value={draft.stage}
              onChange={(e) =>
                patch({ stage: e.target.value as typeof draft.stage })
              }
            >
              {Object.entries(prepStages).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Responsible person
            <select
              value={draft.assigned_to ?? ""}
              onChange={(e) => patch({ assigned_to: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {ws.staff
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Expected ready date
            <input
              type="date"
              value={draft.due_on}
              onChange={(e) => patch({ due_on: e.target.value })}
            />
          </label>
          <label>
            Body style
            <input
              value={draft.body}
              onChange={(e) => patch({ body: e.target.value })}
            />
          </label>
          <label>
            Transmission
            <input
              value={draft.transmission}
              onChange={(e) => patch({ transmission: e.target.value })}
            />
          </label>
        </div>
        <label>
          Verified equipment / features
          <textarea
            value={draft.features}
            onChange={(e) => patch({ features: e.target.value })}
          />
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={draft.title_received}
            onChange={(e) => patch({ title_received: e.target.checked })}
          />
          Title received and reviewed
        </label>
        <label>
          What is holding this vehicle up?
          <textarea
            value={draft.blocker}
            onChange={(e) => patch({ blocker: e.target.value })}
          />
        </label>
        <SectionTitle
          title="Recon items"
          action={
            <button
              className="btn small"
              onClick={() =>
                patch({
                  items: [
                    ...draft.items,
                    {
                      id: crypto.randomUUID(),
                      description: "",
                      vendor: "",
                      amount: 0,
                      due_on: "",
                      done: false,
                    },
                  ],
                })
              }
            >
              <Plus size={14} />
              Add item
            </button>
          }
        />
        {draft.items.map((i, index) => (
          <div className="recon-item" key={i.id}>
            <label>
              Description
              <input
                value={i.description}
                onChange={(e) =>
                  patch({
                    items: draft.items.map((v, n) =>
                      n === index ? { ...v, description: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              Vendor
              <input
                value={i.vendor}
                onChange={(e) =>
                  patch({
                    items: draft.items.map((v, n) =>
                      n === index ? { ...v, vendor: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              Cost
              <input
                type="number"
                min="0"
                step=".01"
                value={i.amount}
                onChange={(e) =>
                  patch({
                    items: draft.items.map((v, n) =>
                      n === index
                        ? { ...v, amount: Number(e.target.value) }
                        : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              Due
              <input
                type="date"
                value={i.due_on}
                onChange={(e) =>
                  patch({
                    items: draft.items.map((v, n) =>
                      n === index ? { ...v, due_on: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label className="check-line">
              <input
                type="checkbox"
                checked={i.done}
                onChange={(e) =>
                  patch({
                    items: draft.items.map((v, n) =>
                      n === index ? { ...v, done: e.target.checked } : v,
                    ),
                  })
                }
              />
              Done
            </label>
            <button
              className="icon-btn"
              aria-label={`Remove recon item ${index + 1}`}
              onClick={() =>
                patch({ items: draft.items.filter((v) => v.id !== i.id) })
              }
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <p>
          <strong>
            Itemized recon:{" "}
            {money(draft.items.reduce((sum, i) => sum + i.amount, 0))}
          </strong>{" "}
          · Current inventory recon: {money(vehicle.recon)}
        </p>
        <label className="check-line">
          <input
            type="checkbox"
            checked={sync}
            onChange={(e) => setSync(e.target.checked)}
          />
          Replace inventory recon total with the itemized total when saving
        </label>
        <p className="work-note">
          This replaces the existing recon amount; it does not add the same
          costs twice. Closed sale accounting stays unchanged. Publishing to the
          website is still managed in Control Room.
        </p>
        {error && <p className="error-notice">{error}</p>}
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            const p = prepSchema.safeParse(draft);
            if (!p.success) {
              setError(p.error.issues[0].message);
              return;
            }
            const r = await run(
              {
                type: "save_inventory_prep",
                id: vehicle.id,
                revision: saved?.revision ?? 0,
                prep: p.data,
                sync_recon: sync,
              },
              "Vehicle preparation saved",
            );
            if (r.ok) close();
          }}
        >
          Save preparation
        </button>
      </div>
    </Modal>
  );
}
