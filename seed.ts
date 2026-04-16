import "dotenv/config";
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';

// Create a connection pool and hand it to Prisma
const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Helper to format Banner's time ("1440" -> "14:40")
function formatTime(timeStr: string | null) {
  if (!timeStr) return null;
  return `${timeStr.substring(0, 2)}:${timeStr.substring(2)}`;
}

// Helper to convert Banner's boolean days into an array ["M", "W"]
function getActiveDays(meeting: any) {
  const days = [];
  if (meeting.monday) days.push("M");
  if (meeting.tuesday) days.push("Tu");
  if (meeting.wednesday) days.push("W");
  if (meeting.thursday) days.push("Th");
  if (meeting.friday) days.push("F");
  if (meeting.saturday) days.push("Sa");
  if (meeting.sunday) days.push("Su");
  return days;
}

async function main() {
  console.log("⏳ Reading cypress_data.json...");
  const rawData = JSON.parse(fs.readFileSync('./cypress_data.json', 'utf-8'));

  console.log(`🚀 Starting database injection for ${rawData.length} courses...`);

  for (const course of rawData) {
    // Extract Instructors
    const professors = course.faculty
      ? course.faculty.map((f: any) => f.displayName).filter(Boolean)
      : [];

    // Prepare Meeting Times
    const meetings = course.meetingsFaculty
      ? course.meetingsFaculty.map((mf: any) => {
          const mt = mf.meetingTime;
          return {
            type: mt.meetingTypeDescription || "Lecture",
            days: getActiveDays(mt),
            startTime: formatTime(mt.beginTime),
            endTime: formatTime(mt.endTime),
            building: mt.buildingDescription,
            room: mt.room,
          };
        })
      : [];

    // Inject into Database (Requires BOTH crn and term to identify unique classes now)
    await prisma.course.upsert({
      where: { 
        crn_term: {
          crn: course.courseReferenceNumber,
          term: "2026-Summer"
        }
      },
      update: {
        seatsAvailable: course.seatsAvailable,
        maxEnrollment: course.maximumEnrollment,
      },
      create: {
        crn: course.courseReferenceNumber,
        term: "2026-Summer",
        subject: course.subject,
        courseNumber: course.courseNumber,
        title: course.courseTitle,
        units: course.creditHourLow || 0,
        instructionMode: course.instructionalMethodDescription,
        seatsAvailable: course.seatsAvailable,
        maxEnrollment: course.maximumEnrollment,
        professors: professors,
        meetings: {
          create: meetings,
        },
      },
    });
  }

  console.log("✅ Database successfully seeded!");
}

main()
  .catch((e) => {
    console.error("❌ Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    // Close the connection pool gracefully
    await prisma.$disconnect();
  });