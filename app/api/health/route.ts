import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "cypress-scheduler",
    timestamp: new Date().toISOString(),
  });
}
