import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checkRateLimit, getClientAddress } from "@/lib/security/rate-limit";

type CourseResult = Awaited<ReturnType<typeof db.course.findMany>>[number];
const withSource = (
  data: unknown,
  source: "db" | "fallback",
  status = 200,
  sourceReason?: string,
) =>
  NextResponse.json(data, {
    status,
    headers: {
      "X-Course-Source": source,
      ...(sourceReason ? { "X-Course-Source-Reason": sourceReason } : {}),
    },
  });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();
  const term = searchParams.get("term");
  const ip = getClientAddress(request);
  const rate = checkRateLimit(`courses:get:${ip}`, 240, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many searches. Please try again in a moment." },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfterSeconds) },
      },
    );
  }

  try {
    if (!q || q.length > 120) {
      return withSource([], "db");
    }

    const searchWords = tokenizeQuery(q);

    // 1) Fetch from database using expanded query variants (e.g. "english" -> "engl")
    let courses = await db.course.findMany({
      where: buildCourseSearchWhere(searchWords, term),
      // By using 'include' instead of 'select', Prisma automatically grabs
      // all the top-level columns (including your new waitCount and waitCapacity!)
      include: { meetings: true },
      take: 100,
    });

    courses = courses.sort((a: CourseResult, b: CourseResult) =>
      rankCompare(a, b, q, searchWords),
    );

    if (courses.length > 0) {
      return withSource(courses, "db", 200, "exact_term_match");
    }

    // 2) If no rows match the selected term, fall back to DB-only any-term search
    // before touching local JSON fallback. This keeps results sourced from DB whenever possible.
    if (term) {
      const anyTermCourses = await db.course.findMany({
        where: buildCourseSearchWhere(searchWords, null),
        include: { meetings: true },
        take: 100,
      });

      const sortedAnyTermCourses = anyTermCourses.sort(
        (a: CourseResult, b: CourseResult) => rankCompare(a, b, q, searchWords),
      );

      if (sortedAnyTermCourses.length > 0) {
        return withSource(sortedAnyTermCourses, "db", 200, "db_any_term_match");
      }
    }

    return withSource(
      await getFallbackCourses(q, term),
      "fallback",
      200,
      "db_empty_after_search",
    );
  } catch (error) {
    console.error("Database Error, using local fallback:", error);

    try {
      return withSource(
        await getFallbackCourses(q, term),
        "fallback",
        200,
        "db_error",
      );
    } catch (fallbackError) {
      console.error("Fallback data load failed:", fallbackError);
      return NextResponse.json(
        { error: "Failed to fetch courses" },
        { status: 500, headers: { "X-Course-Source": "fallback" } },
      );
    }
  }
}

function buildCourseSearchWhere(searchWords: string[], term: string | null) {
  return {
    term: term || undefined,
    AND: searchWords.map((word) => ({
      OR: expandQueryWord(word).flatMap((variant) => [
        { crn: { contains: variant, mode: "insensitive" as const } },
        { subject: { contains: variant, mode: "insensitive" as const } },
        { courseNumber: { contains: variant, mode: "insensitive" as const } },
        { title: { contains: variant, mode: "insensitive" as const } },
        { description: { contains: variant, mode: "insensitive" as const } },
      ]),
    })),
  };
}

async function getFallbackCourses(q: string, term: string | null) {
  const raw = await readFile(
    path.join(process.cwd(), "cypress_data.json"),
    "utf-8",
  );
  const catalog = JSON.parse(raw) as any[];
  const searchWords = tokenizeQuery(q);

  const normalizedCourses = catalog
    .filter((row) => isCypressCampusCode(row?.sectCampCode))
    .map((row) => normalizeFallbackRow(row));

  const searchFilter = (course: any) => {
    const haystack =
      `${course.crn} ${course.subject} ${course.courseNumber} ${course.title} ${course.description || ""}`.toLowerCase();
    return searchWords.every((word) =>
      expandQueryWord(word).some((variant) => haystack.includes(variant)),
    );
  };

  const termMatches = normalizedCourses
    .filter((course) => !term || course.term === term)
    .filter(searchFilter)
    .sort((a, b) => rankCompare(a, b, q, searchWords));

  if (termMatches.length > 0) {
    return termMatches.slice(0, 100);
  }

  // If term-specific data is unavailable, gracefully fall back to any term so search still works.
  return normalizedCourses
    .filter(searchFilter)
    .sort((a, b) => rankCompare(a, b, q, searchWords))
    .slice(0, 100);
}

const SUBJECT_SYNONYMS: Record<string, string[]> = {
  english: ["engl"],
  eng: ["engl"],
  math: ["math"],
  biology: ["biol"],
  chemistry: ["chem"],
  history: ["hist"],
  political: ["psci"],
  psychology: ["psych"],
  sociology: ["soci"],
  communication: ["comm"],
  accounting: ["acct"],
  economics: ["econ"],
};

function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}

function expandQueryWord(word: string): string[] {
  const set = new Set<string>([word.toLowerCase()]);
  const aliases = SUBJECT_SYNONYMS[word.toLowerCase()] || [];
  aliases.forEach((alias) => set.add(alias.toLowerCase()));

  for (const [label, codes] of Object.entries(SUBJECT_SYNONYMS)) {
    if (codes.map((code) => code.toLowerCase()).includes(word.toLowerCase())) {
      set.add(label.toLowerCase());
    }
  }
  return [...set];
}

function isCypressCampusCode(code: unknown): boolean {
  const normalized = String(code || "").toUpperCase();
  return normalized.startsWith("1");
}

// Normalizes a single fallback row into the shape the UI expects. Supports BOTH
// cypress_data.json formats:
//   - raw NOCCCD sections dump (sectLongText, sectTermCode, no title/units)
//   - scraper-processed output (my_custom_term/title/units/description/wait_*)
// The scraper's format is richer (real catalog titles + units), so prefer it when present.
function normalizeFallbackRow(row: any) {
  const isProcessed =
    row?.my_custom_term != null || row?.my_custom_title != null;

  const meetings = (row.sectMeetings || []).map((meeting: any) => ({
    type: meeting.mtypDesc || meeting.schdDesc || meeting.mtypCode || "Meeting",
    days: extractMeetingDays(meeting),
    startTime: toClock(meeting.beginTime),
    endTime: toClock(meeting.endTime),
    startDate: toIsoDate(meeting.startDate),
    endDate: toIsoDate(meeting.endDate),
    building: meeting.bldgCode || undefined,
    room: meeting.roomCode || undefined,
  }));

  const term = isProcessed
    ? String(row.my_custom_term)
    : mapTermCodeToLabel(row.sectTermCode, row.sectMeetings?.[0]?.startDate);

  const title = isProcessed
    ? String(row.my_custom_title || "Course")
    : String(row.sectLongText || "").slice(0, 90) || "Course";

  return {
    id: String(row.sectKey ?? row.sectCrn),
    term,
    crn: String(row.sectCrn),
    subject: String(row.sectSubjCode || ""),
    courseNumber: String(row.sectCrseNumb || ""),
    title,
    units: isProcessed ? Number(row.my_custom_units || 0) : 0,
    instructionMode: row.sectInsmCode || null,
    description: isProcessed
      ? row.my_custom_description || null
      : row.sectLongText || null,
    seatsAvailable: Number(row.sectSeatsAvail || 0),
    maxEnrollment: Number(row.sectMaxEnrl || 0),
    waitCount: Number(
      (isProcessed ? row.my_custom_wait_count : row.sectWaitCount) || 0,
    ),
    waitCapacity: Number(
      (isProcessed ? row.my_custom_wait_capacity : row.sectWaitCapacity) || 0,
    ),
    professors: row.sectInstrName ? [String(row.sectInstrName)] : [],
    meetings,
    campusCode: String(row.sectCampCode || ""),
  };
}

function rankCompare(
  a: Pick<
    CourseResult,
    "subject" | "courseNumber" | "title" | "description" | "crn"
  >,
  b: Pick<
    CourseResult,
    "subject" | "courseNumber" | "title" | "description" | "crn"
  >,
  rawQuery: string,
  searchWords: string[],
): number {
  const scoreA = relevanceScore(a, rawQuery, searchWords);
  const scoreB = relevanceScore(b, rawQuery, searchWords);
  if (scoreA !== scoreB) return scoreB - scoreA;
  if (a.subject < b.subject) return -1;
  if (a.subject > b.subject) return 1;
  if (a.courseNumber < b.courseNumber) return -1;
  if (a.courseNumber > b.courseNumber) return 1;
  return 0;
}

function relevanceScore(
  course: Pick<
    CourseResult,
    "subject" | "courseNumber" | "title" | "description" | "crn"
  >,
  rawQuery: string,
  searchWords: string[],
): number {
  const query = rawQuery.toLowerCase().trim();
  const subject = String(course.subject || "").toLowerCase();
  const courseNumber = String(course.courseNumber || "").toLowerCase();
  const title = String(course.title || "").toLowerCase();
  const description = String(course.description || "").toLowerCase();
  const crn = String(course.crn || "").toLowerCase();
  const subjectVariants = new Set<string>([subject]);
  expandQueryWord(subject).forEach((v) => subjectVariants.add(v));

  let score = 0;
  if (subject === query) score += 300;
  if (`${subject} ${courseNumber}`.toLowerCase() === query) score += 260;
  if (crn === query) score += 240;
  if (
    subject.startsWith(query) ||
    [...subjectVariants].some((v) => v.startsWith(query))
  )
    score += 180;
  if (courseNumber.startsWith(query)) score += 160;
  if (title.startsWith(query)) score += 140;

  for (const word of searchWords) {
    const expanded = expandQueryWord(word);
    if (
      expanded.some(
        (variant) => variant === subject || subject.startsWith(variant),
      )
    )
      score += 90;
    if (expanded.some((variant) => courseNumber.startsWith(variant)))
      score += 70;
    if (expanded.some((variant) => title.includes(variant))) score += 40;
    if (expanded.some((variant) => description.includes(variant))) score += 10;
    if (expanded.some((variant) => crn.includes(variant))) score += 80;
  }
  return score;
}

function mapTermCodeToLabel(termCode: string, startDate?: string): string {
  // NOCCCD term codes are YYYYSS. The base year YYYY is the FALL year of the
  // academic year, so Spring/Summer belong to YYYY+1:
  //   10 -> Fall (year = YYYY), 20 -> Winter/Spring (YYYY+1), 30 -> Summer (YYYY+1)
  const code = String(termCode || "");
  const baseYear = Number(code.slice(0, 4)) || 0;
  const suffix = code.slice(4);

  let season: string;
  let academicYear: number;
  if (suffix === "10") {
    season = "Fall";
    academicYear = baseYear;
  } else if (suffix === "20") {
    season = "Winter/Spring";
    academicYear = baseYear + 1;
  } else if (suffix === "30") {
    season = "Summer";
    academicYear = baseYear + 1;
  } else {
    season = "Unknown";
    academicYear = baseYear;
  }

  // The section's actual start date is the most reliable source of the year when present.
  const dateYear =
    typeof startDate === "string" && startDate.split("/").length === 3
      ? Number(startDate.split("/")[2])
      : 0;
  const year = dateYear || academicYear || baseYear;

  return `${year}-${season}`;
}

function toClock(rawTime?: string): string | undefined {
  if (!rawTime || rawTime.length < 4) return undefined;
  const padded = rawTime.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

/** NOCCCD ships meeting dates as "MM/DD/YYYY"; the DB stores "YYYY-MM-DD", so match it. */
function toIsoDate(rawDate?: string): string | undefined {
  if (!rawDate) return undefined;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(rawDate.trim());
  if (!match) return undefined;
  const [, month, day, year] = match;
  return `${year}-${month}-${day}`;
}

function extractMeetingDays(meeting: Record<string, string>): string[] {
  const days: string[] = [];
  if (meeting.sunDay) days.push("Su");
  if (meeting.monDay) days.push("M");
  if (meeting.tueDay) days.push("Tu");
  if (meeting.wedDay) days.push("W");
  if (meeting.thuDay) days.push("Th");
  if (meeting.friDay) days.push("F");
  if (meeting.satDay) days.push("Sa");
  return days;
}
