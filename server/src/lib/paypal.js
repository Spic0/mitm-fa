const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

// Whether this deployment can actually take PayPal payments. Routes check
// this before calling anything here, so an unconfigured store answers 503
// with customer-facing copy instead of failing at PayPal's auth endpoint and
// surfacing the raw error at the moment someone tries to pay.
const isPaypalConfigured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

// amountCents: integer total in the smallest currency unit (cents for USD)
// customId: our PendingCheckout id, round-tripped by PayPal so capture can find it again
async function createOrder(amountCents, customId, currency = "USD") {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // Makes a retried create return the same PayPal order rather than a
      // second one — the PayPal counterpart to the Stripe idempotency key on
      // create-intent.
      "PayPal-Request-Id": `create_${customId}`,
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: customId,
          amount: {
            currency_code: currency,
            value: (amountCents / 100).toFixed(2),
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PayPal create order failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function captureOrder(orderId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      // A capture the buyer's browser retried (double tap, flaky connection)
      // returns the original capture instead of taking the money twice.
      "PayPal-Request-Id": `capture_${orderId}`,
    },
  });
  // A capture that has already happened comes back as a 422
  // ORDER_ALREADY_CAPTURED. That is not an error condition for us — the
  // webhook and the browser both capture, and whichever loses the race must
  // still be able to read the completed order and fulfill from it.
  if (res.status === 422) {
    const body = await res.text();
    if (body.includes("ORDER_ALREADY_CAPTURED")) return getOrder(orderId);
    throw new Error(`PayPal capture failed: ${res.status} ${body}`);
  }
  if (!res.ok) throw new Error(`PayPal capture failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Read-only lookup, used to reconcile an order whose capture response we
// never saw and to resolve the already-captured case above.
async function getOrder(orderId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`PayPal get order failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Reads a capture back. Its `supplementary_data.related_ids.order_id` is the
// v2 checkout order id we store as Order.providerRef — which is how a refund
// event (which references the capture, never the checkout order) is resolved
// back to our own order.
async function getCapture(captureId) {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/payments/captures/${captureId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`PayPal get capture failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Refunds a completed capture. amountCents omitted = full refund.
async function refundCapture(captureId, amountCents = null, currency = "USD") {
  const accessToken = await getAccessToken();
  const res = await fetch(`${PAYPAL_API_BASE}/v2/payments/captures/${captureId}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": `refund_${captureId}`,
    },
    body: JSON.stringify(
      amountCents == null
        ? {}
        : { amount: { currency_code: currency, value: (amountCents / 100).toFixed(2) } }
    ),
  });
  if (!res.ok) throw new Error(`PayPal refund failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Verifies a webhook delivery against PayPal's own verification endpoint.
//
// Unlike Stripe, PayPal has no local HMAC to check — the signature is over a
// certificate chain PayPal hosts, and the supported way to validate it is to
// hand the headers plus the parsed event back to PayPal and let it answer.
// That means one outbound call per delivery, which is why the caller
// deduplicates on event id BEFORE doing any work.
//
// Fails closed: any non-SUCCESS answer, any transport error, and a missing
// PAYPAL_WEBHOOK_ID all return false.
async function verifyWebhookSignature(headers, rawBody) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;

  const required = [
    "paypal-auth-algo",
    "paypal-cert-url",
    "paypal-transmission-id",
    "paypal-transmission-sig",
    "paypal-transmission-time",
  ];
  if (required.some((h) => !headers[h])) return false;

  try {
    const accessToken = await getAccessToken();
    const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: headers["paypal-auth-algo"],
        cert_url: headers["paypal-cert-url"],
        transmission_id: headers["paypal-transmission-id"],
        transmission_sig: headers["paypal-transmission-sig"],
        transmission_time: headers["paypal-transmission-time"],
        webhook_id: webhookId,
        // PayPal verifies against the event object, so this must be the
        // EXACT bytes delivered, re-parsed — not a re-serialization of a
        // body some other middleware already parsed and reordered.
        webhook_event: JSON.parse(rawBody.toString("utf8")),
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.verification_status === "SUCCESS";
  } catch (err) {
    console.error("PayPal webhook verification error:", err.message);
    return false;
  }
}

module.exports = {
  createOrder,
  captureOrder,
  getOrder,
  getCapture,
  refundCapture,
  verifyWebhookSignature,
  isPaypalConfigured,
  PAYPAL_API_BASE,
};
