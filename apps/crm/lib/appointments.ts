import { z } from "zod";
import type { Workspace } from "./model";

export const APPOINTMENT_TZ = "America/New_York";
export const appointmentKinds = {
  test_drive: "Test drive",
  return_visit: "Return visit",
  vehicle_viewing: "Vehicle viewing",
  sold_delivery: "Sold delivery",
  service: "Service",
  trade_appraisal: "Trade appraisal",
  paperwork: "Financing / paperwork",
  other: "Other",
} as const;
export const appointmentStatuses = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  arrived: "Arrived",
  completed: "Completed",
  no_show: "No-show",
  canceled: "Canceled",
} as const;
export type AppointmentKind = keyof typeof appointmentKinds;
export type AppointmentStatus = keyof typeof appointmentStatuses;
export const appointmentDetailsSchema = z.object({
  kind: z.enum(
    Object.keys(appointmentKinds) as [AppointmentKind, ...AppointmentKind[]],
  ),
  starts_at: z.iso
    .datetime({ offset: true })
    .refine(
      (v) =>
        Number.isFinite(Date.parse(v)) &&
        v.slice(0, 4) >= "2000" &&
        v.slice(0, 4) <= "2100",
      "Enter a valid appointment date and time",
    ),
  duration_minutes: z.number().int().min(15).max(240).multipleOf(15),
  assigned_to: z.uuid("Select an active salesperson"),
  description: z.string().trim().max(1000),
});
export const newCustomerAppointmentSchema = appointmentDetailsSchema.extend({
  id: z.uuid(),
});
export type NewCustomerAppointment = z.infer<
  typeof newCustomerAppointmentSchema
>;
export const appointmentSchema = appointmentDetailsSchema.extend({
  customer_id: z.uuid(),
  opportunity_id: z.uuid().nullable(),
});
export type AppointmentInput = z.infer<typeof appointmentSchema>;
export type Appointment = AppointmentInput & {
  id: string;
  org_id: string;
  status: AppointmentStatus;
  revision: number;
  created_at: string;
  updated_at: string;
  created_by: string;
};
export const appointmentCommands = [
  z.object({
    type: z.literal("save_appointment"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    appointment: appointmentSchema,
  }),
  z.object({
    type: z.literal("set_appointment_status"),
    id: z.uuid(),
    revision: z.number().int().min(0),
    status: z.enum(
      Object.keys(appointmentStatuses) as [
        AppointmentStatus,
        ...AppointmentStatus[],
      ],
    ),
  }),
] as const;

export const isOpenAppointment = (a: Pick<Appointment, "status">) =>
  ["scheduled", "confirmed", "arrived"].includes(a.status);
export const canEditAppointment = (ws: Workspace, a: Appointment) =>
  ["owner", "manager"].includes(ws.member.role) ||
  a.assigned_to ===
    (ws.member.staff_id ??
      ws.staff.find((s) => s.user_id === ws.member.id)?.id);
export const appointmentTransitions: Record<
  AppointmentStatus,
  AppointmentStatus[]
> = {
  scheduled: ["confirmed", "arrived", "completed", "no_show", "canceled"],
  confirmed: ["arrived", "completed", "no_show", "canceled"],
  arrived: ["completed", "canceled"],
  completed: [],
  no_show: [],
  canceled: [],
};

// Form values always mean dealership time, even when the user's device is elsewhere.
const localFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APPOINTMENT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function appointmentLocalParts(stamp: string | Date) {
  const parts = localFormatter.formatToParts(new Date(stamp));
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
export function appointmentInstant(date: string, time: string) {
  const local = `${date}T${time}`;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ||
    !Number.isFinite(Date.parse(local + ":00Z")) ||
    new Date(local + ":00Z").toISOString().slice(0, 16) !== local
  )
    throw Error("Enter a valid appointment date and time");
  // Eastern Time uses UTC−4 / UTC−5. Round-trip both to reject skipped or
  // ambiguous clock-change times instead of silently shifting an appointment.
  const matches = [4, 5]
    .map((hours) => new Date(Date.parse(local + ":00Z") + hours * 3600000))
    .filter((instant) => {
      const parts = appointmentLocalParts(instant);
      return parts.date === date && parts.time === time;
    });
  if (matches.length !== 1)
    throw Error(
      "That time falls in a daylight-saving clock change. Choose another time.",
    );
  return matches[0].toISOString();
}
export const appointmentTime = (stamp: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: APPOINTMENT_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(stamp));
export const appointmentDateTime = (stamp: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: APPOINTMENT_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(stamp));
export const appointmentEnd = (
  a: Pick<AppointmentInput, "starts_at" | "duration_minutes">,
) =>
  new Date(Date.parse(a.starts_at) + a.duration_minutes * 60000).toISOString();
export function appointmentsForRange(
  appointments: Appointment[],
  from: string,
  through: string,
  assignedTo = "all",
) {
  return appointments
    .filter((a) => {
      const date = appointmentLocalParts(a.starts_at).date;
      return (
        isOpenAppointment(a) &&
        date >= from &&
        date <= through &&
        (assignedTo === "all" || a.assigned_to === assignedTo)
      );
    })
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
}
export function overlappingAppointments(
  appointments: Appointment[],
  input: Pick<
    AppointmentInput,
    "starts_at" | "duration_minutes" | "assigned_to"
  >,
  id: string,
) {
  return appointments.filter(
    (a) =>
      a.id !== id &&
      isOpenAppointment(a) &&
      a.assigned_to === input.assigned_to &&
      Date.parse(a.starts_at) < Date.parse(appointmentEnd(input)) &&
      Date.parse(appointmentEnd(a)) > Date.parse(input.starts_at),
  );
}
