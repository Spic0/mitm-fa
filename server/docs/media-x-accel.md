# Serving program media through nginx (X-Accel-Redirect)

Gated program media — the exercise demo GIFs and their derivatives under
`server/storage/media/<productId>/` — can be handed to nginx instead of being
streamed out of Node. This is **off by default** and takes two changes that
must be made together.

## Why

Without the offload, one demo image costs two authenticated round trips:

```
GET /api/library/media/:productId/:file    auth + hasEntitlement + mint token -> 302
GET /api/library/download/media/:token     auth + verify + hasEntitlement -> res.sendFile
```

Two requests, four DB queries (two session, two entitlement), and the bytes
themselves copied through the event loop. Measured against the largest real
program (`sulek-strength-size-peak`, 6 GIFs, 72.31 MB of originals on disk),
a customer paging through the whole handbook generates:

| | token path | with X-Accel |
|---|---|---|
| HTTP requests for media | 24 | 12 |
| DB queries for media | ~48 | ~24 |
| media bytes through Node | 1.17 MB | 0 |

The bytes are the part that matters under concurrency. They are immutable,
UUID-named, and on local disk — nginx serves them with `sendfile()` and Node
never sees them.

Note this is a *concurrency* win, not a bandwidth one. The progressive
loading in `lib/animatedMedia.js` + `assets/js/program-viewer.js` already got
the transfer from 72.31 MB down to 1.17 MB; this change is about who does the
work, not how much of it there is.

## 1. nginx

Add to the `server` block in `/etc/nginx/conf.d/mitm-fa.conf`, alongside the
existing `location /`:

```nginx
    # Gated program media, handed over by X-Accel-Redirect from
    # /api/library/media/*. `internal` is what makes this safe: nginx will
    # only ever serve it in response to that header, never to a client who
    # types the path in. Authorization stays entirely in Node.
    location /internal-media/ {
        internal;
        alias /var/www/mitm-fa/server/storage/media/;

        # Node sets Cache-Control (private, max-age=60) and, for SVG, a CSP
        # sandbox. Do not add expires/add_header here — the route that
        # authorizes the file is what decides how it may be cached.
    }
```

Both trailing slashes matter: `alias` without one will concatenate wrongly and
serve the wrong file.

The path is absolute and points at the **production checkout**. `storage/` is
gitignored and per-checkout, so a spare-port QA instance running from
`/root/work-mobile-sprint` has its own (stub) media directory and must not
have the flag enabled unless this path is pointed somewhere else.

Then:

```
nginx -t && systemctl reload nginx
```

## 2. Node

Set in `server/.env`:

```
MEDIA_X_ACCEL=true
```

and restart (`pm2 restart profit-server`).

## Order of operations

nginx **first**, Node second. With the flag on and no `internal` location
defined, nginx does not recognise the header, and the customer gets an empty
200 and a broken image. The reverse order is harmless: the `internal` location
simply never gets used until the flag flips.

To roll back, unset `MEDIA_X_ACCEL` and restart — the signed-token path in
`routes/library.js` is still there and still works. It is deliberately kept
live even when the flag is on, because tokens already minted stay valid for
15 minutes and a `<video>` element re-requests its `src` while seeking.

## What is NOT offloaded

`/api/library/download/resource/:token` still goes through `res.download` —
bonus resources are small, rarely fetched, and need a `Content-Disposition`
filename that differs from the stored one. Nothing here changes that.

## Test

`cd tools && node test-media-x-accel.js` covers both flag states, variant
resolution, the SVG sandbox, and — the case that matters — that an unentitled
caller is still refused *before* any accel header is written.
