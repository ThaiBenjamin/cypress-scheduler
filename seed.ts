import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs/promises';
import path from 'path';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function parseNocccdDays(meeting: any): string[] {
  const daysArray: string[] = [];
  
  if (meeting.monDay === "M") daysArray.push("M");
  if (meeting.tueDay === "T") daysArray.push("Tu");
  if (meeting.wedDay === "W") daysArray.push("W");
  if (meeting.thuDay === "R") daysArray.push("Th");
  if (meeting.friDay === "F") daysArray.push("F");
  if (meeting.satDay === "S") daysArray.push("Sa");
  if (meeting.sunDay === "U") daysArray.push("Su");

  return daysArray;
}

function formatTime(timeStr?: string): string {
  if (!timeStr || timeStr.length !== 4) return "";
  return `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}`;
}

async function main() {
  console.log("⏳ Reading cypress_data.json...");
  
  try {
    const filePath = path.join(process.cwd(), 'cypress_data.json');
    const fileData = await fs.readFile(filePath, 'utf-8');
    const courses = JSON.parse(fileData);

    console.log("🧹 Wiping old database records to prevent ghost classes...");
    await prisma.course.deleteMany({}); 

    console.log(`🚀 Starting database injection for ${courses.length} courses...`);

    for (const course of courses) {
      if (!course.sectCrn) continue;

      await prisma.course.upsert({
        where: {
          crn_term: {
            term: course.my_custom_term, 
            crn: course.sectCrn
          }
        },
        update: {
          seatsAvailable: course.sectSeatsAvail,
          maxEnrollment: course.sectMaxEnrl,
          title: course.my_custom_title || "TBD",
          units: course.my_custom_units || 0,
        },
        create: {
          crn: course.sectCrn,
          term: course.my_custom_term, 
          subject: course.sectSubjCode || "Unknown",
          courseNumber: course.sectCrseNumb || "Unknown",
          title: course.my_custom_title || "TBD", 
          units: course.my_custom_units || 0,     
          instructionMode: course.sectMeetings?.[0]?.schdDesc || "Unknown",
          description: course.my_custom_description || "No description available.", 
          seatsAvailable: course.sectSeatsAvail || 0,
          maxEnrollment: course.sectMaxEnrl || 0,
          professors: course.sectInstrName ? [course.sectInstrName] : [],
          
          meetings: {
            create: (course.sectMeetings || []).map((m: any) => ({
              days: parseNocccdDays(m), 
              startTime: formatTime(m.beginTime),
              endTime: formatTime(m.endTime),
              
              // THE FIX: We added the missing 'type' argument!
              // We grab it from NOCCCD, or default to "Class" if it's missing.
              type: m.mtypDesc || m.schdDesc || "Class",
              building: m.bldgCode || "",
              room: m.roomCode || ""
              
            })).filter((m: any) => m.startTime !== "") 
          }
        }
      });
    }

    console.log("✅ Database successfully seeded with full meeting times!");
    
  } catch (error) {
    console.error("❌ Error during seeding:", error);
    process.exit(1);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
