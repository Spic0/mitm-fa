const { prisma } = require("../db");

// Records one row per payment provider event (Stripe webhook, PayPal capture)
// so the admin Payment Logs page has a full audit trail independent of
// whether the event resulted in a fulfilled order. Never throws — logging
// must not break the payment flow it's observing.
async function logPaymentEvent({ provider, eventType, status, providerRef, customerEmail, orderId, providerResponse }) {
  try {
    await prisma.paymentEvent.create({
      data: {
        provider,
        eventType,
        status,
        providerRef: providerRef || null,
        customerEmail: customerEmail || null,
        orderId: orderId || null,
        providerResponse: providerResponse ? JSON.stringify(providerResponse) : null,
      },
    });
  } catch (err) {
    console.error("Failed to write PaymentEvent:", err);
  }
}

module.exports = { logPaymentEvent };
