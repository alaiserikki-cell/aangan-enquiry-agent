import { checkAvailability } from "@/lib/tools";
import { handleToolRequest } from "@/lib/vaani/tool-route";

export const maxDuration = 10;

export function POST(req: Request) {
  return handleToolRequest(req, checkAvailability);
}
