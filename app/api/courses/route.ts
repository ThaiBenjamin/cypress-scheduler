import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const term = searchParams.get('term');

    const whereClause: any = { term: term };
    
    // THE OMNIBAR LOGIC: Search across multiple columns at once!
    if (q) {
      whereClause.OR = [
        { crn: { contains: q, mode: 'insensitive' } },          // e.g. "308" -> finds 30863
        { subject: { contains: q, mode: 'insensitive' } },      // e.g. "EN" -> finds ENGL
        { courseNumber: { contains: q, mode: 'insensitive' } }, // e.g. "100" -> finds 100C
        { title: { contains: q, mode: 'insensitive' } },        // e.g. "math" -> finds Calculus
      ];
    }

    // If the search bar is empty, return an empty array instantly
    if (!q || q.trim() === '') {
      return NextResponse.json([]);
    }

    const courses = await db.course.findMany({
      where: whereClause,
      include: { meetings: true },
      take: 100, // Limit to 100 so we don't crash the browser while typing!
    });

    // --- OPTIONAL: In-Memory fuzzy search for Professors ---
    // Because Prisma doesn't easily fuzzy-search inside string arrays, 
    // we can grab all classes for the term and filter professors in memory 
    // if the main query didn't find anything, but the 4-way OR covers 95% of use cases.
    
    return NextResponse.json(courses);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 });
  }
}