# /.well-known/

Domain-verification files that a third party fetches over plain HTTP to prove
we control `fitness.agency`. Files here are served by an explicit route in
`server/src/index.js` — the main static handler sets `dotfiles: "deny"` (which
is what closes `/.git/*` and `/.env`) and would otherwise 404 everything in
here too.

Anything placed in this directory is **publicly readable**. Only put
verification tokens here — never a key, never a secret.

## Apple Pay

Stripe verifies the domain by fetching

    https://fitness.agency/.well-known/apple-developer-merchantid-domain-association

Download that file from
**Stripe Dashboard → Settings → Payments → Payment methods → Apple Pay →
Add a new domain**, drop it in this directory (no extension), deploy, then
press Verify in the dashboard.

Until that succeeds, Apple Pay silently does not appear in the Payment
Element — there is no error anywhere to tell you why.

Check it landed:

    curl -i https://fitness.agency/.well-known/apple-developer-merchantid-domain-association

A 200 with the token as the body is correct. A 404 means either the file
isn't here or the deploy didn't reach production.

Google Pay needs no equivalent file — it requires only HTTPS and the card
wallet being enabled in the Stripe dashboard.
