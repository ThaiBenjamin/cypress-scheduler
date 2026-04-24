import { NextResponse } from 'next/server';
import { db } from '@/lib/db'; // Make sure this matches where your Prisma client is exported! Usually @/lib/db, @/lib/prisma, or lib/db.ts

// GET: Fetch all saved schedules for a specific user
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
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
    const body = await request.json();
    const { id, userEmail, name, courses } = body;

    if (!userEmail) {
      return NextResponse.json({ error: "User must be logged in" }, { status: 401 });
    }

    // Upsert means: If the ID exists, UPDATE it. If it doesn't, CREATE it.
    const schedule = await db.savedSchedule.upsert({
      where: { id: id },
      update: {
        name: name,
        courses: courses,
      },
      create: {
        id: id,
        userEmail: userEmail,
        name: name,
        courses: courses,
      }
    });

    return NextResponse.json({ success: true, schedule });
  } catch (error) {
    console.error("Failed to save schedule:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}