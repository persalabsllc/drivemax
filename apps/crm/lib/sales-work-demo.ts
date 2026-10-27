import { appointmentEmailTemplates, type WorkflowEvent } from "./workflows";
import { emptyProgress } from "./sales-work";
export function seedSalesWorkspace(input: Workspace): Workspace {
  const s = structuredClone(input),
    stamp = new Date().toISOString();
  s.email_templates = [
    ...(s.email_templates ?? []),
    ...appointmentEmailTemplates
      .filter((t) => !s.email_templates?.some((e) => e.system_key === t.key))
      .map((t) => ({
        id: crypto.randomUUID(),
        org_id: s.org.id,
        name: t.name,
        subject: t.subject,
        body: t.body,
        category: "Other",
        system_key: t.key,
        revision: 0,
      })),
  ];
  const definitions: [
    string,
    WorkflowEvent,
    string,
    number,
    boolean,
    boolean,
  ][] = [
    ...Array.from(
      { length: 6 },
      (_, i) =>
        [
          `New lead · day ${i + 1}`,
          "new_lead",
          `day-${i + 1}`,
          1440 * (i + 1),
          true,
          true,
        ] as [string, WorkflowEvent, string, number, boolean, boolean],
    ),
    ["Unsold visit · next day", "unsold_visit", "day-1", 1440, true, true],
    ["Sold · thank you", "sold", "sold", 0, true, false],
    ["Sold · 7-day check-in", "sold", "sold-7", 10080, true, true],
    ["Sold · six months", "sold", "anniversary-6", 262800, true, true],
    ["Birthday wishes", "birthday", "birthday", 600, true, false],
    [
      "Purchase anniversary",
      "anniversary",
      "purchase-anniversary",
      600,
      true,
      false,
    ],
    [
      "Appointment confirmation",
      "appointment_created",
      "appt-created",
      0,
      false,
      false,
    ],
    [
      "Appointment rescheduled",
      "appointment_rescheduled",
      "appt-rescheduled",
      0,
      false,
      false,
    ],
    [
      "Appointment canceled",
      "appointment_canceled",
      "appt-canceled",
      0,
      false,
      false,
    ],
    ["Missed appointment", "no_show", "appt-missed", 0, true, false],
    [
      "Appointment · day-before reminder",
      "reminder_day",
      "appt-reminder",
      1440,
      true,
      false,
    ],
    [
      "Appointment · two-hour reminder",
      "reminder_hour",
      "appt-reminder",
      120,
      false,
      false,
    ],
  ];
  s.workflow_rules ??= definitions.flatMap(
    ([name, event, key, delay_minutes, business_hours, stop_on_reply]) => {
      const template = s.email_templates?.find((t) => t.system_key === key);
      return template
        ? [
            {
              id: crypto.randomUUID(),
              org_id: s.org.id,
              name,
              event,
              channel: "email" as const,
              template_id: template.id,
              task_title: "",
              delay_minutes,
              enabled: true,
              business_hours,
              stop_on_reply,
              revision: 0,
              enabled_from: stamp,
            },
          ]
        : [];
    },
  );
  s.workflow_jobs ??= [];
  s.workflow_pauses ??= [];
  s.sales_events ??= [];
  s.deal_files ??= [];
  s.deal_progress ??= s.opportunities.map((o) => ({
    ...emptyProgress,
    id: o.id,
    org_id: s.org.id,
    revision: 0,
    updated_at: stamp,
    stage:
      o.status === "new"
        ? ("new" as const)
        : o.status === "appointment"
          ? ("appointment" as const)
          : ("contacted" as const),
  }));
  s.buyer_preferences ??= [];
  s.inventory_prep ??= [];
  return s;
}
import type { Workspace, Command } from "./model";
export function demoSalesWork(ws: Workspace, p: Command): Workspace | null {
  const s = structuredClone(ws),
    stamp = new Date().toISOString();
  if (p.type === "save_workflow_rule") {
    const rows = (s.workflow_rules ??= []),
      old = rows.find((r) => r.id === p.id);
    s.workflow_rules = [
      ...rows.filter((r) => r.id !== p.id),
      {
        ...p.rule,
        id: p.id,
        org_id: s.org.id,
        revision: old ? old.revision + 1 : 0,
        enabled_from: stamp,
      },
    ];
  } else if (p.type === "delete_workflow_rule") {
    s.workflow_rules = (s.workflow_rules ?? []).map((r) =>
      r.id === p.id ? { ...r, enabled: false, revision: r.revision + 1 } : r,
    );
  } else if (p.type === "pause_customer_workflows") {
    s.workflow_pauses = [
      ...(s.workflow_pauses ?? []).filter(
        (r) => r.customer_id !== p.customer_id,
      ),
      { org_id: s.org.id, customer_id: p.customer_id, paused: p.paused },
    ];
  } else if (p.type === "cancel_workflow_job") {
    s.workflow_jobs = (s.workflow_jobs ?? []).map((j) =>
      j.id === p.id
        ? { ...j, state: "canceled", reason: "Canceled by staff" }
        : j,
    );
  } else if (p.type === "save_deal_progress") {
    const old = s.deal_progress?.find((r) => r.id === p.id);
    s.deal_progress = [
      ...(s.deal_progress ?? []).filter((r) => r.id !== p.id),
      {
        ...p.progress,
        id: p.id,
        org_id: s.org.id,
        revision: old ? old.revision + 1 : 0,
        updated_at: stamp,
      },
    ];
    const o = s.opportunities.find((o) => o.id === p.id);
    if (o && old?.stage !== p.progress.stage)
      s.sales_events = [
        ...(s.sales_events ?? []),
        {
          id: crypto.randomUUID(),
          org_id: s.org.id,
          opportunity_id: o.id,
          customer_id: o.customer_id,
          event: p.progress.stage,
          created_at: stamp,
        },
      ];
  } else if (p.type === "save_buyer_preferences") {
    const old = s.buyer_preferences?.find((r) => r.id === p.id);
    s.buyer_preferences = [
      ...(s.buyer_preferences ?? []).filter((r) => r.id !== p.id),
      {
        ...p.preferences,
        id: p.id,
        org_id: s.org.id,
        revision: old ? old.revision + 1 : 0,
      },
    ];
  } else if (p.type === "save_inventory_prep") {
    const old = s.inventory_prep?.find((r) => r.id === p.id);
    s.inventory_prep = [
      ...(s.inventory_prep ?? []).filter((r) => r.id !== p.id),
      {
        ...p.prep,
        id: p.id,
        org_id: s.org.id,
        revision: old ? old.revision + 1 : 0,
        updated_at: stamp,
      },
    ];
    if (p.sync_recon)
      s.inventory = s.inventory.map((v) =>
        v.id === p.id
          ? { ...v, recon: p.prep.items.reduce((sum, i) => sum + i.amount, 0) }
          : v,
      );
  } else return null;
  return s;
}
