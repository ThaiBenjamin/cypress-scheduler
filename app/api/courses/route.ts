import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const term = searchParams.get('term');

    // If the search bar is empty, return an empty array instantly
    if (!q || q.trim() === '') {
      return NextResponse.json([]);
    }

    // 1. Split the search query into individual words
    // Example: "MATH 250BC" becomes ["MATH", "250BC"]
    const searchWords = q.trim().split(/\s+/).filter(Boolean);

    const courses = await db.course.findMany({
      where: {
        term: term || undefined,
        // 2. Require EVERY word in the search query to match at least one column
        AND: searchWords.map((word) => ({
          OR: [
            { crn: { contains: word, mode: 'insensitive' } },
            { subject: { contains: word, mode: 'insensitive' } },
            { courseNumber: { contains: word, mode: 'insensitive' } },
            { title: { contains: word, mode: 'insensitive' } },
          ],
        })),
      },
      include: { meetings: true },
      orderBy: [
        { subject: 'asc' },
        { courseNumber: 'asc' },
      ],
      take: 100, // Limit to 100 so we don't crash the browser
    });

    return NextResponse.json(courses);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 });
  }
}