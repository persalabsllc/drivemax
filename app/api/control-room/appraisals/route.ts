import { z } from "zod";
import { revalidatePath } from "next/cache";
import { staffSession, db } from "../../../../lib/backend";
import { takeSlot } from "../../../../lib/rate-limit";
import {
  appraisalSchema,
  appraisalNumbers,
  appraisalForStorage,
  subjectSchema,
} from "../../../../lib/appraisal";
import {
  configuredMarketKey,
  disconnectMarket,
  ensureAppraisalStorage,
  findAppraisal,
  listAppraisals,
  ownSaleComps,
  persistAppraisal,
  saveMarketConnection,
} from "../../../../lib/appraisal-store";
import {
  fetchMarketSnapshot,
  marketCheckJson,
  currentMarketUsage,
} from "../../../../lib/appraisal-market";

export const runtime = "nodejs";
export const maxDuration = 45;
const response = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const message = (e: unknown) =>
  e instanceof Error &&
  /^(This appraisal|Appraisal storage|Appraisal connection|Reconnect|MarketCheck|Your MarketCheck|The market|This connection)/.test(
    e.message,
  )
    ? e.message
    : "Appraisal service is temporarily unavailable. Your worksheet edits are still here.";
async function access() {
  try {
    return await staffSession();
  } catch {
    return null;
  }
}
export async function GET() {
  const staff = await access();
  if (!staff)
    return response(
      { error: "Sign in to the Control Room to use appraisals." },
      401,
    );
  try {
    await ensureAppraisalStorage();
    const [records, key, usage] = await Promise.all([
      listAppraisals(),
      configuredMarketKey(),
      currentMarketUsage(),
    ]);
    return response({
      records,
      connected: !!key,
      usage,
      isOwner: staff.role === "owner",
    });
  } catch (e) {
    console.error("Appraisal request failed", {
      code:
        typeof (e as { code?: unknown })?.code === "string"
          ? (e as { code: string }).code
          : "APPRAISAL_ERROR",
    });
    return response({ error: message(e) }, 503);
  }
}
export async function POST(request: Request) {
  const staff = await access();
  if (!staff)
    return response(
      { error: "Sign in to the Control Room to use appraisals." },
      401,
    );
  if (new URL(request.url).origin !== request.headers.get("origin"))
    return response(
      { error: "Reload the Control Room before trying again." },
      403,
    );
  if (Number(request.headers.get("content-length") || 0) > 250000)
    return response({ error: "This worksheet is too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > 250000)
      return response({ error: "This worksheet is too large." }, 413);
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
  } catch {
    return response({ error: "Check the appraisal request." }, 400);
  }
  try {
    if (!(await takeSlot(staff.id, "appraisal-actions", 180)))
      return response(
        { error: "Please wait before making more appraisal requests." },
        429,
      );
    await ensureAppraisalStorage();
    if (body.action === "save") {
      const parsed = appraisalSchema.safeParse(body.data);
      if (!parsed.success)
        return response(
          {
            error:
              parsed.error.issues[0]?.message || "Check the worksheet fields.",
          },
          400,
        );
      const id = body.id ? z.uuid().parse(body.id) : undefined;
      const updatedAt = id
        ? z.string().min(1).max(60).parse(body.updatedAt)
        : undefined;
      const record = await persistAppraisal(
        appraisalForStorage(parsed.data),
        staff.id,
        id,
        updatedAt,
      );
      revalidatePath("/control-room");
      return response({
        record,
        message: parsed.data.market
          ? "Appraisal and reviewed price saved. Live provider listings are not stored; refresh them when you revisit this vehicle."
          : "Appraisal saved. No data subscription needed.",
      });
    }
    if (body.action === "market") {
      const subject = subjectSchema.parse(body.subject);
      if (!(await takeSlot(staff.id, "appraisal-market", 30)))
        return response(
          {
            error:
              "Hourly market lookup limit reached. Saved worksheets and manual comps are still available.",
          },
          429,
        );
      const key = await configuredMarketKey();
      const ownSales = await ownSaleComps(subject);
      if (!key)
        return response({
          market: null,
          ownSales,
          connected: false,
          message:
            "No API account needed: add at least three comparable asking prices below for a retail target and buy figure. An optional MarketCheck free-plan connection can retrieve listings.",
        });
      const market = await fetchMarketSnapshot(subject, key);
      return response({
        market,
        ownSales,
        connected: true,
        usage: await currentMarketUsage(),
      });
    }
    if (body.action === "sales") {
      return response({
        ownSales: await ownSaleComps(subjectSchema.parse(body.subject)),
      });
    }
    if (body.action === "connect" || body.action === "disconnect") {
      if (staff.role !== "owner")
        return response(
          { error: "Only the dealership owner can change data connections." },
          403,
        );
      if (body.action === "disconnect") {
        await disconnectMarket();
        return response({
          connected: false,
          message: "MarketCheck disconnected. Saved appraisals are retained.",
        });
      }
      if (!(await takeSlot(staff.id, "appraisal-connect", 10)))
        return response(
          { error: "Please wait before trying another connection." },
          429,
        );
      const key = z
        .string()
        .trim()
        .min(10)
        .max(512)
        .regex(/^[A-Za-z0-9_.-]+$/)
        .parse(body.key);
      await marketCheckJson(
        new URLSearchParams({
          rows: "1",
          zip: "28562",
          radius: "25",
          car_type: "used",
        }),
        key,
      );
      await saveMarketConnection(key, staff.id);
      return response({
        connected: true,
        usage: await currentMarketUsage(),
        message:
          "MarketCheck listings connected. Drive Max calculates pricing from comparable asking prices; paid prediction endpoints are disabled.",
      });
    }
    if (body.action === "applyPrice") {
      const id = z.uuid().parse(body.id),
        updatedAt = z.string().min(1).max(60).parse(body.vehicleUpdatedAt);
      const record = await findAppraisal(id);
      if (!record?.vehicleId)
        return response(
          {
            error:
              "Save an appraisal for a vehicle already in inventory first.",
          },
          400,
        );
      const numbers = appraisalNumbers(record.data);
      const expectedPrice = z.number().positive().parse(body.expectedPrice);
      if (numbers.retail === null || numbers.retail < 1)
        return response(
          {
            error:
              "Add pricing evidence or a retail override, then save the appraisal.",
          },
          400,
        );
      if (numbers.retail !== expectedPrice)
        return response(
          {
            error:
              "The pricing evidence changed. Refresh the worksheet before updating inventory.",
          },
          409,
        );
      if (
        record.data.retailOverride === null &&
        numbers.marketCurrent &&
        Date.now() - Date.parse(record.data.market!.fetchedAt) > 86400000
      )
        return response(
          {
            error:
              "The saved market snapshot is more than a day old. Refresh it and save before updating inventory.",
          },
          409,
        );
      if (
        record.data.titleStatus !== "clean" &&
        record.data.retailOverride === null
      )
        return response(
          {
            error:
              "Review the title status and set your own retail price before publishing.",
          },
          400,
        );
      const result = await db()
        .from("vehicles")
        .update({ internet_price: numbers.retail })
        .eq("id", record.vehicleId)
        .eq("vin", record.data.subject.vin)
        .eq("updated_at", updatedAt)
        .in("status", ["draft", "available", "pending"])
        .select("id,internet_price,updated_at")
        .maybeSingle();
      if (result.error)
        return response(
          { error: "Could not update the inventory price. Try again." },
          503,
        );
      if (!result.data)
        return response(
          {
            error:
              "Inventory changed or this vehicle is sold/archived. Reload before repricing.",
          },
          409,
        );
      revalidatePath("/");
      revalidatePath("/inventory", "layout");
      revalidatePath("/sitemap.xml");
      revalidatePath("/control-room");
      return response({
        vehicle: result.data,
        message:
          "Inventory vehicle price updated. The website adds the $399 dealer administration fee.",
      });
    }
    return response({ error: "Choose an appraisal action." }, 400);
  } catch (e) {
    if (e instanceof z.ZodError)
      return response(
        { error: e.issues[0]?.message || "Check the worksheet fields." },
        400,
      );
    return response({ error: message(e) }, 503);
  }
}
