export function mailbox(value: string) {
  return (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
}
export function replyLeadId(recipients: string[], domain: string) {
  const ids = new Set(
    recipients.map(mailbox).flatMap((address) => {
      const [local, host] = address.split("@");
      const id = local?.match(
        /^lead\+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
      )?.[1];
      return host === domain.toLowerCase() && id ? [id] : [];
    }),
  );
  return ids.size === 1 ? [...ids][0] : null;
}
