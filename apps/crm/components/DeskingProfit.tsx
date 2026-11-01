"use client";
import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { fullMoney, type QuoteValues } from "../lib/model";
import { quoteGross, type DealAccounting } from "../lib/operations";
import type { VehicleDetails, Trade } from "../lib/vehicles";

export function DeskingProfit({
  values,
  vehicle,
  accounting,
  trade,
}: {
  values: QuoteValues;
  vehicle?: VehicleDetails | null;
  accounting?: DealAccounting;
  trade?: Pick<Trade, "allowance" | "acv"> | null;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const m = quoteGross(values, vehicle, accounting, trade);
  const money = (n: number | null) =>
    n === null ? "Cost needed" : fullMoney(n);
  const tone = (n: number | null) =>
    n === null ? "missing" : n < 0 ? "loss" : "gain";
  return (
    <section className="desk-profit" aria-label="Internal deal profit">
      <div className="desk-profit-heading">
        <span>
          Deal profit <small>Internal</small>
        </span>
        <button
          type="button"
          className="text-btn"
          aria-expanded={visible}
          aria-controls={id}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          {visible ? "Hide profit" : "Show profit"}
        </button>
      </div>
      {visible && (
        <div id={id}>
          <dl
            className="desk-profit-figures"
            aria-live="polite"
            aria-atomic="true"
          >
            <div>
              <dt>Front gross</dt>
              <dd className={tone(m.front)}>{money(m.front)}</dd>
            </div>
            <div>
              <dt>Back gross</dt>
              <dd className={tone(m.back)}>{money(m.back)}</dd>
            </div>
          </dl>
          <div className="desk-profit-total">
            <span>{accounting ? "Total gross" : "Estimated total gross"}</span>
            <strong className={tone(m.gross)}>{money(m.gross)}</strong>
          </div>
          <p className="desk-profit-note">
            Includes doc fee · before commissions and overhead.
            {!accounting &&
              " Includes lender reserve and fees entered for the selected payment option."}
          </p>
          <details className="desk-profit-details">
            <summary>Calculation details</summary>
            <dl>
              {(
                [
                  ["Vehicle cost", m.cost],
                  ["Vehicle reconditioning", m.recon],
                  ["Trade ACV less allowance", m.adjustment],
                  ["Product retail", m.productRevenue],
                  ["Product cost", m.productCost],
                  ["Lender fees", m.lenderFees],
                  [
                    m.reserveSource === "estimate"
                      ? "Estimated finance reserve"
                      : "Finance reserve",
                    m.financeReserve,
                  ],
                  ...(accounting
                    ? [
                        ["Accessory cost", accounting.accessory_cost],
                        ["Other direct costs", accounting.other_cost],
                      ]
                    : []),
                ] as [string, number | null][]
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{money(value)}</dd>
                </div>
              ))}
            </dl>
            {m.front === null && (
              <p>
                Record the vehicle cost and reconditioning in inventory or
                vehicle details to calculate front gross.
              </p>
            )}
            {m.back === null && (
              <p>
                Record every product cost in F&amp;I product details to
                calculate back gross.
              </p>
            )}
            <p>
              Lender fees reduce front gross. Reserve adds to back gross and may
              change with the amount financed. Estimates remain subject to the
              lender’s settlement. Trade reconditioning belongs to the acquired
              trade.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}
