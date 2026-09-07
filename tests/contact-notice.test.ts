import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_NOTICE_TEXT,
  CONTACT_NOTICE_VERSION,
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
const now = "2026-09-07T20:00:00.000Z";

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
