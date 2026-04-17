import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs/promises';
import path from 'path';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// --- THE FIX: A smart translator for NOCCCD's weird day codes ---
// NOCCCD uses "T" for Tuesday and "R" for Thursday. 
// Your frontend dayMap expects "Tu" and "Th". This bridges the gap!
function parseNocccdDays(daysString?: string): string[] {
  if (!daysString) return [];
  const daysArray: string[] = [];
  const s = daysString.toUpperCase();

  if (s.includes("M")) daysArray.push("M");
  if (s.includes("T") && !s.includes("TH")) daysArray.push("Tu");
  if (s.includes("W")) daysArray.push("W");
  if (s.includes("R") || s.includes("TH")) daysArray.push("Th");
  if (s.includes("F")) daysArray.push("F");
  if (s.includes("S") && !s.includes("SU")) daysArray.push("Sa");
  if (s.includes("U") || s.includes("SU")) daysArray.push("Su");

  return daysArray;
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
          seatsAvailable: course.sectSeatsAvail || 0,
          maxEnrollment: course.sectMaxEnrl || 0,
          professors: course.sectInstrName ? [course.sectInstrName] : [],
          
          // --- THE FIX: Restoring the meetings! ---
          meetings: {
            create: (course.sectMeetings || []).map((m: any) => ({
              // Use our translator to get clean "Tu" and "Th" arrays
              days: parseNocccdDays(m.meetDays || m.days), 
              
              // NOCCCD uses meetStartTime, but we fallback to startTime just in case
              startTime: m.meetStartTime || m.startTime || "",
              endTime: m.meetEndTime || m.endTime || ""
              
            })).filter((m: any) => m.startTime !== "") // Ignore empty TBA schedules
          }
        }
      });
    }

    console.log("✅ Database successfully seeded with 100% complete data AND meetings!");
    
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
