import { solPrice } from "@/lib/price";
export const dynamic = "force-dynamic";
export async function GET() { const price = await solPrice(); return Response.json({ price }, { headers: { "Cache-Control": "public, max-age=15", "X-Content-Type-Options": "nosniff" } }); }
