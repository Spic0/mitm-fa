// Thin fetch wrapper for the admin API, mirroring window.ProFitAPI's pattern
// in assets/js/api.js. Cookies (the session) ride along automatically.
window.AdminAPI = (function () {
  function readCookie(name) {
    const match = document.cookie.match("(?:^|; )" + name + "=([^;]*)");
    return match ? decodeURIComponent(match[1]) : "";
  }

  const SAFE_METHODS = { GET: true, HEAD: true };

  async function request(path, options) {
    const method = (options && options.method) || "GET";
    const headers = options && options.isFormData ? {} : { "Content-Type": "application/json" };
    if (!SAFE_METHODS[method]) headers["X-CSRF-Token"] = readCookie("profit_csrf");
    const res = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: headers,
    });

    // 204/205 are the only responses that are MEANT to have no body. Nothing
    // behind AdminAPI returns one today, but treating them as an empty object
    // is correct rather than an error if one ever does.
    if (res.status === 204 || res.status === 205) {
      if (!res.ok) throw new Error("Request failed");
      return {};
    }

    const raw = await res.text();
    let data = null;
    let parsed = false;
    if (raw) {
      try { data = JSON.parse(raw); parsed = true; } catch (err) { /* handled below */ }
    }

    if (!res.ok) {
      // An error response is allowed to be unparseable — nginx answers some
      // conditions (413 in particular) with its own HTML page, which is why
      // this falls back to a status-shaped message rather than insisting on
      // an { error } field.
      throw new Error(
        (parsed && data && data.error) ||
        (res.status === 401 || res.status === 403
          ? "Your session has expired. Reload the page and sign in again."
          : "Request failed (HTTP " + res.status + ").")
      );
    }

    // A 2xx whose body is empty or is not JSON is a BROKEN response, not a
    // successful one — a truncated reply, or an intermediary answering in
    // place of the app. This used to be swallowed into `{}` and returned as
    // success, so the caller went on to read a field off it and died with
    // "Cannot read properties of undefined (reading 'length')" — a message
    // that says nothing about what actually went wrong, on a page that had
    // already sat on a loading skeleton until the request gave up.
    if (!parsed || data === null || typeof data !== "object") {
      throw new Error("The server sent an incomplete response. Check your connection and reload the page.");
    }
    return data;
  }

  // Reads a list off a response, insisting it really is a list.
  //
  // Every admin table did `data.<key>.length` and `data.<key>.forEach` on the
  // raw response. That is correct exactly while the server sends the shape the
  // caller assumed, and an unguarded TypeError the moment it doesn't. request()
  // above now rejects malformed responses, so this only fires on a genuine
  // contract mismatch (a renamed field, an endpoint returning `{ ok: true }`),
  // where a clear message beats a stack trace about `undefined`.
  function rows(data, key) {
    const value = data ? data[key] : undefined;
    if (Array.isArray(value)) return value;
    throw new Error("The server sent an unexpected response for " + key + ". Reload the page and try again.");
  }

  function get(path) {
    return request(path, { method: "GET" });
  }
  function post(path, body) {
    return request(path, { method: "POST", body: JSON.stringify(body || {}) });
  }
  function put(path, body) {
    return request(path, { method: "PUT", body: JSON.stringify(body || {}) });
  }
  function patch(path, body) {
    return request(path, { method: "PATCH", body: JSON.stringify(body || {}) });
  }
  function del(path) {
    return request(path, { method: "DELETE" });
  }
  // File uploads go through XMLHttpRequest rather than fetch, for one reason:
  // fetch has no upload-progress event. There is no way to observe how much of
  // a request body has been sent with it, so a 100MB video upload through
  // fetch is an indistinguishable hang. XHR's upload.onprogress is still the
  // only way to drive a real progress bar in a browser.
  //
  // onProgress is called with a 0-100 percentage, or null when the body length
  // isn't computable (rare, but don't fake a number in that case — the caller
  // shows an indeterminate state instead).
  function formRequest(method, path, formData, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, path, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("X-CSRF-Token", readCookie("profit_csrf"));
      // Never set Content-Type for FormData — the browser has to add the
      // multipart boundary itself.

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = function (e) {
          onProgress(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : null, e.loaded, e.total);
        };
      }

      xhr.onload = function () {
        var data = {};
        try {
          data = JSON.parse(xhr.responseText || "{}");
        } catch (e) {
          // Not JSON. The important case: nginx rejects an over-limit body
          // itself, before the request ever reaches the app, and answers with
          // its own HTML error page. Parsing that as JSON gives nothing, so
          // without this branch the user sees "Request failed" for what is
          // actually a specific, explainable condition.
          data = {};
        }

        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);

        var message = data.error;
        if (!message) {
          if (xhr.status === 413) {
            message = "That file is too large to upload. The limit is 100MB per file.";
          } else if (xhr.status === 401 || xhr.status === 403) {
            message = "Your session expired. Reload the page and sign in again.";
          } else if (xhr.status === 0) {
            message = "The connection dropped during the upload. Check your connection and try again.";
          } else if (xhr.status >= 500) {
            message = "The server couldn't process that file. Try again, or use a different file.";
          } else {
            message = "Upload failed (HTTP " + xhr.status + ").";
          }
        }
        var err = new Error(message);
        err.status = xhr.status;
        reject(err);
      };

      xhr.onerror = function () {
        var err = new Error("The upload failed to reach the server. Check your connection and try again.");
        err.status = 0;
        reject(err);
      };
      xhr.ontimeout = function () {
        var err = new Error("The upload timed out. A large file on a slow connection can take a while — try again.");
        err.status = 0;
        reject(err);
      };
      xhr.onabort = function () {
        var err = new Error("Upload cancelled.");
        err.status = 0;
        err.aborted = true;
        reject(err);
      };

      xhr.send(formData);
      if (onProgress) onProgress(0, 0, 0);
    });
  }

  function postForm(path, formData, onProgress) {
    return formRequest("POST", path, formData, onProgress);
  }
  function putForm(path, formData, onProgress) {
    return formRequest("PUT", path, formData, onProgress);
  }

  return {
    rows: rows,
    me: function () { return get("/api/auth/me"); },
    getConfig: function () { return get("/api/config"); },
    requestMagicLink: function (email) { return post("/api/auth/magic-link", { email: email }); },
    loginWithPassword: function (email, password) { return post("/api/auth/login-password", { email: email, password: password }); },
    logout: function () { return post("/api/auth/logout"); },

    getDashboardOverview: function () { return get("/api/admin/dashboard/overview"); },
    getAnalytics: function (range) { return get("/api/admin/analytics/overview?range=" + encodeURIComponent(range || "30d")); },

    listEmailLogs: function (params) { return get("/api/admin/email-logs?" + new URLSearchParams(params || {})); },

    listPaymentLogs: function (params) { return get("/api/admin/payment-logs?" + new URLSearchParams(params || {})); },

    listSystemLogs: function (params) { return get("/api/admin/system-logs?" + new URLSearchParams(params || {})); },

    getSettings: function () { return get("/api/admin/settings"); },
    updateSettings: function (body) { return put("/api/admin/settings", body); },
    uploadLogo: function (formData, onProgress) { return postForm("/api/admin/settings/logo", formData, onProgress); },

    listOrders: function (params) { return get("/api/admin/orders?" + new URLSearchParams(params || {})); },
    getOrder: function (id) { return get("/api/admin/orders/" + id); },
    resendOrderEmail: function (id) { return post("/api/admin/orders/" + id + "/resend-email"); },
    refundOrder: function (id) { return post("/api/admin/orders/" + id + "/refund"); },
    addOrderNote: function (id, body) { return post("/api/admin/orders/" + id + "/notes", { body: body }); },

    listProducts: function (params) { return get("/api/admin/products?" + new URLSearchParams(params || {})); },
    getProduct: function (id) { return get("/api/admin/products/" + id); },
    createProduct: function (formData, onProgress) { return postForm("/api/admin/products", formData, onProgress); },
    updateProduct: function (id, formData, onProgress) { return putForm("/api/admin/products/" + id, formData, onProgress); },
    updateProductContent: function (id, body) { return put("/api/admin/products/" + id + "/content", body); },
    deleteProduct: function (id) { return del("/api/admin/products/" + id); },
    archiveProduct: function (id) { return post("/api/admin/products/" + id + "/archive"); },
    // Full clone — content, FAQs, bonus resources, gallery and every exercise
    // demo file. `name` optionally names the clone up front ("… Women's
    // Edition") so it doesn't land as "(Copy)".
    duplicateProduct: function (id, name) { return post("/api/admin/products/" + id + "/duplicate", name ? { name: name } : {}); },

    uploadProductMedia: function (id, formData, onProgress) { return postForm("/api/admin/products/" + id + "/media", formData, onProgress); },

    // Public product-page gallery (the sales-page carousel). Distinct from
    // uploadProductMedia above, which is paid program content served through
    // the entitlement-gated /api/library/media.
    listProductGallery: function (id) { return get("/api/admin/products/" + id + "/gallery"); },
    uploadProductGallery: function (id, formData, onProgress) { return postForm("/api/admin/products/" + id + "/gallery", formData, onProgress); },
    reorderProductGallery: function (id, ids) { return put("/api/admin/products/" + id + "/gallery/order", { ids: ids }); },
    deleteProductGallery: function (id, mediaId) { return del("/api/admin/products/" + id + "/gallery/" + mediaId); },
    updateProductTaxonomy: function (id, nodeIds) { return put("/api/admin/products/" + id + "/taxonomy", { nodeIds: nodeIds }); },

    // ---- Product Builder ----
    listBuilderTemplates: function () { return get("/api/admin/builder/templates"); },
    createBuilderTemplate: function (body) { return post("/api/admin/builder/templates", body); },
    updateBuilderTemplate: function (id, body) { return put("/api/admin/builder/templates/" + id, body); },
    deleteBuilderTemplate: function (id) { return del("/api/admin/builder/templates/" + id); },
    listMediaLibrary: function (params) { return get("/api/admin/builder/media-library?" + new URLSearchParams(params || {})); },
    // Reusing a gated demo file in another product copies it server-side —
    // the gated URL authorizes on the product id it embeds, so sharing one
    // would 403 for anyone who only bought the second product.
    reuseProductMedia: function (id, body) { return post("/api/admin/builder/products/" + id + "/media/reuse", body); },
    reuseGalleryMedia: function (id, url, opts) {
      return post("/api/admin/builder/products/" + id + "/gallery/reuse", { url: url, asSlide: !(opts && opts.asSlide === false) });
    },

    getTaxonomy: function () { return get("/api/admin/taxonomy"); },
    createTaxonomyNode: function (taxonomyId, body) { return post("/api/admin/taxonomy/" + taxonomyId + "/nodes", body); },
    updateTaxonomyNode: function (nodeId, body) { return put("/api/admin/taxonomy/nodes/" + nodeId, body); },
    deleteTaxonomyNode: function (nodeId) { return del("/api/admin/taxonomy/nodes/" + nodeId); },

    createProductFaq: function (id, body) { return post("/api/admin/products/" + id + "/faqs", body); },
    updateProductFaq: function (id, faqId, body) { return put("/api/admin/products/" + id + "/faqs/" + faqId, body); },
    deleteProductFaq: function (id, faqId) { return del("/api/admin/products/" + id + "/faqs/" + faqId); },

    createProductResource: function (id, formData, onProgress) { return postForm("/api/admin/products/" + id + "/resources", formData, onProgress); },
    deleteProductResource: function (id, resourceId) { return del("/api/admin/products/" + id + "/resources/" + resourceId); },

    createCustomer: function (body) { return post("/api/admin/customers", body); },
    listCustomers: function (params) { return get("/api/admin/customers?" + new URLSearchParams(params || {})); },
    getCustomer: function (id) { return get("/api/admin/customers/" + id); },
    suspendCustomer: function (id) { return post("/api/admin/customers/" + id + "/suspend"); },
    resetCustomerLogin: function (id) { return post("/api/admin/customers/" + id + "/reset-login"); },
    sendCustomerEmail: function (id, subject, body) { return post("/api/admin/customers/" + id + "/send-email", { subject: subject, body: body }); },

    listPromotions: function (params) { return get("/api/admin/promotions?" + new URLSearchParams(params || {})); },
    getPromotion: function (id) { return get("/api/admin/promotions/" + id); },
    createPromotion: function (body) { return post("/api/admin/promotions", body); },
    updatePromotion: function (id, body) { return patch("/api/admin/promotions/" + id, body); },
    deletePromotion: function (id) { return del("/api/admin/promotions/" + id); },
    clonePromotion: function (id) { return post("/api/admin/promotions/" + id + "/clone"); },
    pausePromotion: function (id) { return post("/api/admin/promotions/" + id + "/pause"); },
    resumePromotion: function (id) { return post("/api/admin/promotions/" + id + "/resume"); },
    expirePromotion: function (id) { return post("/api/admin/promotions/" + id + "/expire"); },
    getPromotionAnalytics: function (id) { return get("/api/admin/promotions/" + id + "/analytics"); },
    getPromotionAuditLog: function (id) { return get("/api/admin/promotions/" + id + "/audit-log"); },

    listPresentations: function (params) { return get("/api/admin/presentations?" + new URLSearchParams(params || {})); },
    getPresentation: function (id) { return get("/api/admin/presentations/" + id); },
    createPresentation: function (body) { return post("/api/admin/presentations", body); },
    updatePresentation: function (id, body) { return patch("/api/admin/presentations/" + id, body); },
    deletePresentation: function (id) { return del("/api/admin/presentations/" + id); },
    duplicatePresentation: function (id) { return post("/api/admin/presentations/" + id + "/duplicate"); },
    regeneratePresentationLink: function (id) { return post("/api/admin/presentations/" + id + "/regenerate-link"); },

    // ---- Partner Profiles ----
    // Child collections (socials/links/products) are sent as whole ordered
    // arrays on the partner PATCH, not through per-row endpoints — see
    // server/src/routes/admin/partners.js for why.
    listPartners: function (params) { return get("/api/admin/partners?" + new URLSearchParams(params || {})); },
    getPartner: function (id) { return get("/api/admin/partners/" + id); },
    getPartnerPreview: function (id) { return get("/api/admin/partners/" + id + "/preview"); },
    createPartner: function (body) { return post("/api/admin/partners", body); },
    updatePartner: function (id, body) { return patch("/api/admin/partners/" + id, body); },
    deletePartner: function (id) { return del("/api/admin/partners/" + id); },
    publishPartner: function (id) { return post("/api/admin/partners/" + id + "/publish"); },
    unpublishPartner: function (id) { return post("/api/admin/partners/" + id + "/unpublish"); },
    archivePartner: function (id) { return post("/api/admin/partners/" + id + "/archive"); },
    uploadPartnerAvatar: function (id, formData, onProgress) { return postForm("/api/admin/partners/" + id + "/avatar", formData, onProgress); },
    listPartnerProductOptions: function (search) {
      return get("/api/admin/partners/product-options?" + new URLSearchParams(search ? { search: search } : {}));
    },

    listInfluencers: function (params) { return get("/api/admin/influencers?" + new URLSearchParams(params || {})); },
    createInfluencer: function (body) { return post("/api/admin/influencers", body); },
    updateInfluencer: function (id, body) { return patch("/api/admin/influencers/" + id, body); },
    deleteInfluencer: function (id) { return del("/api/admin/influencers/" + id); },

    listPromotionNotifications: function () { return get("/api/admin/promotion-notifications"); },
    dismissPromotionNotification: function (id) { return post("/api/admin/promotion-notifications/" + id + "/dismiss"); },
    snoozePromotionNotification: function (id, hours) { return post("/api/admin/promotion-notifications/" + id + "/snooze", { hours: hours }); },
    markPromotionNotificationDone: function (id) { return post("/api/admin/promotion-notifications/" + id + "/mark-done"); },

    devLoginAsAdmin: function () { return post("/api/dev/login-as-admin"); },
    devCreateTestCustomer: function () { return post("/api/dev/create-test-customer"); },
    devSimulatePurchase: function (customerId, productId) { return post("/api/dev/simulate-purchase", { customerId: customerId, productId: productId }); },
    devSeed: function () { return post("/api/dev/seed"); },
  };
})();
