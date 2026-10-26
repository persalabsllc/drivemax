import "server-only";
// Provider adapters are deliberately absent until a sending identity, consent handling,
// inbound signature verification and delivery webhooks are configured and tested.
// A persisted message UUID is the idempotency key; drafts never auto-send on connection.
export type Channel = "email" | "sms";
export interface MessageProvider {
  send(input: {
    idempotencyKey: string;
    to: string;
    subject: string;
    body: string;
    quotePdf?: Uint8Array;
  }): Promise<{ providerId: string }>;
  verifyInbound(
    rawBody: string,
    headers: Headers,
  ): Promise<{
    providerId: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    receivedAt: string;
  }>;
}
export function providerFor(_channel: Channel): MessageProvider | null {
  return null;
}
export const connectionStatus = () => ({
  email: { connected: false },
  sms: { connected: false },
});
