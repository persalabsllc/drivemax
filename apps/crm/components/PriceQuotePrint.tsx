import { productsTotal } from "../lib/operations";
import {
  type Customer,
  type PrintableQuote,
  fullMoney,
  quoteMath,
} from "../lib/model";
import { deskingPaymentOptions } from "../lib/desking";
import { financePayment } from "../lib/finance";
import { vehicleName } from "../lib/vehicles";

export function PriceQuotePrint({
  customer,
  quote,
  dealership,
}: {
  customer: Customer | null;
  quote: PrintableQuote;
  dealership: string;
}) {
  const values = quote.values;
  const totals = quoteMath(values);
  const finance = values.mode !== "cash";
  const { terms, downs } = deskingPaymentOptions(values);
  const days = values.daysToFirstPayment ?? 30;
  const trade = quote.trade_snapshot;
  const tradeDescription =
    quote.snapshot_version === 1
      ? trade?.description ||
        (trade
          ? vehicleName(trade)
          : values.tradeAllowance || values.payoff
            ? "Vehicle details not provided"
            : "None")
      : customer?.trade_vehicle || "None";
  const items: [string, number, boolean?][] = [
    ["Selling price", values.price],
    ["Document fee", values.docFee],
    ["Taxable add-ons", values.addOns ?? 0],
    ...(values.showProtectionProducts !== false
      ? [["Protection products", productsTotal(values)] as [string, number]]
      : []),
    ["Highway-use tax", totals.tax],
    ["Other taxes", values.otherTaxes ?? 0],
    ["Title / registration", values.titleFee],
    ["Trade allowance", values.tradeAllowance, true],
    ["Trade payoff", values.payoff],
  ];

  return (
    <section
      className="print-sheet price-quote-sheet"
      aria-label="Customer price quote"
    >
      <header className="pq-header">
        <img src="/drive-max-logo.webp" alt="Drive Max" />
        <div>
          <h1>{customer ? "Vehicle price quote" : "Quick price quote"}</h1>
          <p>
            {dealership} ·{" "}
            {new Date(quote.created_at).toLocaleDateString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </header>

      <div className="pq-details">
        <div>
          <span className="pq-label">
            {customer ? "Prepared for" : "Guest estimate"}
          </span>
          <h2>{customer?.name || "Customer details not provided"}</h2>
          <p>
            {[customer?.phone, customer?.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div>
          <span className="pq-label">Vehicle</span>
          <h2>{quote.vehicle || "To be selected"}</h2>
          <p>
            {[
              quote.vehicle_details?.stock_number &&
                `Stock #${quote.vehicle_details.stock_number}`,
              quote.vehicle_details?.vin && `VIN ${quote.vehicle_details.vin}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <p className="pq-trade">
          <b>Trade-in:</b> {tradeDescription}
          {trade &&
            ` · VIN ${trade.vin} · ${trade.mileage.toLocaleString()} miles`}
        </p>
      </div>

      <div className="pq-columns">
        <section className="pq-options">
          <h3>{finance ? "Choose your payment" : "Your cash purchase"}</h3>
          {finance ? (
            <>
              <p className="pq-instruction">
                Circle the monthly payment that works for you.
              </p>
              <table
                className="pq-matrix"
                aria-label="Monthly payment options by down payment and term"
              >
                <colgroup>
                  <col className="pq-term-column" />
                  <col />
                  <col />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">
                      {values.showAPR !== false ? "Term / APR" : "Term"}
                    </th>
                    {downs.map((down, col) => (
                      <th scope="col" key={col}>
                        <span>Down payment</span>
                        <strong>{fullMoney(down)}</strong>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {terms.map((term, row) => (
                    <tr key={row}>
                      <th scope="row">
                        <strong>{term.months}</strong>
                        <span>months</span>
                        {values.showAPR !== false && (
                          <small>{term.apr}% APR</small>
                        )}
                      </th>
                      {downs.map((down, col) => (
                        <td key={col}>
                          <strong>
                            {fullMoney(
                              financePayment(
                                totals.total - down,
                                term.apr,
                                term.months,
                                days,
                              ).payment,
                            )}
                          </strong>
                          <span>per month</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="pq-grid-note">
                First payment in {days} days. All amounts are estimates.
              </p>
            </>
          ) : (
            <div className="pq-cash">
              <span>Remaining cash balance</span>
              <strong>{fullMoney(totals.balance)}</strong>
              <p>
                Total after trade and payoff: {fullMoney(totals.total)}
                <br />
                Deposit / amount already paid: {fullMoney(values.downPayment)}
              </p>
            </div>
          )}
        </section>

        <section className="pq-itemization">
          <h3>
            {values.showProtectionProducts !== false
              ? "Price itemization"
              : "Price summary"}
          </h3>
          <table aria-label="Price itemization">
            <tbody>
              {items.map(([label, amount, deduction]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>
                    {deduction && amount > 0 ? "− " : ""}
                    {fullMoney(amount)}
                  </td>
                </tr>
              ))}
              <tr className="pq-subtotal">
                <th scope="row">
                  Total before {finance ? "down payment" : "deposit"}
                </th>
                <td>{fullMoney(totals.total)}</td>
              </tr>
              <tr>
                <td>
                  {finance ? "Selected cash down" : "Deposit / amount paid"}
                </td>
                <td>
                  {values.downPayment > 0 ? "− " : ""}
                  {fullMoney(values.downPayment)}
                </td>
              </tr>
              <tr className="pq-balance">
                <th scope="row">
                  {finance ? "Balance to finance" : "Remaining cash balance"}
                </th>
                <td>{fullMoney(totals.balance)}</td>
              </tr>
            </tbody>
          </table>
          {values.showProtectionProducts === false &&
            productsTotal(values) > 0 && (
              <p className="pq-grid-note">
                Totals include selected optional coverage; product details are
                omitted from this summary.
              </p>
            )}
          {finance && (
            <div className="pq-selected">
              <span className="pq-label">Selected payment estimate</span>
              <strong>{fullMoney(totals.payment)} / month</strong>
              <p>
                {values.months} months ·{" "}
                {values.showAPR !== false && <>{values.apr}% APR · </>}
                {fullMoney(values.downPayment)} down
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="pq-bottom">
        <p className="pq-disclosure">
          Preliminary estimate only; not a sales or financing contract. Verify
          all figures before signing final documents.
          {finance &&
            " Financing is subject to lender approval and terms. Actual lender calculations may differ."}
        </p>
        <div className="pq-signatures">
          {["Buyer", "Manager"].map((role) => (
            <div className="pq-signature" key={role}>
              <div>
                <span />
                <p>{role} signature</p>
              </div>
              <div className="pq-sign-date">
                <span />
                <p>Date</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
