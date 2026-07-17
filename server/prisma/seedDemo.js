const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_COUNT = 100;
const ORDER_COUNT = 250;
const PROVIDERS = ["stripe", "paypal"];

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew", "Sam", "Chris"];
const LAST_NAMES = ["Smith", "Johnson", "Lee", "Brown", "Garcia", "Martinez", "Davis", "Clark", "Lewis", "Walker", "Young", "Allen"];
const COUNTRIES = ["US", "GB", "CA", "AU", "DE", "FR"];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPastDate(maxDaysAgo) {
  return new Date(Date.now() - Math.floor(Math.random() * maxDaysAgo) * DAY_MS - Math.floor(Math.random() * DAY_MS));
}

// Populates realistic demo data (customers, orders, revenue/payment history)
// so every dashboard widget has something to render. Assumes `npm run seed`
// has already created the product catalog. Safe to re-run — it always adds a
// fresh batch on top rather than trying to reconcile with existing rows.
async function seedDemoData() {
  const { prisma } = require("../src/db");
  const products = await prisma.product.findMany();
  if (products.length === 0) {
    throw new Error("No products found — run `npm run seed` before seeding demo data.");
  }

  const customers = [];
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const name = `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
    const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${crypto.randomBytes(3).toString("hex")}@example.com`;
    const customer = await prisma.user.create({
      data: {
        name,
        email,
        role: "customer",
        country: randomItem(COUNTRIES),
        createdAt: randomPastDate(180),
      },
    });
    customers.push(customer);
  }

  let ordersCreated = 0;
  for (let i = 0; i < ORDER_COUNT; i++) {
    const customer = randomItem(customers);
    const itemCount = 1 + Math.floor(Math.random() * 3);
    const chosenProducts = Array.from({ length: itemCount }, () => randomItem(products));
    const totalCents = chosenProducts.reduce((sum, p) => sum + p.priceCents, 0);
    const roll = Math.random();
    const status = roll < 0.85 ? "paid" : roll < 0.95 ? "pending" : "failed";
    const createdAt = randomPastDate(180);

    await prisma.order.create({
      data: {
        userId: customer.id,
        provider: randomItem(PROVIDERS),
        providerRef: `demo_${crypto.randomUUID()}`,
        status,
        deliveryStatus: status === "paid" ? "delivered" : "pending",
        totalCents,
        createdAt,
        items: {
          create: chosenProducts.map((p) => ({ productId: p.id, priceCents: p.priceCents })),
        },
      },
    });
    ordersCreated++;
  }

  return { customersCreated: customers.length, ordersCreated };
}

if (require.main === module) {
  const { prisma } = require("../src/db");
  seedDemoData()
    .then((summary) => {
      console.log(`Seeded demo data: ${summary.customersCreated} customers, ${summary.ordersCreated} orders.`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { seedDemoData };
