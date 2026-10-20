import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_NOTICE_TEXT,
  CONTACT_NOTICE_VERSION,
  LEGACY_CONTACT_NOTICE_VERSION,
  SMS_CONSENT_LABELS,
  smsConsentSummary,
  captureContactNotice,
} from "../lib/contact-notice";
import { leadSchema } from "../lib/inventory";

const request = {
  requestId: "cb18fd42-1024-49cd-b4f7-0be306958315",
  kind: "contact",
  name: "TEST Contact",
  email: "test@example.com",
  phone: "252-555-0100",
  preferredContact: "Email",
  message: "Test inquiry",
};
const now = "2026-10-20T15:00:00.000Z";

test("the server records the current inquiry notice and its submission time", () => {
  const parsed = leadSchema.parse({
    ...request,
    contactNoticeVersion: CONTACT_NOTICE_VERSION,
    contactNoticeText: "FORGED blanket marketing consent",
    contactNoticeSubmittedAt: "FORGED timestamp",
  });
  assert.equal("contactNoticeText" in parsed, false);
  const captured = captureContactNotice(parsed, now);
  assert.equal(captured.contactNoticeVersion, CONTACT_NOTICE_VERSION);
  assert.equal(captured.contactNoticeText, CONTACT_NOTICE_TEXT);
  assert.equal(captured.contactNoticeSubmittedAt, now);
  assert.match(
    CONTACT_NOTICE_TEXT,
    /does not enroll you in recurring automated marketing/,
  );
  assert.match(CONTACT_NOTICE_TEXT, /reply STOP/);
  assert.equal(captured.phone, request.phone);
  assert.equal(captured.smsConsent, "not_provided");
});

test("legacy inquiries are accepted without inventing notice consent", () => {
  const legacy = leadSchema.parse(request);
  assert.equal(
    captureContactNotice(legacy, now).contactNoticeVersion,
    undefined,
  );
  const forgedLegacy = captureContactNotice(
    { ...legacy, contactNoticeText: "FAKE", contactNoticeSubmittedAt: now },
    now,
  );
  assert.equal(forgedLegacy.contactNoticeText, undefined);
  assert.equal(forgedLegacy.contactNoticeSubmittedAt, undefined);
  assert.equal(
    leadSchema.safeParse({ ...request, contactNoticeVersion: "unrecognized" })
      .success,
    false,
  );
  assert.equal("contactNoticeVersion" in legacy, false);
});

test("Yes, No, and unchecked choices are captured without inventing consent", () => {
  for (const choice of ["yes", "no", undefined]) {
    const parsed = leadSchema.parse({
      ...request,
      contactNoticeVersion: CONTACT_NOTICE_VERSION,
      smsConsent: choice,
      smsConsentText: "FORGED consent",
      contactNoticeSubmittedAt: "FORGED time",
    });
    const captured = captureContactNotice(parsed, now);
    assert.equal(captured.smsConsent, choice || "not_provided");
    assert.equal(
      captured.smsConsentText,
      choice
        ? SMS_CONSENT_LABELS[choice as "yes" | "no"]
        : "No SMS consent was provided.",
    );
    assert.equal(captured.contactNoticeSubmittedAt, now);
    assert.equal(captured.contactNoticeText, CONTACT_NOTICE_TEXT);
  }
});

test("declining texts or leaving consent blank still permits phone and email inquiries", () => {
  for (const smsConsent of ["no", undefined])
    for (const preferredContact of ["Phone call", "Email"])
      assert.equal(
        leadSchema.safeParse({
          ...request,
          email: preferredContact === "Email" ? request.email : "",
          preferredContact,
          contactNoticeVersion: CONTACT_NOTICE_VERSION,
          smsConsent,
        }).success,
        true,
      );
});

test("a text reply requires an explicit Yes to the current disclosure", () => {
  for (const smsConsent of ["no", undefined]) {
    const parsed = leadSchema.safeParse({
      ...request,
      preferredContact: "Text message",
      contactNoticeVersion: CONTACT_NOTICE_VERSION,
      smsConsent,
    });
    assert.equal(parsed.success, false);
    if (!parsed.success)
      assert.equal(parsed.error.issues[0].path[0], "smsConsent");
  }
  assert.equal(
    leadSchema.safeParse({
      ...request,
      preferredContact: "Text message",
      contactNoticeVersion: CONTACT_NOTICE_VERSION,
      smsConsent: "yes",
    }).success,
    true,
  );
  for (const version of [undefined, LEGACY_CONTACT_NOTICE_VERSION]) {
    assert.equal(
      leadSchema.safeParse({
        ...request,
        smsConsent: "yes",
        contactNoticeVersion: version,
      }).success,
      false,
    );
    assert.equal(
      captureContactNotice(
        {
          ...request,
          smsConsent: "yes",
          contactNoticeVersion: version,
        },
        now,
      ).smsConsent,
      "not_provided",
    );
  }
});

test("ambiguous consent values are rejected and staff summaries make No clear", () => {
  for (const smsConsent of [true, false, "true", "yes,no", ["yes", "no"]])
    assert.equal(
      leadSchema.safeParse({
        ...request,
        contactNoticeVersion: CONTACT_NOTICE_VERSION,
        smsConsent,
      }).success,
      false,
    );
  assert.match(smsConsentSummary("yes"), /customer care texts only/);
  for (const choice of ["no", undefined, "not_provided"])
    assert.match(smsConsentSummary(choice), /do not send text messages/);
});
