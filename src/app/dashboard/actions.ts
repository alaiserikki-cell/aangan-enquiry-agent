"use server";

import { revalidatePath } from "next/cache";
import { db, must } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export async function markCalledBack(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  must(await db().from("calls").update({ callback_done_at: new Date().toISOString() }).eq("id", id), "mark called back");
  revalidatePath("/dashboard");
}
