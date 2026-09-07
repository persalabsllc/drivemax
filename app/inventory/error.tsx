"use client";
export default function InventoryError({ reset }: { reset: () => void }) {
  return (
    <section className="page-section">
      <div className="container inventory-empty">
        <h1>Inventory is temporarily unavailable.</h1>
        <p>
          Please try again or email sales@drivemaxusedcars.com for availability.
        </p>
        <button onClick={reset} className="button button-primary">
          Try again
        </button>
      </div>
    </section>
  );
}
