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
    customer: read("kd_customer_data", { name: "", phone: "", address: "", lat: "", lng: "", mapsUrl: "" }),
    orderType: localStorage.getItem("kd_order_type") || "takeaway",
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
    remoteItemCount: 0
  };

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }
  function save() {
    localStorage.setItem("kd_customer_cart", JSON.stringify(state.cart));
    localStorage.setItem("kd_customer_data", JSON.stringify(state.customer));
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
  function totals() {
    const subtotal = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const distance = currentDistance();
    let deliveryFee = 0;
    if (state.orderType === "delivery") {
      deliveryFee = state.settings.deliveryFeeType === "per_km" && distance
        ? Math.ceil(distance * Number(state.settings.deliveryFeePerKm || 0))
        : Number(state.settings.deliveryFee || 0);
    }
    return { subtotal, deliveryFee, total: subtotal + deliveryFee, distance };
  }
  function currentDistance() {
    const lat = Number(state.customer.lat);
    const lng = Number(state.customer.lng);
    if (!lat || !lng || !state.settings.restaurantLat || !state.settings.restaurantLng) return 0;
    return K.distanceKm(Number(state.settings.restaurantLat), Number(state.settings.restaurantLng), lat, lng);
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
    app.innerHTML = `
      <header class="customer-header">
        <div class="header-inner">
          <div class="brand">
            ${settings.logoUrl ? `<img class="logo" src="${escapeHtml(settings.logoUrl)}" alt="">` : `<div class="logo">ك</div>`}
            <div><h1>${escapeHtml(settings.restaurantName || "كباب الديرة")}</h1><p>${escapeHtml(settings.address || "")}</p></div>
          </div>
          <div class="header-actions">
            <button class="icon-btn" data-action="track" title="تتبع الطلب">⌁</button>
            <button class="ghost-btn" data-action="home">المنيو</button>
          </div>
        </div>
      </header>
      <section class="page">
        <div class="hero">
          <h2>${escapeHtml(settings.restaurantName || "كباب الديرة")}</h2>
          <p>سفري، صالة، ودليفري من المنيو المتزامن مباشرة.</p>
          <div class="status-row">
            <span class="pill">${settings.isOpen ? "مفتوح الآن" : "مغلق الآن"}</span>
            <span class="pill">${escapeHtml(settings.workingHours || "")}</span>
            <span class="pill">النطاق ${Number(settings.deliveryRadiusKm || 7)} كم</span>
          </div>
        </div>
        ${state.firebaseError ? `<div class="notice error-notice">${escapeHtml(state.firebaseError)}</div>` : ""}
        ${state.message}
        <div class="segment">
          ${["takeaway:سفري", "dinein:صالة", "delivery:دليفري"].map(raw => {
            const [key, label] = raw.split(":");
            return `<button class="${state.orderType === key ? "active" : ""}" data-type="${key}">${label}</button>`;
          }).join("")}
        </div>
        ${state.view === "items" ? renderItems() : state.view === "checkout" ? renderCheckout(t) : state.view === "track" ? renderTrack() : renderCategories()}
      </section>
      ${state.cart.length ? `<div class="cart-bar"><div class="cart-bar-inner"><button class="cart-button" data-action="checkout"><span>عرض السلة (${state.cart.reduce((a,b)=>a+b.quantity,0)})</span><span>${K.fmt(t.total)}</span></button></div></div>` : ""}
      ${renderItemDrawer()}
    `;
  }

  function renderCategories() {
    const categories = activeCategories();
    return `<div class="toolbar"><h2>اختر القسم</h2><span class="muted">التحديثات تظهر مباشرة</span></div>
      <div class="category-grid">${categories.length ? categories.map(c => `
        <button class="category-card ${c.isOffers ? "offer" : ""}" data-category="${c.id}">
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
        return `<article class="item-card ${item.isOffer ? "offer-card" : ""}">
          <div class="item-photo">${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="">` : "🍢"}</div>
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <p class="${item.isOffer ? "" : "muted"}">${escapeHtml(item.description || "اختر الحجم أو الخيار المناسب")}</p>
            ${item.isOffer && item.oldPrice ? `<p><span class="strike">${K.fmt(item.oldPrice)}</span> <span class="price">${K.fmt(price)}</span> <span class="pill">${off}% خصم</span></p>` : `<p class="price">يبدأ من ${K.fmt(price)}</p>`}
          </div>
          <button class="${item.isOffer ? "warning-btn" : "primary-btn"}" data-item="${item.id}">اختيار</button>
        </article>`;
      }).join("") : `<div class="notice">لا توجد أصناف متاحة في هذا القسم حاليًا.</div>`}</div>`;
  }

  function renderCheckout(t) {
    return `<div class="toolbar"><button class="ghost-btn" data-action="back">رجوع</button><h2>تأكيد الطلب</h2></div>
      <div class="split">
        <section class="panel stack">
          <h3>بيانات الزبون</h3>
          <div class="form-grid">
            <label>الاسم<input data-customer="name" value="${escapeHtml(state.customer.name)}"></label>
            <label>الهاتف<input data-customer="phone" value="${escapeHtml(state.customer.phone)}"></label>
          </div>
          ${state.orderType === "dinein" ? `<label>رقم الطاولة<input data-table value="${escapeHtml(state.tableNumber)}"></label>` : ""}
          ${state.orderType === "delivery" ? `
            <label>العنوان<textarea data-customer="address">${escapeHtml(state.customer.address)}</textarea></label>
            <div class="form-grid">
              <label>خط العرض<input data-customer="lat" value="${escapeHtml(state.customer.lat)}" placeholder="مثال 33.355"></label>
              <label>خط الطول<input data-customer="lng" value="${escapeHtml(state.customer.lng)}" placeholder="مثال 44.336"></label>
            </div>
            <label>رابط Google Maps<input data-customer="mapsUrl" value="${escapeHtml(state.customer.mapsUrl)}"></label>
            <button class="ghost-btn" data-action="geo">تحديد موقعي</button>
            ${t.distance ? `<div class="notice">المسافة التقريبية ${t.distance.toFixed(2)} كم</div>` : ""}
          ` : ""}
          <button class="primary-btn" data-action="sendOrder" ${state.isSending ? "disabled" : ""}>${state.isSending ? "جاري إرسال الطلب..." : "إرسال الطلب إلى المطعم"}</button>
          ${state.settings.whatsappEnabled ? `<button class="success-btn" data-action="whatsapp">إرسال نسخة واتساب</button>` : ""}
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
    if (!state.cart.length) return setMessage("السلة فارغة.", "error-notice");
    if (!state.settings.isOpen) return setMessage(state.settings.closedMessage || "المطعم مغلق حاليًا.", "error-notice");
    if (!state.customer.name.trim() || !state.customer.phone.trim()) return setMessage("أدخل الاسم ورقم الهاتف.", "error-notice");
    if (state.orderType === "dinein" && !state.tableNumber.trim()) return setMessage("أدخل رقم الطاولة.", "error-notice");
    if (state.orderType === "delivery") {
      if (!state.settings.deliveryEnabled) return setMessage("الدليفري غير متاح حاليًا.", "error-notice");
      if (!state.customer.address.trim()) return setMessage("أدخل عنوان التوصيل.", "error-notice");
      if (t.distance && t.distance > Number(state.settings.deliveryRadiusKm || 7)) return setMessage(`موقعك خارج نطاق التوصيل (${state.settings.deliveryRadiusKm} كم).`, "error-notice");
    }
    if (!db) return setMessage("أضف إعدادات Firebase حتى يتم حفظ الطلب في Firestore.", "error-notice");

    state.isSending = true;
    state.message = `<div class="notice">جاري إرسال الطلب إلى المطعم...</div>`;
    render();
    try {
      const payload = {
        customer: { ...state.customer },
        orderType: state.orderType,
        tableNumber: state.orderType === "dinein" ? state.tableNumber : "",
        items: state.cart,
        subtotal: t.subtotal,
        deliveryFee: t.deliveryFee,
        total: t.total,
        distanceKm: t.distance || 0,
        status: "جديد",
        archived: false,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now()
      };
      const doc = await db.collection("orders").add(payload);
      try {
        await db.collection("public_order_status").doc(doc.id).set({
        status: "جديد",
        total: t.total,
        orderType: state.orderType,
        createdAtMs: payload.createdAtMs,
        updatedAtMs: Date.now()
        });
      } catch (statusError) {
        console.warn("Order status tracking write failed", statusError);
      }
      state.lastOrderId = doc.id;
      localStorage.setItem("kd_last_order_id", doc.id);
      state.cart = [];
      state.message = `<div class="success-notice">تم إرسال الطلب بنجاح. يمكنك تتبع حالته من زر تتبع الطلب.</div>`;
      state.view = "track";
      subscribeLastOrder();
    } catch (error) {
      const details = error && error.code ? ` (${error.code})` : "";
      state.message = `<div class="error-notice">تعذر إرسال الطلب${details}. تأكد من نشر Firestore Rules الموجودة في ملف firestore-rules.txt.</div>`;
      console.error("Order submit failed", error);
    } finally {
      state.isSending = false;
      render();
    }
  }

  function whatsappText() {
    const t = totals();
    return `طلب جديد من كباب الديرة\nالاسم: ${state.customer.name}\nالهاتف: ${state.customer.phone}\nالنوع: ${state.orderType}\n${state.cart.map(i => `- ${i.name} / ${i.optionName} × ${i.quantity}`).join("\n")}\nالإجمالي: ${K.fmt(t.total)}`;
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
    if (el.dataset.type) {
      state.orderType = el.dataset.type;
      if (state.orderType === "dinein") state.cart = state.cart.filter(i => i.categoryId !== "weight");
      state.view = "categories";
      render();
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
    if (el.dataset.action === "whatsapp") window.open(`https://wa.me/${state.settings.whatsappNumber}?text=${encodeURIComponent(whatsappText())}`, "_blank");
    if (el.dataset.action === "geo") navigator.geolocation.getCurrentPosition(pos => {
      state.customer.lat = pos.coords.latitude.toFixed(6);
      state.customer.lng = pos.coords.longitude.toFixed(6);
      state.customer.mapsUrl = `https://maps.google.com/?q=${state.customer.lat},${state.customer.lng}`;
      render();
    }, () => setMessage("لم نتمكن من قراءة الموقع. يمكنك إدخال الإحداثيات يدويًا.", "error-notice"));
  });

  app.addEventListener("input", event => {
    if (event.target.dataset.customer) {
      state.customer[event.target.dataset.customer] = event.target.value;
      save();
    }
    if ("table" in event.target.dataset) {
      state.tableNumber = event.target.value;
      save();
    }
  });

  subscribe();
})();
