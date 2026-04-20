import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q');
    const term = searchParams.get('term');

    if (!q || q.trim() === '') {
      return NextResponse.json([]);
    }

    const searchWords = q.trim().split(/\s+/).filter(Boolean);

    // 1. Fetch from database just like before
    let courses = await db.course.findMany({
      where: {
        term: term || undefined,
        AND: searchWords.map((word) => ({
          OR: [
            { crn: { contains: word, mode: 'insensitive' } },
            { subject: { contains: word, mode: 'insensitive' } },
            { courseNumber: { contains: word, mode: 'insensitive' } },
            { title: { contains: word, mode: 'insensitive' } },
            { description: { contains: word, mode: 'insensitive' } },
          ],
        })),
      },
      include: { meetings: true },
      take: 100, 
    });

    // 2. THE FIX: Rank the results by relevance!
    const queryLower = q.toLowerCase();
    
    courses.sort((a: { subject: number; courseNumber: number; }, b: { subject: number; courseNumber: number; }) => {
      // Give each course a "score" based on where the match is
      const getScore = (course: any) => {
        const subj = course.subject.toLowerCase();
        const num = course.courseNumber.toLowerCase();
        const title = course.title.toLowerCase();

        // Exact subject match is the most important (Score: 4)
        if (subj === queryLower || subj.includes(queryLower)) return 4;
        
        // Course number match is second most important (Score: 3)
        if (num.includes(queryLower)) return 3;
        
        // Title match is third (Score: 2)
        if (title.includes(queryLower)) return 2;
        
        // Just hiding in the description? Lowest score. (Score: 1)
        return 1; 
      };

      const scoreA = getScore(a);
      const scoreB = getScore(b);

      // If one course has a higher score, put it higher on the list
      if (scoreA !== scoreB) {
        return scoreB - scoreA; 
      }

      // If they have the exact same score (e.g. they are both Math classes), 
      // THEN sort them alphabetically
      if (a.subject < b.subject) return -1;
      if (a.subject > b.subject) return 1;
      if (a.courseNumber < b.courseNumber) return -1;
      if (a.courseNumber > b.courseNumber) return 1;
      
      return 0;
    });

    return NextResponse.json(courses);
  } catch (error) {
    console.error("Database Error:", error);
    return NextResponse.json({ error: "Failed to fetch courses" }, { status: 500 });
  }
}