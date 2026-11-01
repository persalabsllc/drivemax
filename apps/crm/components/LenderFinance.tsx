"use client";
import { useState } from "react";
import { Modal } from "./ui";
import { fullMoney, type QuoteValues } from "../lib/model";
import {
  emptyLenderFinance,
  lenderFinanceMath,
  type LenderFinance as LenderTerms,
} from "../lib/finance";
import { lenderFinanceSchema } from "../lib/lender-finance-schema";
import type { DealAccounting } from "../lib/operations";

export function LenderFinance({
  values,
  readOnly,
  accounting,
  onApply,
  onClose,
}: {
  values: QuoteValues;
  readOnly: boolean;
  accounting?: DealAccounting;
  onApply: (terms: LenderTerms, apr: number, months: number) => void;
  onClose: () => void;
}) {
  const [terms, setTerms] = useState<LenderTerms>(() => ({
    ...emptyLenderFinance,
    ...values.lenderFinance,
    ...(readOnly && accounting
      ? {
          lender: accounting.lender,
          buyRate: accounting.buy_rate,
          lenderFees: accounting.lender_fees ?? 0,
          reserveOverride: accounting.finance_reserve,
        }
      : {}),
  }));
  const [apr, setApr] = useState(values.apr);
  const [months, setMonths] = useState(values.months);
  const [error, setError] = useState("");
  const m = lenderFinanceMath({ ...values, apr, months, lenderFinance: terms });
  const source =
    readOnly && accounting ? accounting.finance_reserve_source : m.source;
  return (
    <Modal
      title="Lender details"
      subtitle="Internal · Selected payment option"
      className="lender-finance-modal"
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (readOnly) {
            onClose();
            return;
          }
          const parsed = lenderFinanceSchema.safeParse(terms);
          if (
            !parsed.success ||
            !Number.isFinite(m.reserve) ||
            m.reserve > 1_000_000
          ) {
            setError("Review the lender rates, fees and reserve amount.");
            return;
          }
          onApply(parsed.data, apr, months);
          onClose();
        }}
      >
        <label>
          Lender <span className="muted">(optional)</span>
          <input
            value={terms.lender}
            maxLength={250}
            readOnly={readOnly}
            onChange={(e) => setTerms({ ...terms, lender: e.target.value })}
            placeholder="Bank or credit union"
          />
        </label>
        <div className="form-grid">
          <label>
            Buy rate APR %
            <input
              type="number"
              min={0}
              max={50}
              step="0.001"
              value={terms.buyRate ?? ""}
              readOnly={readOnly}
              placeholder="Bank approval rate"
              onChange={(e) =>
                setTerms({
                  ...terms,
                  buyRate:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            Customer APR %
            <input
              type="number"
              min={0}
              max={50}
              step="0.001"
              required
              value={apr}
              readOnly={readOnly}
              onChange={(e) => setApr(Number(e.target.value))}
            />
          </label>
          <label>
            Term (months)
            <input
              type="number"
              min={1}
              max={120}
              step={1}
              required
              value={months}
              readOnly={readOnly}
              onChange={(e) => setMonths(Number(e.target.value))}
            />
          </label>
          <label>
            Lender fees $
            <input
              type="number"
              min={0}
              max={1_000_000}
              step="0.01"
              required
              value={terms.lenderFees}
              readOnly={readOnly}
              onChange={(e) =>
                setTerms({ ...terms, lenderFees: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <div
          className="lender-finance-totals"
          aria-live="polite"
          aria-atomic="true"
        >
          <div>
            <span>
              {source === "estimate" ? "Estimated reserve" : "Bank reserve"}
            </span>
            <strong>{fullMoney(m.reserve)}</strong>
            <small>Added to back gross</small>
          </div>
          <div>
            <span>Lender fees</span>
            <strong>{fullMoney(m.lenderFees)}</strong>
            <small>Deducted from front gross</small>
          </div>
        </div>
        {terms.buyRate === null && terms.reserveOverride === null && (
          <p className="ops-help">
            Enter the bank’s buy rate to calculate reserve.
          </p>
        )}
        {terms.buyRate !== null &&
          apr <= terms.buyRate &&
          terms.reserveOverride === null && (
            <p className="ops-help">No rate markup: estimated reserve is $0.</p>
          )}
        <details className="lender-finance-settings">
          <summary>Reserve payout &amp; override</summary>
          <div className="form-grid">
            <label>
              Dealer payout %
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                required
                value={terms.payoutPercent}
                readOnly={readOnly}
                onChange={(e) =>
                  setTerms({ ...terms, payoutPercent: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Confirmed reserve $
              <input
                type="number"
                min={0}
                max={1_000_000}
                step="0.01"
                value={terms.reserveOverride ?? ""}
                readOnly={readOnly}
                placeholder="Blank = automatic"
                onChange={(e) =>
                  setTerms({
                    ...terms,
                    reserveOverride:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <p className="ops-help">
            Estimate: the difference between customer and buy-rate monthly
            payments × term × dealer payout %. Default payout is 100%; adjust it
            to the bank’s agreement. A confirmed reserve replaces the estimate,
            including a flat fee or $0.
          </p>
        </details>
        <p className="ops-help">
          Reserve is an estimate until confirmed by the lender. Fees are a
          dealership expense. These internal figures stay off customer quotes
          and menus.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="lender-finance-actions">
          {!readOnly && (
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button className="btn primary">
            {readOnly ? "Done" : "Apply financing"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
