/**
 * Seed runner for curated clinical content.
 * Upserts checklists (by key) and drugs (by nameEn) from seedData.ts.
 * Usage: npx tsx src/clinical/seed.ts
 */
import { prisma } from '../db.js';
import { CHECKLISTS, DRUGS } from './seedData.js';

export async function seedClinical(): Promise<{ checklists: number; drugs: number }> {
  // Prisma Json fields need plain JSON values — round-trip through JSON.
  const asJson = (v: unknown) => JSON.parse(JSON.stringify(v));
  let checklists = 0;
  for (const c of CHECKLISTS) {
    await prisma.clinicalChecklist.upsert({
      where: { key: c.key },
      update: {
        titleAr: c.titleAr,
        titleEn: c.titleEn,
        category: c.category,
        stepsJson: asJson(c.steps),
      },
      create: {
        key: c.key,
        titleAr: c.titleAr,
        titleEn: c.titleEn,
        category: c.category,
        stepsJson: asJson(c.steps),
      },
    });
    checklists++;
  }
  let drugs = 0;
  for (const d of DRUGS) {
    await prisma.drugReference.upsert({
      where: { nameEn: d.nameEn },
      update: {
        nameAr: d.nameAr,
        classAr: d.classAr,
        entriesJson: asJson(d.entries),
      },
      create: {
        nameAr: d.nameAr,
        nameEn: d.nameEn,
        classAr: d.classAr,
        entriesJson: asJson(d.entries),
      },
    });
    drugs++;
  }
  return { checklists, drugs };
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seedClinical()
    .then((r) => {
      console.log(`Seeded ${r.checklists} checklists, ${r.drugs} drugs.`);
      return prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
