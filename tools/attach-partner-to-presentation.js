// Attaches an existing Partner Profile to an existing Private Presentation
// from the command line.
//
// The admin UI is the intended way to do this (Admin -> Private Presentations
// -> Edit -> Content -> Partner profile). This exists for the one case the UI
// cannot cover: setting the reference up before the code that renders the
// picker has been deployed, which is exactly the situation on the first
// rollout of this feature.
//
// It writes ONE key — content.partnerProfileId — and copies nothing else. The
// rest of the presentation's content blob is read and written back untouched,
// so the presentation product, hero copy, CTA links and section toggles are
// all preserved exactly.
//
//   node attach-partner-to-presentation.js --partner <slug|id> --presentation <slug|id>
//   node attach-partner-to-presentation.js --partner elena-cho --presentation <slug> --dry-run
//   node attach-partner-to-presentation.js --presentation <slug> --detach
const path = require("path");
const SERVER = path.join(__dirname, "..", "server");
const { prisma } = require(path.join(SERVER, "src", "db.js"));
const { normalizeContent } = require(path.join(SERVER, "src", "lib", "presentations.js"));

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const DRY = process.argv.includes("--dry-run");
const DETACH = process.argv.includes("--detach");

async function main() {
  const presRef = arg("--presentation");
  const partnerRef = arg("--partner");
  if (!presRef) throw new Error("--presentation <slug|id> is required");
  if (!partnerRef && !DETACH) throw new Error("--partner <slug|id> is required (or pass --detach)");

  const presentation = await prisma.privatePresentation.findFirst({
    where: { OR: [{ slug: presRef }, { id: presRef }] },
  });
  if (!presentation) throw new Error(`No presentation matching "${presRef}"`);

  let partner = null;
  if (!DETACH) {
    partner = await prisma.partner.findFirst({
      where: { OR: [{ slug: partnerRef }, { id: partnerRef }] },
    });
    if (!partner) throw new Error(`No partner profile matching "${partnerRef}"`);
    if (partner.status !== "published") {
      // Not fatal — the save path in the admin API accepts a draft too — but
      // the deck will not render it, so say so rather than leave it to be
      // discovered on the page.
      console.warn(`WARNING: partner "${partner.slug}" is ${partner.status}, not published.`);
      console.warn("         The reference will be saved but the deck will NOT show the section");
      console.warn("         until the profile is published.");
    }
  }

  // Read-modify-write of the whole blob, through the same normalizer the API
  // uses, so this script cannot produce a content shape the app would not.
  const before = normalizeContent(presentation.content);
  const after = { ...before, partnerProfileId: DETACH ? "" : partner.id };

  console.log(`presentation : ${presentation.title}  (${presentation.slug})`);
  console.log(`product      : ${after.featuredProductId || "(none)"}   [unchanged]`);
  console.log(`partner      : ${before.partnerProfileId || "(none)"}  ->  ${after.partnerProfileId || "(none)"}`);
  if (partner) console.log(`               ${partner.displayName} (${partner.slug}, ${partner.status})`);
  console.log(`sections.partner : ${after.sections.partner}`);

  if (DRY) {
    console.log("\n--dry-run: nothing written.");
    return;
  }
  if (before.partnerProfileId === after.partnerProfileId) {
    console.log("\nAlready set — nothing to write.");
    return;
  }

  await prisma.privatePresentation.update({
    where: { id: presentation.id },
    data: { content: after },
  });
  console.log(`\nSaved. Open /presentation/${presentation.slug} to see it.`);
}

main()
  .catch((err) => { console.error(String(err.message || err)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
