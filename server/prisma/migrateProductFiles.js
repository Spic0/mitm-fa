const fs = require("fs");
const path = require("path");

const PDF_DIR = path.join(__dirname, "..", "storage", "pdfs");
const RESOURCE_DIR = path.join(__dirname, "..", "storage", "resources");

// One-time step: copies every file referenced by a ProductFile row from the
// old storage/pdfs directory into storage/resources, so the accompanying SQL
// migration's INSERT INTO "ProductResource" ... SELECT ... FROM "ProductFile"
// has a real file waiting at the path it will reference. Run this before
// applying the migration that drops the ProductFile table. Safe to re-run.
async function migrateProductFiles() {
  const { prisma } = require("../src/db");
  const files = await prisma.productFile.findMany({ include: { product: { select: { name: true } } } });

  fs.mkdirSync(RESOURCE_DIR, { recursive: true });

  let copied = 0;
  for (const file of files) {
    const src = path.join(PDF_DIR, file.fileName);
    const dest = path.join(RESOURCE_DIR, file.fileName);
    if (!fs.existsSync(src)) {
      console.warn(`Skipping ${file.fileName} (product "${file.product.name}") — source file not found`);
      continue;
    }
    fs.copyFileSync(src, dest);
    copied++;
    console.log(`Copied ${file.fileName} (product "${file.product.name}") -> storage/resources/`);
  }
  return { total: files.length, copied };
}

if (require.main === module) {
  const { prisma } = require("../src/db");
  migrateProductFiles()
    .then((summary) => console.log(`Done: copied ${summary.copied}/${summary.total} file(s).`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { migrateProductFiles };
