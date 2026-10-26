// Read-only release check. Never logs credentials, message content, or email addresses.
if (
  process.env.VERCEL_ENV === "production" &&
  process.env.CRM_EMAIL_WORKER_SECRET
) {
  async function get(path, stage) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://api.resend.com${path}`, {
        headers: {
          Authorization: `Bearer ${process.env.RESEND_RECEIVING_API_KEY}`,
        },
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) return response.json();
      if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1200 * (attempt + 1)),
        );
        continue;
      }
      throw Error(`EMAIL_${stage}_HTTP_${response.status}`);
    }
  }
  try {
    if (
      !process.env.RESEND_API_KEY ||
      !process.env.RESEND_RECEIVING_API_KEY ||
      !process.env.RESEND_WEBHOOK_SECRET
    )
      throw Error("EMAIL_CONFIG_MISSING");
    const domains = await get("/domains", "DOMAINS");
    if (
      !domains.data?.some(
        (d) => d.name === "drivemaxusedcars.com" && d.status === "verified",
      )
    )
      throw Error("EMAIL_DOMAIN_NOT_VERIFIED");
    const webhooks = await get("/webhooks", "WEBHOOKS");
    const hook = webhooks.data?.find(
      (h) =>
        h.endpoint === "https://www.drivemaxusedcars.com/api/email/webhook" &&
        h.status === "enabled",
    );
    if (
      !hook ||
      ![
        "email.received",
        "email.delivered",
        "email.bounced",
        "email.complained",
        "email.failed",
        "email.suppressed",
      ].every((e) => hook.events?.includes(e))
    )
      throw Error("EMAIL_WEBHOOK_NOT_READY");
    await get("/emails/receiving?limit=1", "RECEIVING");
    console.log(
      "Verified email provider access: verified dealership sender, enabled reply/delivery webhook, receiving API access.",
    );
  } catch (error) {
    console.error(
      /^[A-Z_0-9]+$/.test(error?.message || "")
        ? error.message
        : "EMAIL_PROVIDER_CHECK_FAILED",
    );
    process.exitCode = 1;
  }
}
