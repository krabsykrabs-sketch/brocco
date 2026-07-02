import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const prisma = new PrismaClient();

// Runs on EVERY deploy (docker-entrypoint.sh), so it must be fully
// idempotent and must never print credentials to production logs.
const isProd = process.env.NODE_ENV === "production";

async function main() {
  console.log("Seeding database...");

  // Seed password: SEED_PASSWORD env in production, dev fallback locally.
  // Only used when the account doesn't exist yet (upsert update is a no-op),
  // so existing passwords are never reset by a deploy.
  const seedPassword = process.env.SEED_PASSWORD || (isProd ? null : "broccorun2024");

  const existing = await prisma.user.findUnique({ where: { email: "jan@brocco.run" } });

  if (!existing && !seedPassword) {
    console.warn(
      "Seed user does not exist and no SEED_PASSWORD is set — skipping user creation. " +
        "Set SEED_PASSWORD to bootstrap a fresh database."
    );
    return;
  }

  const jan = existing
    ? existing
    : await prisma.user.create({
        data: {
          email: "jan@brocco.run",
          name: "Jan",
          passwordHash: await bcrypt.hash(seedPassword!, 12),
        },
      });

  console.log(`Seed user ${existing ? "exists" : "created"} (${jan.id})`);

  await prisma.userProfile.upsert({
    where: { userId: jan.id },
    update: {},
    create: {
      userId: jan.id,
      timezone: "Europe/Berlin",
      onboardingCompleted: false,
    },
  });

  // Invite codes: only mint on first-ever seed. Re-minting on every deploy
  // would accumulate unused valid codes and leak them into deploy logs.
  const existingCodeCount = await prisma.inviteCode.count({ where: { createdBy: jan.id } });
  if (existingCodeCount === 0) {
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const code = crypto.randomBytes(6).toString("hex");
      await prisma.inviteCode.create({ data: { code, createdBy: jan.id } });
      codes.push(code);
    }
    if (!isProd) {
      console.log("Generated invite codes:");
      codes.forEach((code) => console.log(`  ${code}`));
    } else {
      console.log(`Generated ${codes.length} invite codes (view them in Settings).`);
    }
  }

  console.log("Seed complete.");
  if (!isProd) {
    console.log(`Dev login: jan@brocco.run / ${seedPassword}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
