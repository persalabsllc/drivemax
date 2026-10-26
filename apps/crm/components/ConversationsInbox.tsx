"use client";
import { Mail, MessageSquare } from "lucide-react";
import type { Customer, Workspace } from "../lib/model";
export function ConversationsInbox({
  ws,
  query,
  onOpen,
}: {
  ws: Workspace;
  query: string;
  onOpen: (c: Customer, channel: "sms" | "email") => void;
}) {
  const rows = ws.customers
    .filter((c) =>
      [c.name, c.email, c.phone]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .map((c) => {
      const messages = (ws.messages ?? [])
        .filter((m) => m.customer_id === c.id && m.status !== "canceled")
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const logs = ws.activities
        .filter(
          (a) =>
            a.customer_id === c.id && ["email", "sms", "call"].includes(a.kind),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return {
        c,
        drafts: messages.filter((m) => m.status === "draft").length,
        last: [
          ...messages.map((m) => ({
            at: m.created_at,
            text: m.body,
            label: m.channel + " · " + m.status,
          })),
          ...logs.map((a) => ({
            at: a.created_at,
            text: a.body,
            label: a.kind + " · manually logged",
          })),
        ].sort((a, b) => b.at.localeCompare(a.at))[0],
      };
    })
    .sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? ""));
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>Customer conversations</h2>
          <p>
            Text and email threads stay with the customer across every
            opportunity.
          </p>
        </div>
      </div>
      <div className="ops-connection">
        Email and SMS providers are not connected. Prepare drafts now; sending
        and automatic receipt remain disabled.
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Latest communication</th>
              <th>Drafts</th>
              <th>Open thread</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, last, drafts }) => (
              <tr key={c.id}>
                <td>
                  <button
                    className="name-button"
                    onClick={() => onOpen(c, "sms")}
                  >
                    {c.name}
                  </button>
                  <small className="subtext">
                    {c.phone} · {c.email}
                  </small>
                </td>
                <td>
                  {last ? (
                    <>
                      <span>
                        {last.text.slice(0, 120)}
                        {last.text.length > 120 ? "…" : ""}
                      </span>
                      <small className="subtext">
                        {last.label} ·{" "}
                        {new Date(last.at).toLocaleString("en-US", {
                          timeZone: "America/New_York",
                        })}
                      </small>
                    </>
                  ) : (
                    <span className="ops-help">No communication recorded</span>
                  )}
                </td>
                <td>{drafts || "—"}</td>
                <td>
                  <div className="ops-actions">
                    <button
                      className="btn small"
                      onClick={() => onOpen(c, "sms")}
                    >
                      <MessageSquare size={14} />
                      Texts
                    </button>
                    <button
                      className="btn small"
                      onClick={() => onOpen(c, "email")}
                    >
                      <Mail size={14} />
                      Emails
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4}>No matching customers.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
