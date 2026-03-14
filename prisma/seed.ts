import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  // Create Jan's account
  const passwordHash = await bcrypt.hash("broccorun2024", 12);

  const jan = await prisma.user.upsert({
    where: { email: "jan@brocco.run" },
    update: {},
    create: {
      email: "jan@brocco.run",
      name: "Jan",
      passwordHash,
    },
  });

  console.log(`Created user: ${jan.email} (${jan.id})`);

  // Create profile for Jan
  await prisma.userProfile.upsert({
    where: { userId: jan.id },
    update: {},
    create: {
      userId: jan.id,
      timezone: "Europe/Berlin",
      onboardingCompleted: false,
    },
  });

  console.log("Created user profile");

  // Generate 5 invite codes
  const codes: string[] = [];
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(6).toString("hex");
    await prisma.inviteCode.upsert({
      where: { code },
      update: {},
      create: {
        code,
        createdBy: jan.id,
      },
    });
    codes.push(code);
  }

  console.log("Generated invite codes:");
  codes.forEach((code) => console.log(`  ${code}`));

  console.log("\nSeed complete!");
  console.log(`Login: jan@brocco.run / broccorun2024`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
