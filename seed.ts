import { PrismaClient } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log("⏳ Reading cypress_data.json...");
  
  try {
    // 1. Read the JSON file downloaded by the scraper
    const filePath = path.join(process.cwd(), 'cypress_data.json');
    const fileData = await fs.readFile(filePath, 'utf-8');
    const courses = JSON.parse(fileData);

    console.log(`🚀 Starting database injection for ${courses.length} courses...`);

    // 2. Loop through every single course and inject it
    for (const course of courses) {
      // Safety net: Skip any weird empty rows NOCCCD might send
      if (!course.sectCrn) continue;

      // 3. The NOCCCD Translated Upsert Block
      await prisma.course.upsert({
        where: {
          crn_term: {
            term: "2026-Summer",
            crn: course.sectCrn
          }
        },
        update: {
          // If the class already exists, just update the seats!
          seatsAvailable: course.sectSeatsAvail,
          maxEnrollment: course.sectMaxEnrl
        },
        create: {
          // If the class is brand new, create it from scratch
          crn: course.sectCrn,
          term: "2026-Summer",
          subject: course.sectSubjCode || "Unknown",
          courseNumber: course.sectCrseNumb || "Unknown",
          title: "TBD", // Placeholder until we find the title API
          units: 0,     // Placeholder until we find the units API
          
          // Grab the instruction mode from the first meeting, or default to Unknown
          instructionMode: course.sectMeetings?.[0]?.schdDesc || "Unknown", 
          
          seatsAvailable: course.sectSeatsAvail || 0,
          maxEnrollment: course.sectMaxEnrl || 0,
          
          // Wrap the professor name in an array if it exists
          professors: course.sectInstrName ? [course.sectInstrName] : [],
          
          meetings: {
            create: [] // We can map the specific meeting times later!
          }
        }
      });
    }

    console.log("✅ Database successfully seeded!");
    
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
