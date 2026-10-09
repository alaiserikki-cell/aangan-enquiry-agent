"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { requireSession } from "@/lib/require-session";

export async function markCalledBack(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  await sql`update calls set callback_done_at = now() where id = ${id}`;
  revalidatePath("/dashboard");
}
