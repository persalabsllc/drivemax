"use client";
import { useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { type Workspace, fullMoney, canManage } from "../lib/model";
import {
  type TradeIntake as Intake,
  tradeIntakeSchema,
} from "../lib/operations";
import { vehicleName } from "../lib/vehicles";
import { Modal, Empty } from "./ui";
import type { RunCommand } from "./Communications";
export function TradeIntake({
  ws,
  run,
  busy,
  onCustomer,
}: {
  ws: Workspace;
  run: RunCommand;
  busy: boolean;
  onCustomer: (id: string, o: string) => void;
}) {
  const [filter, setFilter] = useState("active"),
    [edit, setEdit] = useState<string | null>(null);
  if (!canManage(ws.member.role)) return null;
  const trades = (ws.trades ?? []).filter((t) =>
      filter === "all" || filter === "active"
        ? !["returned", "wholesaled"].includes(t.status) || filter === "all"
        : t.status === filter,
    ),
    selected = ws.trades?.find((t) => t.id === edit);
  return (
    <>
      <section className="panel ops-trades">
        <div className="section-heading">
          <div>
            <h2>
              <ArrowLeftRight size={18} />
              Trade-in intake
            </h2>
            <p>
              Every trade from a sold deal arrives here with its ACV and an
              automatically assigned stock number.
            </p>
          </div>
          <label>
            Disposition
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">Active intake & retail</option>
              <option value="all">All trades</option>
              {[
                "received",
                "retail",
                "wholesale",
                "wholesaled",
                "returned",
              ].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="ops-help">
          Stock defaults to the sold vehicle’s stock number plus A. Trades stay
          in intake until you choose retail or wholesale. Returning a trade
          after an unwind preserves its history.
        </p>
        {trades.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Stock / VIN</th>
                  <th>Trade vehicle</th>
                  <th>Customer</th>
                  <th>Acquired</th>
                  <th>ACV / allowance</th>
                  <th>Current cost / recon</th>
                  <th>Disposition</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.stock_number}</strong>
                      <small className="subtext">{t.vin}</small>
                    </td>
                    <td>
                      {vehicleName(t) || "Details needed"}
                      <small className="subtext">
                        {t.mileage.toLocaleString()} miles
                      </small>
                    </td>
                    <td>
                      <button
                        className="name-button"
                        onClick={() =>
                          onCustomer(t.customer_id, t.opportunity_id)
                        }
                      >
                        {ws.customers.find((c) => c.id === t.customer_id)?.name}
                      </button>
                    </td>
                    <td>{t.acquired_on}</td>
                    <td>
                      {fullMoney(t.acv)}
                      <small className="subtext">
                        Allowance {fullMoney(t.allowance)}
                      </small>
                    </td>
                    <td>
                      {fullMoney(
                        t.status === "retail"
                          ? (ws.inventory.find((v) => v.id === t.inventory_id)
                              ?.cost ?? t.cost)
                          : t.cost,
                      )}
                      <small className="subtext">
                        Recon{" "}
                        {fullMoney(
                          t.status === "retail"
                            ? (ws.inventory.find((v) => v.id === t.inventory_id)
                                ?.recon ?? t.recon)
                            : t.recon,
                        )}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`badge badge-${t.status === "returned" ? "lost" : t.status === "retail" ? "live" : "new"}`}
                      >
                        {t.status}
                      </span>
                      {t.inventory_id && (
                        <small className="subtext">
                          Linked inventory:{" "}
                          {
                            ws.inventory.find((v) => v.id === t.inventory_id)
                              ?.status
                          }
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn small"
                        onClick={() => setEdit(t.id)}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="No trades in this view"
            body="Mark a deal with a structured trade-in sold to create its intake record automatically."
          />
        )}
      </section>
      {selected && (
        <TradeEditor
          key={selected.id + selected.revision}
          trade={selected}
          ws={ws}
          run={run}
          busy={busy}
          onClose={() => setEdit(null)}
        />
      )}
    </>
  );
}
function TradeEditor({
  trade: t,
  ws,
  run,
  busy,
  onClose,
}: {
  trade: Intake;
  ws: Workspace;
  run: RunCommand;
  busy: boolean;
  onClose: () => void;
}) {
  const linked = ws.inventory.find((v) => v.id === t.inventory_id),
    locked =
      ["returned", "wholesaled"].includes(t.status) ||
      (!!linked && ["sold", "pending"].includes(linked.status));
  const [draft, setDraft] = useState({
      stock_number: linked?.stock_number ?? t.stock_number,
      year: linked?.year ?? t.year,
      make: linked?.make ?? t.make,
      model: linked?.model ?? t.model,
      trim: linked?.trim ?? t.trim,
      mileage: linked?.mileage ?? t.mileage,
      color: linked?.color ?? t.color,
      cost: linked?.cost ?? t.cost,
      recon: linked?.recon ?? t.recon,
      price: linked?.price ?? t.price,
      status: t.status as "received" | "retail" | "wholesale" | "wholesaled",
      wholesale_price: t.wholesale_price,
      wholesale_on: t.wholesale_on ?? "",
      notes: t.notes,
    }),
    [error, setError] = useState("");
  const field = (
    key: "stock_number" | "make" | "model" | "trim" | "color",
    label: string,
  ) => (
    <label>
      {label}
      <input
        disabled={locked}
        required={["stock_number"].includes(key)}
        value={draft[key]}
        maxLength={250}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
      />
    </label>
  );
  const num = (
    key: "year" | "mileage" | "cost" | "recon" | "price" | "wholesale_price",
    label: string,
  ) => (
    <label>
      {label}
      <input
        type="number"
        disabled={locked}
        min={key === "year" ? 1900 : 0}
        max={key === "year" ? 2100 : key === "mileage" ? 3000000 : 1000000}
        step={["year", "mileage"].includes(key) ? 1 : 0.01}
        value={draft[key] ?? ""}
        onChange={(e) =>
          setDraft({
            ...draft,
            [key]:
              e.target.value === "" &&
              (key === "year" || key === "wholesale_price")
                ? null
                : Number(e.target.value),
          })
        }
      />
    </label>
  );
  return (
    <Modal
      title={`Trade-in · ${t.stock_number}`}
      subtitle={t.vin}
      wide
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = tradeIntakeSchema.safeParse(draft);
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          if (
            (
              await run(
                {
                  type: "update_trade_intake",
                  id: t.id,
                  revision: t.revision,
                  trade: parsed.data,
                },
                "Trade disposition saved",
              )
            ).ok
          )
            onClose();
          else
            setError(
              "Trade could not be saved. Check for an existing inventory VIN/stock, an attached deal, or a newer edit.",
            );
        }}
      >
        {locked && (
          <p className="ops-connection">
            {t.status === "returned"
              ? "Returned to the customer after an unwind."
              : t.status === "wholesaled"
                ? "Wholesale sale recorded."
                : "This trade is now attached to an inventory deal."}{" "}
            This intake record is read-only.
          </p>
        )}
        <label>
          Disposition
          <select
            disabled={locked}
            value={draft.status}
            onChange={(e) =>
              setDraft({
                ...draft,
                status: e.target.value as typeof draft.status,
              })
            }
          >
            <option value="received">Received · awaiting decision</option>
            <option value="retail">Move to retail inventory</option>
            <option value="wholesale">Hold for wholesale</option>
            <option value="wholesaled">Sold wholesale</option>
            {t.status === "returned" && (
              <option value="returned">Returned after unwind</option>
            )}
          </select>
        </label>
        <div className="ops-form-grid">
          {field("stock_number", "Stock number")}
          {num("year", "Year")}
          {field("make", "Make")}
          {field("model", "Model")}
          {field("trim", "Trim")}
          {field("color", "Color")}
          {num("mileage", "Updated mileage")}
          {num("cost", "Current vehicle cost")}
          {num("recon", "Reconditioning cost")}
          {num("price", "Retail asking price")}
        </div>
        {draft.status === "wholesaled" && (
          <div className="ops-form-grid">
            {num("wholesale_price", "Wholesale proceeds")}
            <label>
              Wholesale sold date
              <input
                required
                disabled={locked}
                type="date"
                value={draft.wholesale_on}
                onChange={(e) =>
                  setDraft({ ...draft, wholesale_on: e.target.value })
                }
              />
            </label>
          </div>
        )}
        <p className="ops-help">
          Original ACV {fullMoney(t.acv)} · allowance {fullMoney(t.allowance)} ·
          payoff {fullMoney(t.payoff)}. Updating intake cost does not rewrite
          the original deal recap.
        </p>
        <label>
          Notes
          <textarea
            disabled={locked}
            rows={3}
            maxLength={4000}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {!locked && (
          <button className="btn primary" disabled={busy}>
            Save trade
          </button>
        )}
      </form>
    </Modal>
  );
}
