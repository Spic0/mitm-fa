const { logPaymentEvent } = require("./paymentLog");
const { fulfillOrder } = require("./fulfillOrder");
const { loadSnapshotForFulfillment, markSnapshotConsumed } = require("./checkoutSnapshot");

// The PayPal counterpart to stripeFulfillment.js. Shared by the browser's
// capture call (routes/checkout.js) and the PayPal webhook
// (routes/webhooksPaypal.js), so a payment fulfills exactly the same way
// whether or not the buyer's browser ever came back. fulfillOrder is
// idempotent on providerRef, so both running is fine.
async function fulfillFromPaypalCapture(capture, orderId) {
  const unit = capture.purchase_units && capture.purchase_units[0];
  const captureRecord = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
  const customId = (captureRecord && captureRecord.custom_id) || (unit && unit.custom_id);

  const snapshot = customId ? await loadSnapshotForFulfillment(customId) : null;
  if (!snapshot) throw new Error("Checkout session not found");

  // What PayPal says actually moved, in cents. This is what the Order
  // records — a figure recomputed from the catalog could disagree with the
  // customer's PayPal receipt.
  const capturedCents = captureRecord && captureRecord.amount
    ? Math.round(parseFloat(captureRecord.amount.value) * 100)
    : null;
  const capturedCurrency = captureRecord && captureRecord.amount ? captureRecord.amount.currency_code : null;

  // A capture that doesn't match what we quoted is not a reason to withhold
  // access — the money has already moved and the buyer is owed their product
  // — but it IS a reason to leave a loud, permanent record, because the only
  // ways it happens are a bug on our side or tampering.
  if (capturedCents != null && capturedCents !== snapshot.snapshotTotalCents) {
    await logPaymentEvent({
      provider: "paypal",
      eventType: "checkout.amount_mismatch",
      status: "failed",
      providerRef: orderId,
      customerEmail: snapshot.email,
      providerResponse: {
        quotedCents: snapshot.snapshotTotalCents,
        capturedCents,
        capturedCurrency,
      },
    });
  }

  const result = await fulfillOrder({
    email: snapshot.email,
    customer: snapshot.customer,
    provider: "paypal",
    providerRef: orderId,
    items: snapshot.items,
    totalCents: capturedCents == null ? snapshot.totalCents : capturedCents,
    discountCents: snapshot.discountCents,
    promotionId: snapshot.promotionId,
    appliedPromotions: snapshot.appliedPromotions,
  });

  await markSnapshotConsumed(customId, { provider: "paypal", providerRef: orderId });

  if (!result.alreadyFulfilled) {
    await logPaymentEvent({
      provider: "paypal",
      eventType: "checkout.capture",
      status: "succeeded",
      providerRef: orderId,
      customerEmail: snapshot.email,
      orderId: result.order.id,
      providerResponse: { status: capture.status, capturedCents, capturedCurrency },
    });
  }

  return result;
}

module.exports = { fulfillFromPaypalCapture };
