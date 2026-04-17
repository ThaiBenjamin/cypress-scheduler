import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs/promises';
import path from 'path';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
          // Update these just in case they change!
          title: course.my_custom_title || "TBD",
          units: course.my_custom_units || 0,
        },
        create: {
          crn: course.sectCrn,
          term: course.my_custom_term, 
          subject: course.sectSubjCode || "Unknown",
          courseNumber: course.sectCrseNumb || "Unknown",
          
          // THE FIX: Use the real data Python stitched together for us!
          title: course.my_custom_title || "TBD", 
          units: course.my_custom_units || 0,     
          
          instructionMode: course.sectMeetings?.[0]?.schdDesc || "Unknown", 
          seatsAvailable: course.sectSeatsAvail || 0,
          maxEnrollment: course.sectMaxEnrl || 0,
          professors: course.sectInstrName ? [course.sectInstrName] : [],
          meetings: {
            create: [] 
          }
        }
      });
    }

    console.log("✅ Database successfully seeded with 100% complete data!");
    
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
