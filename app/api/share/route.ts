import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkRateLimit, getClientAddress } from "@/lib/security/rate-limit";
import { createSignedSharePayload } from "@/lib/share";
import { z } from "zod";

const shareSchema = z.object({
  name: z.string().trim().min(1).max(120),
  courses: z.array(z.unknown()).max(200),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientAddress(request);
  const rate = checkRateLimit(`share:post:${session.user.email}:${ip}`, 30, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many share link requests. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  const raw = await request.json();
  const parsed = shareSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid share payload" }, { status: 400 });
  }

  const signed = createSignedSharePayload({
    name: parsed.data.name,
    courses: parsed.data.courses,
    generatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true, ...signed });
}
