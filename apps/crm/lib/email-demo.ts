import type { Workspace, Command } from "./model";
export function demoEmailCommand(
  ws: Workspace,
  command: Command,
): Workspace | null {
  if (
    ![
      "save_email_template",
      "delete_email_template",
      "save_email_signature",
      "save_email_settings",
      "set_email_opt_out",
    ].includes(command.type)
  )
    return null;
  const s = structuredClone(ws),
    manager = ["owner", "manager"].includes(s.member.role);
  if (
    [
      "save_email_template",
      "delete_email_template",
      "save_email_settings",
    ].includes(command.type) &&
    !manager
  )
    throw Error("Manager access required");
  if (command.type === "save_email_template") {
    const old = s.email_templates?.find((t) => t.id === command.id);
    if ((old?.revision ?? 0) !== command.revision)
      throw Error("Email settings changed. Refresh before saving.");
    s.email_templates = [
      ...(s.email_templates ?? []).filter((t) => t.id !== command.id),
      {
        ...old,
        ...command.template,
        id: command.id,
        org_id: s.org.id,
        revision: old ? old.revision + 1 : 0,
      },
    ];
  } else if (command.type === "delete_email_template") {
    if (
      s.email_settings?.auto_reply_enabled &&
      s.email_settings.auto_reply_template_id === command.id
    )
      throw Error(
        "Choose another automatic reply template or turn off the workflow before deleting this template.",
      );
    s.email_templates = s.email_templates?.filter((t) => t.id !== command.id);
    if (s.email_settings?.auto_reply_template_id === command.id) {
      s.email_settings.auto_reply_template_id = null;
      s.email_settings.revision++;
    }
  } else if (command.type === "save_email_signature") {
    s.email_signature = {
      org_id: s.org.id,
      user_id: s.member.id,
      body: command.body,
      revision: (s.email_signature?.revision ?? -1) + 1,
    };
  } else if (command.type === "save_email_settings") {
    if (command.enabled && !command.template_id)
      throw Error("Choose an automatic reply template.");
    s.email_settings = {
      org_id: s.org.id,
      auto_reply_enabled: command.enabled,
      auto_reply_template_id: command.template_id,
      auto_reply_signature: command.signature,
      enabled_from: new Date().toISOString(),
      revision: (s.email_settings?.revision ?? 0) + 1,
    };
  } else if (command.type === "set_email_opt_out") {
    const c = s.customers.find((c) => c.id === command.customer_id);
    if (c) c.email_opt_out = command.opted_out;
  }
  return s;
}
