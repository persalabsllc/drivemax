import CRM from "../../components/CRM";
import { demoWorkspace } from "../../lib/demo";
export const dynamic = "force-dynamic";
export default async function Demo({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  const ws = demoWorkspace();
  if (role === "finance" || role === "sales" || role === "manager") {
    ws.member.role = role;
    const staff = ws.staff.find((s) => s.user_id === ws.member.id);
    if (staff) staff.role = role;
  }
  return <CRM initial={ws} demo />;
}
