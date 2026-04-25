import { NextResponse } from 'next/server';
import { getServerSession } from "next-auth";
import { db } from '@/lib/db';
import { authOptions } from '@/lib/auth';
import { checkRateLimit, getClientAddress } from '@/lib/security/rate-limit';
import { schedulePayloadSchema } from '@/lib/validation';

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// GET: Fetch all saved schedules for a specific user
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;

    if (!email) {
      return unauthorized();
    }

    const ip = getClientAddress(request);
    const rate = checkRateLimit(`schedules:get:${email}:${ip}`, 120, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const savedSchedules = await db.savedSchedule.findMany({
      where: { userEmail: email },
      orderBy: { createdAt: 'asc' }
    });

    return NextResponse.json(savedSchedules);
  } catch (error) {
    console.error("Failed to load schedules:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

// POST: Save a new schedule (or update an existing one)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userEmail = session?.user?.email;
    if (!userEmail) {
      return unauthorized();
    }

    const ip = getClientAddress(request);
    const rate = checkRateLimit(`schedules:post:${userEmail}:${ip}`, 60, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many save attempts. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const parsed = schedulePayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid schedule payload" }, { status: 400 });
    }
    const { id, name, courses } = parsed.data;

    if (id) {
      const existing = await db.savedSchedule.findUnique({ where: { id } });
      if (existing && existing.userEmail !== userEmail) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const schedule = id
      ? await db.savedSchedule.upsert({
          where: { id },
          update: { name, courses },
          create: { id, userEmail, name, courses },
        })
      : await db.savedSchedule.create({
          data: { userEmail, name, courses },
        });

    return NextResponse.json({ success: true, schedule });
  } catch (error) {
    console.error("Failed to save schedule:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
