(() => {
  const app = document.getElementById("customerApp");
  if (!app) return;

  const K = window.KABAB;
  const services = K.firebaseReady();
  const db = services && services.db;
  const state = {
    categories: read("kd_cached_categories", []),
    items: read("kd_cached_items", []),
    settings: read("kd_cached_settings", K.settingsSeed),
    cart: read("kd_customer_cart", []),
    customer: { name: "", phone: "", address: "", notes: "", lat: "", lng: "", mapsUrl: "", ...read("kd_customer_data", {}) },
    orderType: localStorage.getItem("kd_order_type") || "takeaway",
    screen: "orderType",
    tableNumber: localStorage.getItem("kd_table_number") || "",
    view: "categories",
    selectedCategory: "",
    selectedItem: null,
    lastOrderId: localStorage.getItem("kd_last_order_id") || "",
    lastOrder: null,
    message: "",
    firebaseError: "",
    isSending: false,
    remoteCategoryCount: 0,
    remoteItemCount: 0,
    route: read("kd_customer_route", null),
    routeLoading: false,
    routeError: "",
    routeTimer: null,
    errors: {}
  };

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }
  function save() {
    localStorage.setItem("kd_customer_cart", JSON.stringify(state.cart));
    localStorage.setItem("kd_customer_data", JSON.stringify(state.customer));
    if (state.route) localStorage.setItem("kd_customer_route", JSON.stringify(state.route));
    localStorage.setItem("kd_order_type", state.orderType);
    localStorage.setItem("kd_table_number", state.tableNumber);
  }
  function activeCategories() {
    return K.sortByOrder(state.categories.filter(c => c.deleted !== true && c.active !== false && c.hidden !== true && !(state.orderType === "dinein" && c.id === "weight")));
  }
  function activeItems(categoryId) {
    return K.sortByOrder(state.items.filter(i => i.deleted !== true && i.categoryId === categoryId && i.visible !== false && i.available !== false && hasAvailableOption(i)));
  }
  function hasAvailableOption(item) {
    const options = item.options || [];
    return options.length === 0 || options.some(o => o.available !== false);
  }
  function itemPrice(item) {
    const option = (item.options || []).find(o => o.available !== false) || {};
    return Number(option.price || 0);
  }
  function cleanIraqiPhone(raw) {
    let value = String(raw || "").trim().replace(/[^\d+]/g, "");
    if (value.startsWith("+")) value = value.slice(1);
    if (value.startsWith("00")) value = value.slice(2);
    if (value.startsWith("964")) return value;
    if (value.startsWith("07")) return `964${value.slice(1)}`;
    return value;
  }
  function isValidIraqiPhone(raw) {
    return /^9647\d{9}$/.test(cleanIraqiPhone(raw));
  }
  function customerField(name, label, type = "text", extra = "") {
    const error = state.errors[name];
    return `<label class="${error ? "field-error" : ""}">${label}<input ${type ? `type="${type}"` : ""} data-customer="${name}" value="${escapeHtml(state.customer[name] || "")}" ${extra}>${error ? `<small class="input-error">${escapeHtml(error)}</small>` : ""}</label>`;
  }
  function customerTextarea(name, label, extra = "") {
    const error = state.errors[name];
    return `<label class="${error ? "field-error" : ""}">${label}<textarea data-customer="${name}" ${extra}>${escapeHtml(state.customer[name] || "")}</textarea>${error ? `<small class="input-error">${escapeHtml(error)}</small>` : ""}</label>`;
  }
  function totals() {
    const subtotal = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const distance = Number(state.route?.distanceKm || 0);
    let deliveryFee = 0;
    let rawDeliveryFee = 0;
    let roundedDeliveryFee = 0;
    let roundingMethod = state.settings.deliveryRounding || "nearest_250_up";
    if (state.orderType === "delivery") {
      if (state.settings.deliveryRouteEnabled !== false && distance) {
        const fee = K.deliveryFeeBreakdown(distance, state.settings);
        rawDeliveryFee = fee.rawDeliveryFee;
        roundedDeliveryFee = fee.roundedDeliveryFee;
        roundingMethod = fee.roundingMethod;
        deliveryFee = roundedDeliveryFee;
      } else {
        deliveryFee = Number(state.settings.deliveryFee || 0);
        rawDeliveryFee = deliveryFee;
        roundedDeliveryFee = deliveryFee;
      }
    }
    return {
      subtotal,
      deliveryFee,
      rawDeliveryFee,
      roundedDeliveryFee,
      roundingMethod,
      total: subtotal + deliveryFee,
      distance,
      durationMin: Number(state.route?.durationMin || 0)
    };
  }
  function routeKey() {
    return [
      state.settings.restaurantLat,
      state.settings.restaurantLng,
      state.customer.lat,
      state.customer.lng,
      state.settings.mapProvider,
      state.settings.mapApiKey
    ].join("|");
  }
  function validCoords(lat, lng) {
    const a = Number(lat);
    const b = Number(lng);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180;
  }
  function parseMapsLink(value) {
    const text = String(value || "");
    const atMatch = text.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    const qMatch = text.match(/[?&](?:q|query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    const rawMatch = text.match(/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    const match = atMatch || qMatch || rawMatch;
    if (!match) return null;
    return { lat: match[1], lng: match[2] };
  }
  async function requestRoute() {
    if (state.orderType !== "delivery" || state.settings.deliveryRouteEnabled === false) return;
    const start = { lat: Number(state.settings.restaurantLat), lng: Number(state.settings.restaurantLng) };
    const end = { lat: Number(state.customer.lat), lng: Number(state.customer.lng) };
    if (!validCoords(start.lat, start.lng) || !validCoords(end.lat, end.lng)) {
      state.route = null;
      state.routeError = "";
      render();
      return;
    }
    const key = routeKey();
    if (state.route?.key === key) return;
    state.routeLoading = true;
    state.routeError = "";
    render();
    try {
      const route = await fetchRouteDistance(start, end);
      const fee = K.deliveryFeeBreakdown(route.distanceKm, state.settings);
      state.route = { ...route, ...fee, deliveryFee: fee.roundedDeliveryFee, calculatedAtMs: Date.now() };
      state.routeError = "";
      save();
    } catch (error) {
      console.error("Route distance failed", error);
      state.route = null;
      state.routeError = error.message || "تعذر حساب مسافة الطريق.";
    } finally {
      state.routeLoading = false;
      render();
    }
  }
  async function fetchRouteDistance(start, end) {
    const provider = state.settings.mapProvider || "osrm";
    const apiKey = state.settings.mapApiKey || "";
    if (provider === "openrouteservice") {
      if (!apiKey) throw new Error("أضف مفتاح OpenRouteService من لوحة التحكم.");
      const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${encodeURIComponent(apiKey)}&start=${start.lng},${start.lat}&end=${end.lng},${end.lat}`;
      const data = await fetchJson(url);
      const summary = data.features?.[0]?.properties?.summary;
      if (!summary) throw new Error("لم يتم العثور على مسار توصيل.");
      return { provider, distanceKm: summary.distance / 1000, durationMin: Math.round(summary.duration / 60), routeGeometry: data.features?.[0]?.geometry || null };
    }
    if (provider === "mapbox") {
      if (!apiKey) throw new Error("أضف مفتاح Mapbox من لوحة التحكم.");
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${end.lng},${end.lat}?geometries=geojson&overview=full&access_token=${encodeURIComponent(apiKey)}`;
      const data = await fetchJson(url);
      const route = data.routes?.[0];
      if (!route) throw new Error("لم يتم العثور على مسار توصيل.");
      return { provider, distanceKm: route.distance / 1000, durationMin: Math.round(route.duration / 60), routeGeometry: route.geometry || null };
    }
    if (provider === "google") {
      if (!apiKey) throw new Error("أضف مفتاح Google Directions API من لوحة التحكم.");
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.lat},${start.lng}&destination=${end.lat},${end.lng}&mode=driving&key=${encodeURIComponent(apiKey)}`;
      const data = await fetchJson(url);
      const leg = data.routes?.[0]?.legs?.[0];
      if (!leg) throw new Error("لم يتم العثور على مسار توصيل أو أن Google Directions محجوب من المتصفح.");
      return { provider, distanceKm: leg.distance.value / 1000, durationMin: Math.round(leg.duration.value / 60), routeGeometry: data.routes?.[0]?.overview_polyline?.points || "" };
    }
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    const data = await fetchJson(url);
    const route = data.routes?.[0];
    if (!route) throw new Error("لم يتم العثور على مسار توصيل.");
    return { provider: "osrm", distanceKm: route.distance / 1000, durationMin: Math.round(route.duration / 60), routeGeometry: route.geometry || null };
  }
  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`فشل الاتصال بمزود الخرائط (${response.status}).`);
    return response.json();
  }
  function scheduleRouteCalculation() {
    clearTimeout(state.routeTimer);
    state.routeTimer = setTimeout(requestRoute, 650);
  }
  function routeGeometryForStorage() {
    if (!state.route?.routeGeometry) return "";
    try {
      return JSON.stringify(state.route.routeGeometry);
    } catch (error) {
      console.warn("Route geometry stringify failed", error);
      return "";
    }
  }
  function setMessage(text, type = "notice") {
    state.message = text ? `<div class="${type}">${text}</div>` : "";
    render();
  }
  function applyMenuPayload(payload) {
    if (!payload) return;
    if (Array.isArray(payload.categories)) {
      state.categories = payload.categories;
      localStorage.setItem("kd_cached_categories", JSON.stringify(state.categories));
    }
    if (Array.isArray(payload.items)) {
      state.items = payload.items;
      localStorage.setItem("kd_cached_items", JSON.stringify(state.items));
    }
    if (payload.settings) {
      state.settings = { ...K.settingsSeed, ...payload.settings };
      localStorage.setItem("kd_cached_settings", JSON.stringify(state.settings));
    }
    render();
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }

  function render() {
    save();
    const t = totals();
    const settings = state.settings;
    if (state.screen === "welcome") {
      app.className = "customer-shell intro-shell";
      app.innerHTML = WelcomeScreen(settings);
      return;
    }
    if (state.screen === "orderType") {
      app.className = "customer-shell intro-shell";
      app.innerHTML = OrderTypeSelector(settings);
      return;
    }
    app.className = "customer-shell";
    app.innerHTML = `
      <header class="customer-header">
        <div class="header-inner">
          <div class="brand">
            ${settings.logoUrl ? `<img class="logo" src="${escapeHtml(settings.logoUrl)}" alt="">` : `<div class="logo">ك</div>`}
            <div><h1>${escapeHtml(settings.restaurantName || "كباب الديرة")}</h1><p>${settings.isOpen ? "مفتوح الآن 🔥" : "مغلق حالياً"} · ${escapeHtml(settings.address || "")}</p></div>
          </div>
          <div class="header-actions">
            <button class="icon-btn" data-action="back" title="رجوع">‹</button>
            <button class="icon-btn" data-action="track" title="تتبع الطلب">⌁</button>
            <button class="ghost-btn" data-action="chooseType">نوع الطلب</button>
          </div>
        </div>
      </header>
      <section class="page">
        ${state.firebaseError ? `<div class="notice error-notice">${escapeHtml(state.firebaseError)}</div>` : ""}
        ${state.message}
        ${state.view === "items" ? renderItems() : state.view === "checkout" ? renderCheckout(t) : state.view === "track" ? renderTrack() : renderCategories()}
      </section>
      ${state.cart.length ? `<div class="cart-bar"><div class="cart-bar-inner"><button class="cart-button" data-action="checkout"><span class="cart-count">${state.cart.reduce((a,b)=>a+b.quantity,0)}</span><span>السلة</span><strong>${K.fmt(t.total)}</strong></button></div></div>` : ""}
      ${renderItemDrawer()}
    `;
  }

  function orderTypeLabel(type) {
    return { delivery: "دليفري", dinein: "داخل المطعم", takeaway: "سفري" }[type] || "سفري";
  }

  function orderTypeCards() {
    return [
      { key: "takeaway", icon: "🚗", title: "سفري", desc: "اطلب وخذ طلبك بأسرع وقت" },
      { key: "dinein", icon: "🍽️", title: "تناول داخل المطعم", desc: "استمتع بأجواء الديرة والمشاوي الطازجة" },
      { key: "delivery", icon: "🛵", title: "دليفري", desc: "يوصلك لباب البيت بسرعة" }
    ];
  }

  function categoryIcon(category) {
    const icons = {
      offers: "🔥",
      nafarat: "🔥",
      weight: "📦",
      sandwiches: "🥙",
      drinks: "☕",
      extras: "➕"
    };
    return icons[category.id] || (category.isOffers ? "🔥" : "🍢");
  }

  function renderInlineOrderTypeCards(settings) {
    return `<section class="order-mode-section">
      <div class="section-title">
        <div><h2>اختر طريقة الطلب</h2><p>دليفري، صالة، أو سفري بخطوة واحدة.</p></div>
        <span>${Number(settings.deliveryRadiusKm || 7)} كم</span>
      </div>
      <div class="order-mode-grid">
        ${orderTypeCards().map(card => `<button class="order-mode-card ${state.orderType === card.key ? "active" : ""}" data-type="${card.key}">
          <span>${card.icon}</span>
          <strong>${card.title}</strong>
          <small>${card.desc}</small>
        </button>`).join("")}
      </div>
    </section>`;
  }

  function WelcomeScreen(settings) {
    const phones = (settings.phones || []).filter(Boolean).join(" - ");
    return `<main class="welcome-screen">
      <div class="cinema-bg" aria-hidden="true">
        <div class="grill-fire"></div>
        <div class="smoke smoke-one"></div>
        <div class="smoke smoke-two"></div>
        <div class="ember-field"></div>
      </div>
      <section class="welcome-content">
        <div class="welcome-logo">
          ${settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="">` : `<span>ك</span>`}
        </div>
        <p class="welcome-eyebrow">${settings.isOpen ? "مفتوح الآن 🔥" : "مغلق حالياً"}</p>
        <h1>${escapeHtml(settings.restaurantName || "كباب الديرة")}</h1>
        <h2>أطيب المشاوي العراقية 🔥</h2>
        <p class="welcome-subtitle">اطلب وإنت مرتاح وين ما تكون ❤️</p>
        <button class="start-order-btn" data-action="startOrder"><span>ابدأ الطلب</span></button>
      </section>
      <footer class="welcome-footer">
        <span>${escapeHtml(phones || settings.whatsappNumber || "")}</span>
        <div class="social-dots" aria-label="روابط التواصل">
          <a href="${settings.whatsappNumber ? `https://wa.me/${escapeHtml(settings.whatsappNumber)}` : "#"}" target="_blank">واتساب</a>
          <a href="#" aria-disabled="true">فيسبوك</a>
          <a href="#" aria-disabled="true">إنستغرام</a>
        </div>
      </footer>
    </main>`;
  }

  function OrderTypeSelector(settings) {
    const cards = orderTypeCards();
    return `<main class="order-type-screen old-order-screen">
      <section class="order-type-hero">
        <div class="old-order-panel">
          <div class="old-logo">${settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="">` : "🔥"}</div>
          <h1>كباب الديرة</h1>
          <p>اختر طريقة الطلب للمتابعة</p>
          <div class="order-type-cards">
            ${cards.map((card, index) => `<button class="order-type-card order-type-${card.key} ${state.orderType === card.key ? "selected" : ""}" data-type="${card.key}" style="--delay:${index * 70}ms">
              <span class="type-icon">${card.icon}</span>
              <span class="type-copy"><strong>${card.title}</strong><small>${card.desc}</small></span>
              <span class="type-arrow">‹</span>
            </button>`).join("")}
          </div>
        </div>
      </section>
    </main>`;
  }

  function renderCategories() {
    const categories = activeCategories();
    return `<div class="old-welcome-hero">
        <div class="old-hero-icon">🍢</div>
        <h2>مرحباً بكم</h2>
        <p>اختر القسم واطلب أشهى مشويات كباب الديرة</p>
      </div>
      <div class="toolbar"><h2>اختر القسم</h2><span class="muted">التحديثات تظهر مباشرة</span></div>
      <div class="category-grid">${categories.length ? categories.map(c => `
        <button class="category-card ${c.isOffers ? "offer" : ""}" data-category="${c.id}">
          <span class="category-icon">${categoryIcon(c)}</span>
          <strong>${c.isOffers ? "🔥 " : ""}${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.details || "")}</span>
        </button>`).join("") : `<div class="notice">لا توجد فئات ظاهرة. تأكد من لوحة التحكم أن الفئة مفعلة وغير مخفية، أو ارفع البيانات الأولية من تبويب النسخ الاحتياطي.</div>`}</div>`;
  }

  function renderItems() {
    const category = state.categories.find(c => c.id === state.selectedCategory) || {};
    const items = activeItems(state.selectedCategory);
    return `<div class="toolbar">
        <button class="ghost-btn" data-action="back">رجوع</button>
        <h2>${escapeHtml(category.name || "الأصناف")}</h2>
      </div>
      <div class="item-list">${items.length ? items.map(item => {
        const price = itemPrice(item);
        const off = K.percentOff(Number(item.oldPrice || 0), price);
        return item.isOffer ? `<article class="item-card offer-card deera-offer-card">
          <div>
            <span class="offer-pill">🔥 خصم ${off}%</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.description || "عرض خاص ومميز من كباب الديرة")}</p>
            <div class="offer-line"><span>السعر القديم</span><strong class="strike">${K.fmt(item.oldPrice || 0)}</strong></div>
            <div class="offer-line"><span>السعر الجديد</span><strong>${K.fmt(price)}</strong></div>
          </div>
          <button class="warning-btn offer-btn" data-item="${item.id}">إضافة العرض إلى السلة</button>
        </article>` : `<article class="item-card">
          <div class="item-main">
            <h3>${escapeHtml(item.name)}</h3>
            <p class="muted">${escapeHtml(item.description || "اختر الحجم أو الخيار المناسب")}</p>
          </div>
          <div class="item-price-block">
            <span class="muted">يبدأ من</span>
            <strong class="price">${K.fmt(price)}</strong>
          </div>
          <button class="item-select-btn ${item.available === false ? "disabled" : ""}" data-item="${item.id}" ${item.available === false ? "disabled" : ""}>${item.available === false ? "غير متوفر" : "اختيار"}</button>
        </article>`;
      }).join("") : `<div class="notice">لا توجد أصناف متاحة في هذا القسم حاليًا.</div>`}</div>`;
  }

  function renderCheckout(t) {
    return `<div class="toolbar"><button class="ghost-btn" data-action="back">رجوع</button><h2>تأكيد الطلب</h2></div>
      <div class="split">
        <section class="panel stack">
          <h3>معلومات الزبون</h3>
          <div class="form-grid">
            ${customerField("name", "اسم الزبون")}
            ${customerField("phone", "رقم الهاتف", "tel", `placeholder="07XXXXXXXXX"`)}
          </div>
          ${customerTextarea("address", state.orderType === "delivery" ? "العنوان" : "العنوان (اختياري)")}
          ${customerTextarea("notes", "ملاحظات اختيارية", `placeholder="أي ملاحظة على الطلب"`)}
          ${state.orderType === "dinein" ? `<label>رقم الطاولة<input data-table value="${escapeHtml(state.tableNumber)}"></label>` : ""}
          ${state.orderType === "delivery" ? `
            <div class="form-grid">
              <label>خط العرض<input data-customer="lat" value="${escapeHtml(state.customer.lat)}" placeholder="مثال 33.355"></label>
              <label>خط الطول<input data-customer="lng" value="${escapeHtml(state.customer.lng)}" placeholder="مثال 44.336"></label>
            </div>
            <label>رابط Google Maps<input data-customer="mapsUrl" value="${escapeHtml(state.customer.mapsUrl)}" placeholder="الصق رابط الموقع وسيتم استخراج الإحداثيات"></label>
            <div class="row-actions">
              <button class="ghost-btn" data-action="geo">تحديد موقعي</button>
              <button class="ghost-btn" data-action="calculateRoute">حساب أجرة التوصيل</button>
            </div>
            ${state.routeLoading ? `<div class="notice">جاري حساب المسافة الفعلية عبر الطرق...</div>` : ""}
            ${state.routeError ? `<div class="error-notice">${escapeHtml(state.routeError)}</div>` : ""}
            ${t.distance ? `<div class="delivery-route-card">
              <strong>المسافة الفعلية عبر الطرق: ${t.distance.toFixed(2)} كم</strong>
              <span>مدة التوصيل التقريبية: ${t.durationMin || "-"} دقيقة</span>
              <span>أجور التوصيل: ${K.fmt(t.deliveryFee)}</span>
              ${t.rawDeliveryFee && t.rawDeliveryFee !== t.roundedDeliveryFee ? `<span>قبل التقريب: ${K.fmt(t.rawDeliveryFee)}</span>` : ""}
            </div>` : ""}
          ` : ""}
          <button class="primary-btn" data-action="sendOrder" ${state.isSending ? "disabled" : ""}>${state.isSending ? "جاري إرسال الطلب..." : "إرسال الطلب"}</button>
        </section>
        <section class="panel stack">
          <h3>السلة</h3>
          ${state.cart.map(line => `<div class="cart-line">
            <div><strong>${escapeHtml(line.name)}</strong><p class="muted">${escapeHtml(line.optionName)} - ${K.fmt(line.price)}</p></div>
            <div class="qty"><button data-dec="${line.cartId}">-</button><strong>${line.quantity}</strong><button data-inc="${line.cartId}">+</button></div>
          </div>`).join("") || `<div class="notice">السلة فارغة.</div>`}
          <div class="option-row"><strong>المجموع</strong><strong>${K.fmt(t.subtotal)}</strong></div>
          ${state.orderType === "delivery" ? `<div class="option-row"><strong>التوصيل</strong><strong>${K.fmt(t.deliveryFee)}</strong></div>` : ""}
          <div class="option-row"><strong>الإجمالي</strong><strong>${K.fmt(t.total)}</strong></div>
        </section>
      </div>`;
  }

  function renderTrack() {
    return `<div class="toolbar"><button class="ghost-btn" data-action="home">المنيو</button><h2>تتبع الطلب</h2></div>
      <section class="panel stack">
        ${state.lastOrder ? `
          <h3>طلب رقم ${escapeHtml(state.lastOrder.id)}</h3>
          <div class="status-chip">${escapeHtml(state.lastOrder.status || "جديد")}</div>
          <p class="muted">الإجمالي: ${K.fmt(state.lastOrder.total)}</p>
        ` : `<div class="notice">لا يوجد طلب محفوظ للتتبع بعد.</div>`}
      </section>`;
  }

  function renderItemDrawer() {
    const item = state.selectedItem;
    if (!item) return `<div class="drawer"></div>`;
    return `<div class="drawer open"><div class="drawer-panel stack">
      <div class="toolbar"><h2>${escapeHtml(item.name)}</h2><button class="ghost-btn" data-action="closeItem">إغلاق</button></div>
      <p class="muted">${escapeHtml(item.description || "اختر أحد الخيارات")}</p>
      ${((item.options || []).length ? item.options : [{ id: "default", name: "عادي", price: 0, available: true }]).filter(o => o.available !== false).map(option => `
        <button class="option-row" data-add="${item.id}" data-option="${option.id}">
          <strong>${escapeHtml(option.name)}</strong><span class="price">${K.fmt(option.price)}</span>
        </button>`).join("")}
    </div></div>`;
  }

  async function sendOrder() {
    const t = totals();
    state.errors = {};
    state.customer.phone = cleanIraqiPhone(state.customer.phone);
    if (!state.cart.length) state.errors.cart = "السلة فارغة.";
    if (!state.settings.isOpen) state.errors.general = state.settings.closedMessage || "المطعم مغلق حاليًا.";
    if (!state.customer.name.trim()) state.errors.name = "أدخل اسم الزبون.";
    if (!isValidIraqiPhone(state.customer.phone)) state.errors.phone = "الرجاء إدخال رقم هاتف عراقي صحيح يبدأ بـ 07 أو +9647";
    if (state.orderType === "dinein" && !state.tableNumber.trim()) state.errors.general = "أدخل رقم الطاولة.";
    if (state.orderType === "delivery" && !state.customer.address.trim()) state.errors.address = "أدخل عنوان التوصيل.";
    if (Object.keys(state.errors).length) {
      save();
      const firstError = state.errors.general || state.errors.cart || state.errors.name || state.errors.phone || state.errors.address || "تحقق من معلومات الطلب.";
      render();
      return setMessage(firstError, "error-notice");
    }
    if (state.orderType === "delivery") {
      if (!state.settings.deliveryEnabled) return setMessage("الدليفري غير متاح حاليًا.", "error-notice");
      if (!validCoords(state.customer.lat, state.customer.lng)) return setMessage("حدد موقعك على الخريطة أو أدخل الإحداثيات قبل إرسال الطلب.", "error-notice");
      if (!state.route?.distanceKm) {
        await requestRoute();
        const updated = totals();
        if (!updated.distance) return setMessage("تعذر حساب مسافة الطريق. تحقق من إعدادات الخرائط أو الموقع.", "error-notice");
      }
      const checkedTotals = totals();
      if (checkedTotals.distance > Number(state.settings.deliveryRadiusKm || 7)) return setMessage("عذرًا، موقعك خارج نطاق التوصيل المتاح.", "error-notice");
    }
    if (!db) return setMessage("أضف إعدادات Firebase حتى يتم حفظ الطلب في Firestore.", "error-notice");

    const pendingWhatsappWindow = whatsappPhone(state.settings.whatsappNumber) ? window.open("", "_blank") : null;
    state.isSending = true;
    state.message = `<div class="notice">جاري إرسال الطلب إلى المطعم...</div>`;
    render();
    try {
      const finalTotals = totals();
      const payload = {
        customer: { ...state.customer, phone: cleanIraqiPhone(state.customer.phone) },
        orderType: state.orderType,
        tableNumber: state.orderType === "dinein" ? state.tableNumber : "",
        items: state.cart,
        subtotal: finalTotals.subtotal,
        deliveryFee: finalTotals.deliveryFee,
        rawDeliveryFee: finalTotals.rawDeliveryFee,
        roundedDeliveryFee: finalTotals.roundedDeliveryFee,
        roundingMethod: finalTotals.roundingMethod,
        total: finalTotals.total,
        distanceKm: finalTotals.distance || 0,
        routeDurationMin: finalTotals.durationMin || 0,
        routeProvider: state.route?.provider || "",
        routeGeometryJson: routeGeometryForStorage(),
        status: "جديد",
        source: window.matchMedia("(display-mode: standalone)").matches ? "APK / PWA" : "صفحة الزبون",
        paymentStatus: "دفع عند الاستلام",
        priority: "عادي",
        notes: state.customer.notes || "",
        statusHistory: [{ status: "جديد", atMs: Date.now(), by: "customer" }],
        archived: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now()
      };
      const doc = await db.collection("orders").add(payload);
      try {
        await db.collection("public_order_status").doc(doc.id).set({
        status: "جديد",
        total: finalTotals.total,
        orderType: state.orderType,
        createdAtMs: payload.createdAtMs,
        updatedAtMs: Date.now()
        });
      } catch (statusError) {
        console.warn("Order status tracking write failed", statusError);
      }
      const whatsappUrl = orderWhatsappUrl(doc.id, payload);
      state.lastOrderId = doc.id;
      localStorage.setItem("kd_last_order_id", doc.id);
      state.cart = [];
      state.message = `<div class="success-notice">تم إرسال طلبك بنجاح. يمكنك تتبع حالته من زر تتبع الطلب.</div>`;
      state.view = "track";
      subscribeLastOrder();
      if (whatsappUrl && pendingWhatsappWindow) pendingWhatsappWindow.location.href = whatsappUrl;
      else if (whatsappUrl) window.open(whatsappUrl, "_blank");
    } catch (error) {
      if (pendingWhatsappWindow) pendingWhatsappWindow.close();
      const details = error && error.code ? ` (${error.code})` : "";
      const message = error?.message ? ` - ${escapeHtml(error.message)}` : "";
      state.message = `<div class="error-notice">تعذر إرسال الطلب${details}${message}. تأكد من نشر Firestore Rules الموجودة في ملف firestore-rules.txt.</div>`;
      console.error("Order submit failed", error);
    } finally {
      state.isSending = false;
      render();
    }
  }

  function whatsappPhone(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
    if (!digits.startsWith("964") && digits.length === 10) digits = `964${digits}`;
    return digits;
  }

  function orderTypeLabel(type) {
    return { delivery: "دليفري", takeaway: "سفري", dinein: "صالة" }[type] || type || "غير محدد";
  }

  function customerLocationUrl(customer = state.customer) {
    if (customer.lat && customer.lng) return `https://www.google.com/maps?q=${customer.lat},${customer.lng}`;
    return customer.mapsUrl || "";
  }

  function whatsappText(orderId, payload) {
    const location = customerLocationUrl(payload.customer || {});
    const lines = [
      `طلب جديد من كباب الديرة`,
      `رقم الطلب: ${orderId}`,
      `الاسم: ${payload.customer?.name || ""}`,
      `الهاتف: ${payload.customer?.phone || ""}`,
      `نوع الطلب: ${orderTypeLabel(payload.orderType)}`,
      `العنوان: ${payload.customer?.address || payload.tableNumber || ""}`,
      location ? `موقع الزبون: ${location}` : "موقع الزبون: غير محدد",
      "",
      "الأصناف:"
    ];
    (payload.items || []).forEach(item => {
      lines.push(`- ${item.name || ""}${item.optionName ? ` / ${item.optionName}` : ""} × ${item.quantity || 1} = ${K.fmt(Number(item.price || 0) * Number(item.quantity || 1))}`);
      if (item.addons) lines.push(`  الإضافات: ${item.addons}`);
      if (item.notes) lines.push(`  ملاحظة: ${item.notes}`);
    });
    if (payload.notes) lines.push("", `ملاحظات: ${payload.notes}`);
    lines.push("");
    lines.push(`أجور التوصيل: ${K.fmt(payload.deliveryFee || 0)}`);
    lines.push(`الإجمالي النهائي: ${K.fmt(payload.total || 0)}`);
    return lines.join("\n");
  }

  function orderWhatsappUrl(orderId, payload) {
    const phone = whatsappPhone(state.settings.whatsappNumber);
    if (!phone) return "";
    return `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText(orderId, payload))}`;
  }

  function subscribe() {
    applyMenuPayload(K.localSync.read());
    K.localSync.subscribe(applyMenuPayload);
    render();
    if (!db) {
      return;
    }
    db.collection("categories").onSnapshot(s => {
      const categories = s.docs.map(d => ({ id: d.id, ...d.data() }));
      state.remoteCategoryCount = categories.length;
      state.categories = categories.filter(category => category.deleted !== true);
      localStorage.setItem("kd_cached_categories", JSON.stringify(state.categories));
      state.firebaseError = "";
      render();
    }, () => {
      state.firebaseError = "تعذر قراءة الفئات من Firebase. غالبًا تحتاج تحديث Firestore Rules للسماح بقراءة المنيو.";
      render();
    });
    db.collection("items").onSnapshot(s => {
      const items = s.docs.map(d => ({ id: d.id, ...d.data() }));
      state.remoteItemCount = items.length;
      state.items = items.filter(item => item.deleted !== true);
      localStorage.setItem("kd_cached_items", JSON.stringify(state.items));
      state.firebaseError = "";
      render();
    }, () => {
      state.firebaseError = "تعذر قراءة الأصناف من Firebase. راجع Firestore Rules في ملف README.";
      render();
    });
    db.collection("settings").doc("main").onSnapshot(d => {
      state.settings = { ...K.settingsSeed, ...(d.exists ? d.data() : {}) };
      localStorage.setItem("kd_cached_settings", JSON.stringify(state.settings));
      render();
      if (state.orderType === "delivery") scheduleRouteCalculation();
    }, () => {
      state.firebaseError = "تعذر قراءة إعدادات المطعم من Firebase. راجع Firestore Rules في ملف README.";
      render();
    });
    subscribeLastOrder();
  }

  function subscribeLastOrder() {
    if (!db || !state.lastOrderId) return;
    db.collection("public_order_status").doc(state.lastOrderId).onSnapshot(d => {
      state.lastOrder = d.exists ? { id: d.id, ...d.data() } : null;
      if (state.view === "track") render();
    });
  }

  app.addEventListener("click", async event => {
    const el = event.target.closest("[data-action],[data-type],[data-category],[data-item],[data-add],[data-inc],[data-dec]");
    if (!el) return;
    if (el.dataset.action === "startOrder") {
      state.screen = "orderType";
      render();
      return;
    }
    if (el.dataset.action === "backWelcome") {
      state.screen = "welcome";
      render();
      return;
    }
    if (el.dataset.action === "chooseType") {
      state.screen = "orderType";
      render();
      return;
    }
    if (el.dataset.type) {
      state.orderType = el.dataset.type;
      if (state.orderType === "dinein") state.cart = state.cart.filter(i => i.categoryId !== "weight");
      state.screen = "menu";
      state.view = "categories";
      render();
      if (state.orderType === "delivery") scheduleRouteCalculation();
    }
    if (el.dataset.category) { state.selectedCategory = el.dataset.category; state.view = "items"; render(); }
    if (el.dataset.item) { state.selectedItem = state.items.find(i => i.id === el.dataset.item); render(); }
    if (el.dataset.add) {
      const item = state.items.find(i => i.id === el.dataset.add);
      const option = (item.options || []).find(o => o.id === el.dataset.option) || { id: "default", name: "عادي", price: 0 };
      const cartId = `${item.id}_${option.id}`;
      const found = state.cart.find(i => i.cartId === cartId);
      if (found) found.quantity += 1;
      else state.cart.push({ cartId, itemId: item.id, optionId: option.id, categoryId: item.categoryId, name: item.name, optionName: option.name, price: Number(option.price || 0), quantity: 1 });
      state.selectedItem = null;
      render();
    }
    if (el.dataset.inc || el.dataset.dec) {
      const cartId = el.dataset.inc || el.dataset.dec;
      const line = state.cart.find(i => i.cartId === cartId);
      if (line) line.quantity += el.dataset.inc ? 1 : -1;
      state.cart = state.cart.filter(i => i.quantity > 0);
      render();
    }
    if (el.dataset.action === "back") { state.view = state.selectedCategory ? "categories" : "categories"; state.selectedCategory = ""; render(); }
    if (el.dataset.action === "home") { state.view = "categories"; state.selectedCategory = ""; render(); }
    if (el.dataset.action === "checkout") { state.view = "checkout"; render(); }
    if (el.dataset.action === "track") { state.view = "track"; render(); }
    if (el.dataset.action === "closeItem") { state.selectedItem = null; render(); }
    if (el.dataset.action === "sendOrder") {
      try {
        await sendOrder();
      } catch (error) {
        console.error("Unexpected order error", error);
        setMessage("حدث خطأ غير متوقع أثناء إرسال الطلب.", "error-notice");
      }
    }
    if (el.dataset.action === "geo") navigator.geolocation.getCurrentPosition(pos => {
      state.customer.lat = pos.coords.latitude.toFixed(6);
      state.customer.lng = pos.coords.longitude.toFixed(6);
      state.customer.mapsUrl = `https://maps.google.com/?q=${state.customer.lat},${state.customer.lng}`;
      render();
      scheduleRouteCalculation();
    }, () => setMessage("لم نتمكن من قراءة الموقع. يمكنك إدخال الإحداثيات يدويًا.", "error-notice"));
    if (el.dataset.action === "calculateRoute") requestRoute();
  });

  app.addEventListener("input", event => {
    if (event.target.dataset.customer) {
      state.customer[event.target.dataset.customer] = event.target.value;
      delete state.errors[event.target.dataset.customer];
      delete state.errors.general;
      if (event.target.dataset.customer === "mapsUrl") {
        const coords = parseMapsLink(event.target.value);
        if (coords) {
          state.customer.lat = coords.lat;
          state.customer.lng = coords.lng;
        }
      }
      if (["lat", "lng", "mapsUrl"].includes(event.target.dataset.customer)) {
        state.route = null;
        scheduleRouteCalculation();
      }
      save();
    }
    if ("table" in event.target.dataset) {
      state.tableNumber = event.target.value;
      delete state.errors.general;
      save();
    }
  });

  subscribe();
})();
