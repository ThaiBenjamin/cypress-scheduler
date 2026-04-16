import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    // 1. Grab the search terms from the URL (e.g., ?subject=MATH)
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get('subject');
    const term = searchParams.get('term');
    
    const courseNumber = searchParams.get('courseNumber');

    // 2. Build our database filter
    const whereClause: any = { term: term };
    
    if (subject) {
      // Case-insensitive search for the subject (e.g., "math" matches "MATH")
      whereClause.subject = { contains: subject, mode: 'insensitive' };
    }
    
    if (courseNumber) {
      whereClause.courseNumber = { contains: courseNumber, mode: 'insensitive' };
    }

    // 3. If no search terms are provided, don't return anything (AntAlmanac style)
    if (!subject && !courseNumber) {
      return NextResponse.json([]);
    }

    // 4. Fetch the filtered courses
    const courses = await db.course.findMany({
      where: whereClause,
      include: { meetings: true },
      take: 100, // Limit to 100 results so it doesn't crash the browser
    });

    return NextResponse.json(courses);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 });
  }
}