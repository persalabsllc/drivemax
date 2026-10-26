import type { Command, Workspace } from "./model";
import {
  appointmentDateTime,
  appointmentKinds,
  appointmentTransitions,
  canEditAppointment,
  isOpenAppointment,
  type Appointment,
} from "./appointments";

export function demoAppointments(
  input: Workspace,
  p: Command,
  now: Date,
  base: (ws: Workspace, command: Command, time: Date) => Workspace,
): Workspace {
  let s = structuredClone(input);
  s.appointments ??= [];
  const stamp = now.toISOString(),
    manager = ["owner", "manager"].includes(s.member.role),
    me =
      s.member.staff_id ?? s.staff.find((m) => m.user_id === s.member.id)?.id;
  function activity(a: Appointment, event: string, before?: Appointment) {
    s.activities.unshift({
      id: crypto.randomUUID(),
      org_id: s.org.id,
      customer_id: a.customer_id,
      opportunity_id: a.opportunity_id,
      kind: "system",
      created_at: stamp,
      created_by: s.member.name,
      body:
        `Appointment ${event} · ${appointmentKinds[a.kind]} · ${appointmentDateTime(a.starts_at)} · ${a.duration_minutes} min · ${s.staff.find((x) => x.id === a.assigned_to)?.name}` +
        (before && before.starts_at !== a.starts_at
          ? `. Previously ${appointmentDateTime(before.starts_at)}`
          : "") +
        (before && before.assigned_to !== a.assigned_to
          ? `. Previously assigned to ${s.staff.find((x) => x.id === before.assigned_to)?.name}`
          : "") +
        (a.description ? `. ${a.description}` : ""),
    });
  }
  if (p.type === "save_appointment" || p.type === "set_appointment_status") {
    let a = s.appointments.find((a) => a.id === p.id);
    const before = a ? structuredClone(a) : undefined;
    if (a) {
      if (!canEditAppointment(s, a))
        throw Error("You can only change your own appointments");
      if (a.revision !== p.revision)
        throw Error(
          "Appointment changed in another session. Reload before saving.",
        );
      if (!isOpenAppointment(a))
        throw Error(
          "This appointment is closed. Schedule another visit instead.",
        );
    } else if (p.type === "set_appointment_status" || p.revision !== 0)
      throw Error("Appointment unavailable");
    let event: string;
    if (p.type === "save_appointment") {
      const data = p.appointment;
      if (
        !s.customers.some((c) => c.id === data.customer_id) ||
        (a && a.customer_id !== data.customer_id)
      )
        throw Error("Customer unavailable");
      if (
        data.opportunity_id &&
        !s.opportunities.some(
          (o) =>
            o.id === data.opportunity_id && o.customer_id === data.customer_id,
        )
      )
        throw Error("Opportunity unavailable");
      if (!s.staff.some((m) => m.id === data.assigned_to && m.active))
        throw Error("Select an active team member");
      if (!manager && data.assigned_to !== me)
        throw Error("Only managers can assign appointments to another user");
      const rescheduled =
        a &&
        (Date.parse(a.starts_at) !== Date.parse(data.starts_at) ||
          a.duration_minutes !== data.duration_minutes);
      if (a?.status === "arrived" && rescheduled)
        throw Error(
          "An arrived appointment cannot be rescheduled. Schedule another visit instead.",
        );
      if (a) {
        if (
          Object.entries(data).every(
            ([key, value]) => a![key as keyof Appointment] === value,
          )
        )
          return s;
        event = rescheduled ? "rescheduled" : "updated";
        Object.assign(a, data, {
          updated_at: stamp,
          revision: a.revision + 1,
          status: rescheduled ? "scheduled" : a.status,
        });
      } else {
        event = "scheduled";
        a = {
          ...data,
          id: p.id,
          org_id: s.org.id,
          status: "scheduled",
          revision: 0,
          created_at: stamp,
          updated_at: stamp,
          created_by: s.member.id,
        };
        s.appointments.push(a);
      }
    } else {
      if (a!.status === p.status) return s;
      if (!appointmentTransitions[a!.status].includes(p.status))
        throw Error("Invalid appointment status change");
      Object.assign(a!, {
        status: p.status,
        revision: a!.revision + 1,
        updated_at: stamp,
      });
      event = p.status.replaceAll("_", "-");
      if (p.status === "arrived") {
        const opportunity = s.opportunities.find(
          (o) => o.id === a!.opportunity_id,
        );
        s = base(
          s,
          {
            type: "check_in",
            customer_id: a!.customer_id,
            opportunity_id:
              opportunity?.status === "lost" ? null : a!.opportunity_id,
          },
          now,
        );
      }
    }
    activity(a!, event, before);
    return s;
  }
  s = base(s, p, now);
  s.appointments ??= [];
  if (p.type === "create_customer" && p.appointment) {
    const c = s.customers[0],
      o = s.opportunities.find((o) => o.customer_id === c.id);
    s = demoAppointments(
      s,
      {
        type: "save_appointment",
        id: p.appointment.id,
        revision: 0,
        appointment: {
          ...p.appointment,
          customer_id: c.id,
          opportunity_id: o?.id ?? null,
        },
      },
      now,
      base,
    );
  } else if (p.type === "set_staff_active" && !p.active) {
    for (const a of s.appointments.filter(
      (a) => a.assigned_to === p.id && isOpenAppointment(a),
    )) {
      const before = structuredClone(a);
      Object.assign(a, {
        assigned_to: p.reassign_to,
        revision: a.revision + 1,
        updated_at: stamp,
      });
      activity(a, "reassigned", before);
    }
  }
  return s;
}
