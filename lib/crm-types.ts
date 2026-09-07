export type Staff = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
};
export type Lead = {
  id: string;
  vehicle_id: string | null;
  name: string;
  email: string;
  phone: string;
  preferred_contact: string;
  kind: string;
  status: "new" | "contacted" | "appointment" | "won" | "lost";
  assigned_to: string | null;
  follow_up_at: string | null;
  details: Record<string, string>;
  created_at: string;
  updated_at: string;
};
export type Message = {
  id: string;
  lead_id: string;
  direction: "inbound" | "outbound" | "note";
  body: string;
  state: string;
  created_at: string;
  staff_id: string | null;
};
