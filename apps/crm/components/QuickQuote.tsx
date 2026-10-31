"use client";
import { useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import type {
  Command,
  PrintableQuote,
  QuickQuoteInput,
  Workspace,
} from "../lib/model";
import { canDesk } from "../lib/permissions";
import { printableQuickQuote } from "../lib/quick-quote";
import { Desking } from "./Desking";
import { CustomerForm } from "./CustomerForm";
import { Modal } from "./ui";

export function QuickQuote({
  ws,
  busy,
  error,
  onClose,
  onPrint,
  onCreate,
  onComplete,
  demo,
  onClearError,
}: {
  ws: Workspace;
  busy: boolean;
  error: string;
  demo: boolean;
  onComplete: (id: string) => void;
  onClose: () => void;
  onClearError: () => void;
  onPrint: (quote: PrintableQuote) => void;
  onCreate: (
    command: Extract<
      Command,
      { type: "convert_quick_quote" | "convert_quick_quote_existing" }
    >,
  ) => Promise<{ ok: boolean; id?: string }>;
}) {
  const [conversion, setConversion] = useState<QuickQuoteInput | null>(null);
  const [id, setId] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  return (
    <section className="panel quick-quote-panel">
      <div className="quick-quote-toolbar">
        <button className="text-btn" onClick={onClose} disabled={busy}>
          <ArrowLeft size={16} />
          Back to saved proposals
        </button>
        <button
          className="btn small"
          disabled={busy}
          onClick={() => {
            setRevision(revision + 1);
            setId(crypto.randomUUID());
            onClearError();
          }}
        >
          <RotateCcw size={14} />
          Start over
        </button>
      </div>
      <Desking
        key={revision}
        inventory={ws.inventory}
        pricing={ws.product_pricing?.[0]}
        canViewProfit={canDesk(ws.member.role)}
        busy={busy}
        quick={{
          onPrint: (q) => onPrint(printableQuickQuote(q, ws.inventory)),
          onCreate: (q) => {
            onClearError();
            setConversion(q);
          },
        }}
      />
      {conversion && (
        <Modal
          title="Create customer & save quote"
          subtitle="Keep these figures on a new customer profile. Contact details are optional."
          wide
          onClose={() => {
            if (!busy) {
              setConversion(null);
              onClearError();
            }
          }}
        >
          <CustomerForm
            demo={demo}
            onComplete={onComplete}
            existing={null}
            purpose="quick_quote"
            onUseExisting={(customerId, source) =>
              onCreate({
                type: "convert_quick_quote_existing",
                id,
                customer_id: customerId,
                source,
                quote: conversion,
              })
            }
            ws={ws}
            busy={busy}
            error={error}
            submit={async (customer) => {
              return await onCreate({
                type: "convert_quick_quote",
                id,
                customer,
                quote: conversion,
              });
            }}
          />
        </Modal>
      )}
    </section>
  );
}
