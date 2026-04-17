import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs/promises';
import path from 'path';

// Set up the PostgreSQL connection pool using your GitHub Secrets
const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

// Initialize Prisma WITH the required adapter
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("⏳ Reading cypress_data.json...");
  
  try {
    const filePath = path.join(process.cwd(), 'cypress_data.json');
    const fileData = await fs.readFile(filePath, 'utf-8');
    const courses = JSON.parse(fileData);

    // 🧹 THE CAR WASH: Wipe out the old, mislabeled data before we inject
    console.log("🧹 Wiping old database records to prevent ghost classes...");
    await prisma.course.deleteMany({}); 

    console.log(`🚀 Starting database injection for ${courses.length} courses...`);

    for (const course of courses) {
      if (!course.sectCrn) continue;

      await prisma.course.upsert({
        where: {
          crn_term: {
            // Read the dynamic stamp from Python (Summer OR Fall)
            term: course.my_custom_term, 
            crn: course.sectCrn
          }
        },
        update: {
          seatsAvailable: course.sectSeatsAvail,
          maxEnrollment: course.sectMaxEnrl
        },
        create: {
          crn: course.sectCrn,
          // Read the dynamic stamp from Python (Summer OR Fall)
          term: course.my_custom_term, 
          
          subject: course.sectSubjCode || "Unknown",
          courseNumber: course.sectCrseNumb || "Unknown",
          title: "TBD", 
          units: 0,     
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

    console.log("✅ Database successfully seeded with perfectly labeled data!");
    
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