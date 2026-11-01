import "server-only";
import { cookies, headers } from "next/headers";
import { db } from "./backend";
import { CHAT_ORG, readChatCredential } from "./website-chat-server";
import {
  ACTIVITY_CHOICE,
  ACTIVITY_COOKIE,
  activityChoice,
} from "./website-activity";
// A failed analytics link must never prevent a lead or appointment being saved.
export async function linkWebsiteActivity(
  kind: "form" | "chat",
  sourceId: string,
) {
  try {
    const jar = await cookies();
    if (
      activityChoice(jar.get(ACTIVITY_CHOICE)?.value, await headers()) !==
      "allow"
    )
      return;
    const credential = readChatCredential(jar.get(ACTIVITY_COOKIE)?.value);
    if (!credential) return;
    const { error } = await db().rpc("dmcrm_web_link", {
      p_org: CHAT_ORG,
      p_visitor: credential.id,
      p_token: credential.hash,
      p_kind: kind,
      p_source: sourceId,
    });
    if (error)
      console.warn("Website activity attribution unavailable", error.code);
  } catch {
    console.warn("Website activity attribution unavailable");
  }
}
