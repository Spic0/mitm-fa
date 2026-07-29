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
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
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
  function postForm(path, formData) {
    return request(path, { method: "POST", body: formData, isFormData: true });
  }
  function putForm(path, formData) {
    return request(path, { method: "PUT", body: formData, isFormData: true });
  }

  return {
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
    uploadLogo: function (formData) { return postForm("/api/admin/settings/logo", formData); },

    listOrders: function (params) { return get("/api/admin/orders?" + new URLSearchParams(params || {})); },
    getOrder: function (id) { return get("/api/admin/orders/" + id); },
    resendOrderEmail: function (id) { return post("/api/admin/orders/" + id + "/resend-email"); },
    refundOrder: function (id) { return post("/api/admin/orders/" + id + "/refund"); },
    addOrderNote: function (id, body) { return post("/api/admin/orders/" + id + "/notes", { body: body }); },

    listProducts: function (params) { return get("/api/admin/products?" + new URLSearchParams(params || {})); },
    getProduct: function (id) { return get("/api/admin/products/" + id); },
    createProduct: function (formData) { return postForm("/api/admin/products", formData); },
    updateProduct: function (id, formData) { return putForm("/api/admin/products/" + id, formData); },
    updateProductContent: function (id, body) { return put("/api/admin/products/" + id + "/content", body); },
    deleteProduct: function (id) { return del("/api/admin/products/" + id); },
    archiveProduct: function (id) { return post("/api/admin/products/" + id + "/archive"); },
    duplicateProduct: function (id) { return post("/api/admin/products/" + id + "/duplicate"); },

    uploadProductMedia: function (id, formData) { return postForm("/api/admin/products/" + id + "/media", formData); },

    // Public product-page gallery (the sales-page carousel). Distinct from
    // uploadProductMedia above, which is paid program content served through
    // the entitlement-gated /api/library/media.
    listProductGallery: function (id) { return get("/api/admin/products/" + id + "/gallery"); },
    uploadProductGallery: function (id, formData) { return postForm("/api/admin/products/" + id + "/gallery", formData); },
    reorderProductGallery: function (id, ids) { return put("/api/admin/products/" + id + "/gallery/order", { ids: ids }); },
    deleteProductGallery: function (id, mediaId) { return del("/api/admin/products/" + id + "/gallery/" + mediaId); },
    updateProductTaxonomy: function (id, nodeIds) { return put("/api/admin/products/" + id + "/taxonomy", { nodeIds: nodeIds }); },

    getTaxonomy: function () { return get("/api/admin/taxonomy"); },
    createTaxonomyNode: function (taxonomyId, body) { return post("/api/admin/taxonomy/" + taxonomyId + "/nodes", body); },
    updateTaxonomyNode: function (nodeId, body) { return put("/api/admin/taxonomy/nodes/" + nodeId, body); },
    deleteTaxonomyNode: function (nodeId) { return del("/api/admin/taxonomy/nodes/" + nodeId); },

    createProductFaq: function (id, body) { return post("/api/admin/products/" + id + "/faqs", body); },
    updateProductFaq: function (id, faqId, body) { return put("/api/admin/products/" + id + "/faqs/" + faqId, body); },
    deleteProductFaq: function (id, faqId) { return del("/api/admin/products/" + id + "/faqs/" + faqId); },

    createProductResource: function (id, formData) { return postForm("/api/admin/products/" + id + "/resources", formData); },
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
