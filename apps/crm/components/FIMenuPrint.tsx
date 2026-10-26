import {
  type Customer,
  type PrintableQuote,
  fullMoney,
  quoteMath,
} from "../lib/model";
import {
  customerFIProduct,
  fiOptionValues,
  fiSelectionMatches,
} from "../lib/fi-menu";

type CustomerProduct = ReturnType<typeof customerFIProduct>;
function Product({ product }: { product: CustomerProduct }) {
  return (
    <div className="fi-print-product">
      <div>
        <strong>{product.name}</strong>
        <b>{fullMoney(product.price)}</b>
      </div>
      {product.provider && <span>{product.provider}</span>}
      {product.description && <p>{product.description}</p>}
      <small>
        {product.coverage} · {fullMoney(product.deductible)} deductible
      </small>
    </div>
  );
}
export function FIMenuPrint({
  quote,
  customer,
  dealership,
  acceptance = false,
}: {
  quote: PrintableQuote;
  customer: Customer | null;
  dealership: string;
  acceptance?: boolean;
}) {
  const menu = quote.values.fiMenu;
  if (!menu || (acceptance && !fiSelectionMatches(quote.values))) return null;
  const products = menu.products.map(customerFIProduct);
  const base = quoteMath(fiOptionValues(quote.values, menu, "declined"));
  const finance = quote.values.mode !== "cash";
  const name =
    menu.customer_name ?? customer?.name ?? "Customer details not provided";
  const co =
    menu.co_buyer_name ??
    (customer?.co_buyer
      ? [
          customer.co_buyer.first_name,
          customer.co_buyer.middle_name,
          customer.co_buyer.last_name,
          customer.co_buyer.suffix,
        ]
          .filter(Boolean)
          .join(" ")
      : "");
  const totals = quoteMath(quote.values);
  const selected =
    menu.selected === "declined"
      ? []
      : menu.selected === null
        ? []
        : menu.packages[menu.selected].product_ids;
  const accepted = products.filter((p) => selected.includes(p.id)),
    declined = products.filter((p) => !selected.includes(p.id));
  const choice =
    menu.selected === "declined"
      ? "All optional products declined"
      : menu.selected !== null
        ? menu.packages[menu.selected].name
        : "";
  return (
    <div className={`fi-print ${acceptance ? "fi-acceptance" : "fi-options"}`}>
      <header className="fi-print-head">
        <img src="/drive-max-logo.webp" alt="Drive Max" />
        <div>
          <h1>
            {acceptance
              ? "Final product acceptance"
              : "Your protection options"}
          </h1>
          <p>
            {dealership} ·{" "}
            {new Date(quote.created_at).toLocaleDateString("en-US", {
              timeZone: "America/New_York",
            })}
          </p>
        </div>
      </header>
      <div className="fi-print-identity">
        <div>
          <strong>{name}</strong>
          {co && <span>Co-buyer: {co}</span>}
        </div>
        <div>
          <strong>{quote.vehicle || "Vehicle to be selected"}</strong>
          <span>
            {[
              quote.vehicle_details?.stock_number &&
                `Stock #${quote.vehicle_details.stock_number}`,
              quote.vehicle_details?.vin && `VIN ${quote.vehicle_details.vin}`,
              quote.vehicle_details?.mileage != null &&
                `${quote.vehicle_details.mileage.toLocaleString("en-US")} miles`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      </div>
      <div className="fi-print-baseline">
        <span>
          Selling price <b>{fullMoney(quote.values.price)}</b>
        </span>
        <span>
          {finance ? "Cash down" : "Deposit / paid"}{" "}
          <b>{fullMoney(quote.values.downPayment)}</b>
        </span>
        <span>
          Trade / payoff{" "}
          <b>
            {fullMoney(quote.values.tradeAllowance)} /{" "}
            {fullMoney(quote.values.payoff)}
          </b>
        </span>
        <span>
          Without optional products{" "}
          <b>
            {fullMoney(finance ? base.payment : base.balance)}
            {finance ? "/mo" : " cash due"}
          </b>
        </span>
      </div>
      {finance && (
        <p className="fi-print-terms">
          {quote.values.months} months · {quote.values.apr}% APR · First payment
          in {quote.values.daysToFirstPayment ?? 30} days. The same financing
          terms apply to every option below.
        </p>
      )}
      {acceptance ? (
        <>
          <div className="fi-acceptance-choice">
            <div>
              <span>Recorded selection</span>
              <h2>{choice}</h2>
              <small>
                Optional products:{" "}
                {fullMoney(accepted.reduce((s, p) => s + p.price, 0))}
              </small>
            </div>
            <div>
              <strong>
                {fullMoney(finance ? totals.payment : totals.balance)}
                {finance ? "/mo" : " cash due"}
              </strong>
              <span>
                Vehicle total before down payment: {fullMoney(totals.total)}
              </span>
              <span>
                {finance
                  ? "Amount financed before additional first-period interest"
                  : "Remaining cash balance"}
                : {fullMoney(totals.balance)}
              </span>
              {finance && (
                <span>
                  Additional first-period interest:{" "}
                  {fullMoney(totals.firstPeriodInterest)}
                </span>
              )}
            </div>
          </div>
          <table className="fi-acceptance-table">
            <thead>
              <tr>
                <th>Accepted coverage</th>
                <th>Declined coverage</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(
                { length: Math.max(accepted.length, declined.length, 1) },
                (_, i) => (
                  <tr key={i}>
                    <td>
                      {accepted[i] ? (
                        <Product product={accepted[i]} />
                      ) : i === 0 ? (
                        <p>No optional products selected.</p>
                      ) : null}
                    </td>
                    <td>
                      {declined[i] ? (
                        <Product product={declined[i]} />
                      ) : i === 0 ? (
                        <p>No offered products declined.</p>
                      ) : null}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
          <section className="fi-acknowledgement">
            <h2>Acknowledgement · {name}</h2>
            <p>
              I reviewed the optional products presented above. The accepted and
              declined items reflect my selection. I understand the listed
              product prices are included in the vehicle total and, if financed,
              the payment estimate shown. Coverage, exclusions, eligibility and
              cancellation terms are governed by the individual provider
              contracts.
            </p>
            <p>
              These products are optional. This form records my choices;
              coverage requires the applicable provider contracts.
            </p>
            <div className="fi-signatures">
              <div>
                Buyer signature <span />
                Date __________
              </div>
              {co && (
                <div>
                  Co-buyer signature <span />
                  Date __________
                </div>
              )}
              <div>
                Dealership representative <span />
                Date __________
              </div>
            </div>
          </section>
        </>
      ) : (
        <table className="fi-print-options">
          <thead>
            <tr>
              {menu.packages.map((option, i) => {
                const values = fiOptionValues(quote.values, menu, i),
                  math = quoteMath(values);
                return (
                  <th key={i}>
                    <span>{option.name}</span>
                    <strong>
                      {fullMoney(finance ? math.payment : math.balance)}
                      <small>{finance ? "/mo" : " cash due"}</small>
                    </strong>
                    <p>
                      Products: {fullMoney(values.serviceContract ?? 0)}
                      <br />
                      Vehicle total: {fullMoney(math.total)}
                    </p>
                    <small>
                      +
                      {fullMoney(
                        finance
                          ? math.payment - base.payment
                          : math.balance - base.balance,
                      )}
                      {finance ? "/mo" : ""} vs. no products
                    </small>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {products.length ? (
              products.map((product) => (
                <tr key={product.id}>
                  {menu.packages.map((option, i) => (
                    <td key={i}>
                      {option.product_ids.includes(product.id) ? (
                        <Product product={product} />
                      ) : (
                        <div className="fi-not-included">
                          {product.name}
                          <span>Not included</span>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4}>No products configured.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      <footer className="fi-print-footer">
        <p>
          Optional products can be declined. All figures are estimates;
          financing remains subject to lender approval. Estimates use the
          selected APR, term and down payment, including estimated interest for
          first-payment days beyond 30. Product descriptions are summaries;
          review the actual provider contracts. Taxes and fees shown use the
          figures entered in Desking.
        </p>
      </footer>
    </div>
  );
}
