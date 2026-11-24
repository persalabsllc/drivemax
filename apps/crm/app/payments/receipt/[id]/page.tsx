import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { checkBrand, checkMoney } from "../../../../lib/company-checks";
import { getScopedPayment } from "../../../../lib/payment-ledger";
import { session } from "../../../../lib/server";
import ReceiptActions from "./ReceiptActions";
import styles from "./receipt.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payment receipt | Drive Max Used Cars" };

const paidDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "long", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

const cardBrands: Record<string, string> = {
  amex: "American Express", cartes_bancaires: "Cartes Bancaires",
  diners: "Diners Club", discover: "Discover", jcb: "JCB",
  mastercard: "Mastercard", unionpay: "UnionPay", visa: "Visa",
};

export default async function PaymentReceipt({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string | string[] }>;
}) {
  const staff = await session();
  if (!staff) redirect("/login");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const payment = await getScopedPayment(staff, id);
  if (!payment || payment.status !== "paid" || !payment.paid_at || payment.livemode == null) notFound();

  const test = !payment.livemode;
  const card = cardBrands[payment.card_brand ?? ""] ?? "Card";
  const { print } = await searchParams;
  return (
    <main className={styles.view}>
      <ReceiptActions autoPrint={print === "1"} />
      <article className={styles.sheet} aria-labelledby="receipt-heading">
        <header className={styles.masthead}>
          <img id="receipt-logo" src="/print-materials/drive-max-logo.png" alt="Drive Max Used Cars" width="184" height="92" />
          <address className={styles.dealer}>
            <strong>{checkBrand.company}</strong>
            <span>{checkBrand.address}</span>
            <span>{checkBrand.city}</span>
            <span>{checkBrand.phone}</span>
          </address>
        </header>
        <h1 id="receipt-heading" className={styles.heading}>Payment receipt</h1>
        {test && <p className={styles.test}>TEST PAYMENT · No funds collected</p>}
        <div className={styles.total}>
          <span>{test ? "Test amount" : "Amount paid"}</span>
          <strong>{checkMoney(payment.amount_cents)}</strong>
        </div>
        <dl className={styles.details}>
          <div><dt>Received from</dt><dd>{payment.payer_name}</dd></div>
          <div><dt>Payment date</dt><dd><time dateTime={payment.paid_at}>{paidDate.format(new Date(payment.paid_at))}</time></dd></div>
          <div><dt>Payment for</dt><dd>{payment.purpose}</dd></div>
          <div><dt>Payment method</dt><dd>{card}{payment.card_last4 && ` ending in ${payment.card_last4}`}</dd></div>
          <div><dt>{payment.inventory_id ? "Stock number" : "Stock number / reference"}</dt><dd>{payment.stock_number}</dd></div>
          {payment.vehicle_name && <div><dt>{payment.inventory_id ? "Vehicle" : "Vehicle / item"}</dt><dd>{payment.vehicle_name}</dd></div>}
          <div><dt>Received by</dt><dd>{payment.employee_name}</dd></div>
          <div><dt>Employee ID</dt><dd className={styles.identifier}>{payment.employee_id}</dd></div>
        </dl>
        <footer className={styles.reference}>
          <span>Receipt number</span>
          <strong>{payment.id.toUpperCase()}</strong>
        </footer>
      </article>
    </main>
  );
}
