import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

type CourseResult = Awaited<ReturnType<typeof db.course.findMany>>[number];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  const term = searchParams.get('term');

  try {
    if (!q) {
      return NextResponse.json([]);
    }

    const searchWords = q.split(/\s+/).filter(Boolean);

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
      // By using 'include' instead of 'select', Prisma automatically grabs 
      // all the top-level columns (including your new waitCount and waitCapacity!)
      include: { meetings: true },
      take: 100, 
    });

    // 2. Rank the results by relevance
    const queryLower = q.toLowerCase();
    
    courses.sort((a: CourseResult, b: CourseResult) => {
      // Give each course a "score" based on where the match is
      const getScore = (course: CourseResult) => {
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

    if (courses.length > 0) {
      return NextResponse.json(courses);
    }

    return NextResponse.json(await getFallbackCourses(q, term));
  } catch (error) {
    console.error("Database Error, using local fallback:", error);

    try {
      return NextResponse.json(await getFallbackCourses(q, term));
    } catch (fallbackError) {
      console.error('Fallback data load failed:', fallbackError);
      return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 500 });
    }
  }
}

async function getFallbackCourses(q: string, term: string | null) {
  const raw = await readFile(path.join(process.cwd(), 'cypress_data.json'), 'utf-8');
  const catalog = JSON.parse(raw) as any[];
  const searchWords = q.split(/\s+/).filter(Boolean);

  const normalizedCourses = catalog
    .map((row) => {
      const mappedTerm = mapTermCodeToLabel(row.sectTermCode, row.sectMeetings?.[0]?.startDate);
      const meetings = (row.sectMeetings || []).map((meeting: any) => ({
        type: meeting.mtypDesc || meeting.mtypCode || 'Meeting',
        days: extractMeetingDays(meeting),
        startTime: toClock(meeting.beginTime),
        endTime: toClock(meeting.endTime),
        building: meeting.bldgCode || undefined,
        room: meeting.roomCode || undefined,
      }));

      return {
        id: String(row.sectKey),
        term: mappedTerm,
        crn: String(row.sectCrn),
        subject: String(row.sectSubjCode || ''),
        courseNumber: String(row.sectCrseNumb || ''),
        title: String(row.sectLongText || '').slice(0, 90) || 'Course',
        units: 0,
        instructionMode: row.sectInsmCode || null,
        description: row.sectLongText || null,
        seatsAvailable: Number(row.sectSeatsAvail || 0),
        maxEnrollment: Number(row.sectMaxEnrl || 0),
        waitCount: Number(row.sectWaitCount || 0),
        waitCapacity: Number(row.sectWaitCapacity || 0),
        professors: row.sectInstrName ? [String(row.sectInstrName)] : [],
        meetings,
      };
    });

  const searchFilter = (course: any) => {
    const haystack = `${course.crn} ${course.subject} ${course.courseNumber} ${course.title} ${course.description || ''}`.toLowerCase();
    return searchWords.every((word) => haystack.includes(word.toLowerCase()));
  };

  const termMatches = normalizedCourses
    .filter((course) => !term || course.term === term)
    .filter(searchFilter);

  if (termMatches.length > 0) {
    return termMatches.slice(0, 100);
  }

  // If term-specific data is unavailable, gracefully fall back to any term so search still works.
  return normalizedCourses.filter(searchFilter).slice(0, 100);
}

function mapTermCodeToLabel(termCode: string, startDate?: string): string {
  const code = String(termCode || '');
  const fallbackYear = code.slice(0, 4);
  const dateYear = typeof startDate === "string" && startDate.split("/").length === 3
    ? startDate.split("/")[2]
    : "";
  const year = dateYear || fallbackYear;
  const suffix = code.slice(4);
  if (suffix === '30') return `${year}-Summer`;
  if (suffix === '10') return `${year}-Winter/Spring`;
  if (suffix === '70') return `${year}-Fall`;
  return `${year}-Unknown`;
}

function toClock(rawTime?: string): string | undefined {
  if (!rawTime || rawTime.length < 4) return undefined;
  const padded = rawTime.padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

function extractMeetingDays(meeting: Record<string, string>): string[] {
  const days: string[] = [];
  if (meeting.sunDay) days.push('Su');
  if (meeting.monDay) days.push('M');
  if (meeting.tueDay) days.push('Tu');
  if (meeting.wedDay) days.push('W');
  if (meeting.thuDay) days.push('Th');
  if (meeting.friDay) days.push('F');
  if (meeting.satDay) days.push('Sa');
  return days;
}
