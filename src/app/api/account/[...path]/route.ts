import { handleAccountRequest } from "@/server/account/handler";
import { decodeAccountSegments } from "@/lib/account/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  let path: string[];
  try { path = decodeAccountSegments((await params).path); }
  catch { return Response.json({ error: { code: "not_found", message: "请求的功能不存在。" } }, { status: 404, headers: { "Cache-Control": "no-store" } }); }
  return handleAccountRequest(request, path);
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
