(() => {
  const K = window.KABAB;
  const services = K.firebaseReady();
  const isLoginPage = Boolean(document.getElementById("loginForm"));

  if (isLoginPage) {
    const form = document.getElementById("loginForm");
    const msg = document.getElementById("loginMessage");
    if (!services) {
      msg.textContent = "أضف إعدادات Firebase في firebase-config.js أولًا.";
      form.querySelector("button").disabled = true;
      return;
    }
    services.auth.onAuthStateChanged(user => {
      if (user) window.location.href = "admin.html";
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      msg.textContent = "جاري تسجيل الدخول...";
      try {
        await services.auth.signInWithEmailAndPassword(
          document.getElementById("loginEmail").value.trim(),
          document.getElementById("loginPassword").value
        );
        window.location.href = "admin.html";
      } catch (error) {
        msg.textContent = "تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.";
      }
    });
    return;
  }

  const app = document.getElementById("adminApp");
  if (!app) return;
  if (!services) {
    app.innerHTML = `<section class="login-layout"><div class="auth-panel"><h1>Firebase غير مضبوط</h1><p>أضف مفاتيح المشروع في firebase-config.js ثم أعد فتح اللوحة.</p><a class="quiet-link" href="README.md">اقرأ التعليمات</a></div></section>`;
    return;
  }

  const db = services.db;
  const state = {
    user: null,
    tab: "dashboard",
    categories: [],
    items: [],
    settings: K.settingsSeed,
    orders: [],
    addons: [],
    customers: [],
    editing: null,
    modal: "",
    dateFrom: "",
    dateTo: ""
  };
  let lastNewOrderIds = new Set();
  let audioReady = false;

  const tabs = [
    ["dashboard", "الرئيسية"],
    ["orders", "الطلبات"],
    ["categories", "الفئات"],
    ["items", "الأصناف"],
    ["offers", "العروض"],
    ["settings", "الإعدادات"],
    ["reports", "التقارير"],
    ["backup", "النسخ الاحتياطي"]
  ];

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  }
  function val(id) { return document.getElementById(id)?.value ?? ""; }
  function checked(id) { return Boolean(document.getElementById(id)?.checked); }
  function num(id) { return Number(val(id) || 0); }
  function docData(snap) { return snap.docs.map(d => ({ id: d.id, ...d.data() })); }
  function toast(text, type = "success-notice") {
    state.modal = `<div class="notice ${type}">${esc(text)}</div>`;
    render();
    setTimeout(() => { state.modal = ""; render(); }, 2500);
  }
  function publishMenuSync() {
    K.localSync.publish({
      categories: state.categories,
      items: state.items,
      settings: state.settings
    });
  }
  function playNewOrderSound() {
    if (!audioReady) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = .08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 420);
  }
  function orderTime(order) {
    if (order.createdAt?.toDate) return order.createdAt.toDate();
    return new Date(order.createdAtMs || Date.now());
  }
  function filteredOrders() {
    return state.orders.filter(order => {
      const d = orderTime(order);
      const from = state.dateFrom ? new Date(state.dateFrom + "T00:00:00") : null;
      const to = state.dateTo ? new Date(state.dateTo + "T23:59:59") : null;
      return (!from || d >= from) && (!to || d <= to);
    });
  }
  function metrics(list = filteredOrders()) {
    const done = list.filter(o => o.status === "تم التسليم");
    const canceled = list.filter(o => o.status === "ملغي");
    const itemMap = {};
    list.forEach(order => (order.items || []).forEach(item => {
      itemMap[item.name] = (itemMap[item.name] || 0) + Number(item.quantity || 0);
    }));
    const top = Object.entries(itemMap).sort((a,b)=>b[1]-a[1])[0];
    return {
      sales: done.reduce((s,o)=>s+Number(o.total||0),0),
      count: list.length,
      canceled: canceled.length,
      completed: done.length,
      delivery: list.reduce((s,o)=>s+Number(o.deliveryFee||0),0),
      top: top ? `${top[0]} (${top[1]})` : "لا يوجد"
    };
  }

  function render() {
    app.innerHTML = `
      <aside class="sidebar">
        <div class="brand-mark">ك</div>
        <h1>كباب الديرة</h1>
        <p>لوحة التحكم المتزامنة</p>
        <nav class="nav">${tabs.map(([key, label]) => `<button class="${state.tab === key ? "active" : ""}" data-tab="${key}">${label}</button>`).join("")}</nav>
        <button class="ghost-btn" data-action="enableAudio">تفعيل تنبيه الطلبات</button>
        <button class="danger-btn" data-action="logout">تسجيل خروج</button>
      </aside>
      <section class="admin-main">
        <div class="admin-top"><h2>${tabs.find(t => t[0] === state.tab)?.[1] || ""}</h2><a class="ghost-btn" href="index.html">صفحة الزبون</a></div>
        ${state.modal}
        ${renderTab()}
      </section>
      <div id="adminModal" class="modal"></div>
    `;
  }

  function renderTab() {
    if (state.tab === "dashboard") return renderDashboard();
    if (state.tab === "orders") return renderOrders();
    if (state.tab === "categories") return renderCategories();
    if (state.tab === "items") return renderItems(false);
    if (state.tab === "offers") return renderItems(true);
    if (state.tab === "settings") return renderSettings();
    if (state.tab === "reports") return renderReports();
    if (state.tab === "backup") return renderBackup();
    return "";
  }

  function renderDashboard() {
    const m = metrics(state.orders.filter(o => new Date(orderTime(o)).toDateString() === new Date().toDateString()));
    return `<div class="metrics">
      ${metric("مبيعات اليوم", K.fmt(m.sales))}
      ${metric("طلبات اليوم", m.count)}
      ${metric("مكتملة", m.completed)}
      ${metric("ملغية", m.canceled)}
      ${metric("إجمالي التوصيل", K.fmt(m.delivery))}
      ${metric("الأكثر طلبًا", m.top)}
    </div>
    <section class="panel"><div class="panel-head"><h3>آخر الطلبات</h3><button class="primary-btn" data-tab="orders">إدارة الطلبات</button></div>${ordersTable(state.orders.slice(0, 8))}</section>`;
  }
  function metric(label, value) { return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }

  function renderOrders() {
    const live = state.orders.filter(o => !o.archived);
    return `<section class="panel">
      <div class="panel-head"><h3>الطلبات المباشرة</h3><div class="row-actions"><button class="ghost-btn" data-action="archiveDone">أرشفة المكتملة</button></div></div>
      ${ordersTable(live)}
    </section>`;
  }

  function ordersTable(orders) {
    return `<div class="table-wrap"><table>
      <thead><tr><th>الطلب</th><th>الزبون</th><th>الأصناف</th><th>الإجمالي</th><th>الحالة</th><th>إجراءات</th></tr></thead>
      <tbody>${orders.map(order => `<tr>
        <td><strong>#${esc(order.id.slice(0, 6))}</strong><br><span class="muted">${orderTime(order).toLocaleString("ar-IQ")}</span><br><span class="muted">${esc(order.orderType || "")}</span></td>
        <td>${esc(order.customer?.name || "")}<br><span class="muted">${esc(order.customer?.phone || "")}</span><br><span class="muted">${esc(order.customer?.address || order.tableNumber || "")}</span></td>
        <td>${(order.items || []).map(i => `${esc(i.name)} / ${esc(i.optionName)} × ${esc(i.quantity)}`).join("<br>")}</td>
        <td><strong>${K.fmt(order.total)}</strong><br><span class="muted">توصيل ${K.fmt(order.deliveryFee)}</span></td>
        <td><span class="status-chip">${esc(order.status || "جديد")}</span><br><select data-status="${order.id}">${K.orderStatuses.map(s => `<option ${s === order.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
        <td><div class="row-actions"><button class="mini-btn green" data-print="${order.id}">طباعة</button><button class="mini-btn" data-archive="${order.id}">أرشفة</button><button class="mini-btn red" data-delete-order="${order.id}">حذف</button></div></td>
      </tr>`).join("") || `<tr><td colspan="6">لا توجد طلبات.</td></tr>`}</tbody>
    </table></div>`;
  }

  function renderCategories() {
    return `<div class="split">
      <section class="panel">${categoryForm()}</section>
      <section class="panel"><div class="panel-head"><h3>الفئات</h3><div class="row-actions"><button class="ghost-btn" data-action="repairVisibility">إظهار الكل</button><button class="ghost-btn" data-action="newCategory">تفريغ النموذج</button></div></div>
        <div class="data-grid">${K.sortByOrder(state.categories).map(c => rowCard(c.name, c.details, [
          ["تعديل", `data-edit-category="${c.id}"`, ""],
          [c.hidden ? "إظهار" : "إخفاء", `data-toggle-category="${c.id}"`, "orange"],
          ["حذف", `data-delete-category="${c.id}"`, "red"]
        ])).join("")}</div>
      </section>
    </div>`;
  }

  function categoryForm(c = state.editing?.type === "category" ? state.editing.data : {}) {
    return `<h3>${c.id ? "تعديل فئة" : "إضافة فئة"}</h3><form class="stack" data-form="category">
      <input id="categoryId" type="hidden" value="${esc(c.id || "")}">
      <div class="form-grid"><label>اسم الفئة<input id="categoryName" value="${esc(c.name || "")}" required></label><label>الترتيب<input id="categoryOrder" type="number" value="${esc(c.order || 1)}"></label></div>
      <div class="form-grid"><label>الأيقونة<input id="categoryIcon" value="${esc(c.icon || "flame")}"></label><label>رابط الصورة<input id="categoryImage" value="${esc(c.imageUrl || "")}"></label></div>
      <label>الوصف<textarea id="categoryDetails">${esc(c.details || "")}</textarea></label>
      <div class="form-grid"><label><input id="categoryActive" type="checkbox" ${c.active !== false ? "checked" : ""}> مفعلة</label><label><input id="categoryHidden" type="checkbox" ${c.hidden ? "checked" : ""}> مخفية</label><label><input id="categoryOffers" type="checkbox" ${c.isOffers ? "checked" : ""}> فئة عروض</label></div>
      <button class="primary-btn" type="submit">حفظ الفئة</button>
    </form>`;
  }

  function renderItems(offersOnly) {
    const list = state.items.filter(i => offersOnly ? i.isOffer : !i.isOffer);
    return `<div class="split">
      <section class="panel">${itemForm(offersOnly)}</section>
      <section class="panel"><div class="panel-head"><h3>${offersOnly ? "العروض" : "الأصناف"}</h3><div class="row-actions"><button class="ghost-btn" data-action="repairVisibility">إظهار الكل</button><button class="ghost-btn" data-action="${offersOnly ? "newOffer" : "newItem"}">تفريغ النموذج</button></div></div>
        <div class="data-grid">${K.sortByOrder(list).map(i => {
          const price = (i.options || [])[0]?.price || 0;
          return rowCard(`${i.name} - ${K.fmt(price)}`, `${categoryName(i.categoryId)} | ${i.available === false ? "غير متوفر" : "متوفر"}`, [
            ["تعديل", `data-edit-item="${i.id}"`, ""],
            [i.available === false ? "متوفر" : "غير متوفر", `data-toggle-item="${i.id}"`, "orange"],
            ["حذف", `data-delete-item="${i.id}"`, "red"]
          ]);
        }).join("")}</div>
      </section>
    </div>`;
  }

  function categoryName(id) { return state.categories.find(c => c.id === id)?.name || id || ""; }
  function itemForm(offersOnly) {
    const item = state.editing?.type === "item" ? state.editing.data : { isOffer: offersOnly, options: [{ id: K.id("opt"), name: "عادي", price: 0, cost: 0, available: true }] };
    return `<h3>${item.id ? "تعديل" : "إضافة"} ${offersOnly ? "عرض" : "صنف"}</h3><form class="stack" data-form="item">
      <input id="itemId" type="hidden" value="${esc(item.id || "")}">
      <input id="itemIsOffer" type="hidden" value="${offersOnly ? "1" : ""}">
      <div class="form-grid"><label>الاسم<input id="itemName" value="${esc(item.name || "")}" required></label><label>الفئة<select id="itemCategory">${state.categories.map(c => `<option value="${c.id}" ${c.id === item.categoryId ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div>
      <label>الوصف<textarea id="itemDescription">${esc(item.description || "")}</textarea></label>
      <div class="form-grid"><label>رابط الصورة<input id="itemImage" value="${esc(item.imageUrl || "")}"></label><label>رفع صورة<input id="itemImageFile" type="file" accept="image/*"></label><label>الترتيب<input id="itemOrder" type="number" value="${esc(item.order || 1)}"></label></div>
      <div class="form-grid"><label><input id="itemAvailable" type="checkbox" ${item.available !== false ? "checked" : ""}> متوفر</label><label><input id="itemVisible" type="checkbox" ${item.visible !== false ? "checked" : ""}> ظاهر</label></div>
      ${offersOnly ? `<div class="form-grid"><label>السعر القديم<input id="itemOldPrice" type="number" value="${esc(item.oldPrice || 0)}"></label><label>بداية العرض<input id="itemOfferStart" type="date" value="${esc(item.offerStart || "")}"></label><label>نهاية العرض<input id="itemOfferEnd" type="date" value="${esc(item.offerEnd || "")}"></label></div>` : ""}
      <h3>خيارات الصنف</h3>
      <div id="optionsEditor">${(item.options || []).map(optionForm).join("")}</div>
      <button class="ghost-btn" type="button" data-action="addOption">إضافة خيار</button>
      <button class="primary-btn" type="submit">حفظ ${offersOnly ? "العرض" : "الصنف"}</button>
    </form>`;
  }
  function optionForm(o = { id: K.id("opt"), name: "", price: 0, cost: 0, available: true }) {
    return `<div class="row-card option-editor" data-option-id="${esc(o.id || K.id("opt"))}">
      <div class="form-grid"><label>اسم الخيار<input data-opt="name" value="${esc(o.name || "")}"></label><label>السعر<input data-opt="price" type="number" value="${esc(o.price || 0)}"></label><label>التكلفة<input data-opt="cost" type="number" value="${esc(o.cost || 0)}"></label></div>
      <div class="row-actions"><label><input data-opt="available" type="checkbox" ${o.available !== false ? "checked" : ""}> متوفر</label><button type="button" class="mini-btn red" data-remove-option>حذف الخيار</button></div>
    </div>`;
  }

  function rowCard(title, subtitle, actions) {
    return `<div class="row-card"><div class="row-head"><div><strong>${esc(title)}</strong><p class="muted">${esc(subtitle || "")}</p></div></div><div class="row-actions">${actions.map(([label, attrs, color]) => `<button class="mini-btn ${color}" ${attrs}>${label}</button>`).join("")}</div></div>`;
  }

  function renderSettings() {
    const s = state.settings;
    return `<section class="panel"><form class="stack" data-form="settings">
      <div class="form-grid"><label>اسم المطعم<input id="setName" value="${esc(s.restaurantName)}"></label><label>الشعار URL<input id="setLogo" value="${esc(s.logoUrl)}"></label><label>العملة<input id="setCurrency" value="${esc(s.currency || K.currency)}"></label></div>
      <div class="form-grid"><label>الهاتف 1<input id="setPhone1" value="${esc((s.phones || [])[0] || "")}"></label><label>الهاتف 2<input id="setPhone2" value="${esc((s.phones || [])[1] || "")}"></label><label>واتساب<input id="setWhatsapp" value="${esc(s.whatsappNumber || "")}"></label></div>
      <label>العنوان<input id="setAddress" value="${esc(s.address || "")}"></label>
      <div class="form-grid"><label><input id="setOpen" type="checkbox" ${s.isOpen ? "checked" : ""}> المطعم مفتوح</label><label><input id="setWhatsappEnabled" type="checkbox" ${s.whatsappEnabled ? "checked" : ""}> إظهار واتساب كخيار إضافي</label><label><input id="setDeliveryEnabled" type="checkbox" ${s.deliveryEnabled ? "checked" : ""}> تفعيل الدليفري</label></div>
      <div class="form-grid"><label>أوقات الدوام<input id="setHours" value="${esc(s.workingHours || "")}"></label><label>الحد الأدنى<input id="setMinimum" type="number" value="${esc(s.minimumOrder || 0)}"></label><label>رسالة الإغلاق<input id="setClosed" value="${esc(s.closedMessage || "")}"></label></div>
      <div class="form-grid"><label>خط عرض المطعم<input id="setLat" type="number" step="any" value="${esc(s.restaurantLat || "")}"></label><label>خط طول المطعم<input id="setLng" type="number" step="any" value="${esc(s.restaurantLng || "")}"></label><label>نطاق التوصيل كم<input id="setRadius" type="number" value="${esc(s.deliveryRadiusKm || 7)}"></label></div>
      <div class="form-grid"><label>نوع الأجور<select id="setFeeType"><option value="fixed" ${s.deliveryFeeType !== "per_km" ? "selected" : ""}>ثابتة</option><option value="per_km" ${s.deliveryFeeType === "per_km" ? "selected" : ""}>حسب الكيلومتر</option></select></label><label>أجور ثابتة<input id="setFee" type="number" value="${esc(s.deliveryFee || 0)}"></label><label>أجور لكل كم<input id="setFeeKm" type="number" value="${esc(s.deliveryFeePerKm || 0)}"></label></div>
      <button class="primary-btn" type="submit">حفظ الإعدادات</button>
    </form></section>`;
  }

  function renderReports() {
    const m = metrics();
    return `<section class="panel"><div class="form-grid"><label>من<input data-filter="from" type="date" value="${esc(state.dateFrom)}"></label><label>إلى<input data-filter="to" type="date" value="${esc(state.dateTo)}"></label></div></section>
      <div class="metrics">${metric("المبيعات", K.fmt(m.sales))}${metric("عدد الطلبات", m.count)}${metric("ملغية", m.canceled)}${metric("مكتملة", m.completed)}${metric("التوصيل", K.fmt(m.delivery))}${metric("الأكثر طلبًا", m.top)}</div>
      <section class="panel"><div class="row-actions"><button class="primary-btn" data-export="csv">تصدير CSV</button><button class="ghost-btn" data-export="json">تصدير JSON</button></div></section>`;
  }

  function renderBackup() {
    return `<section class="panel stack">
      <div class="row-actions"><button class="primary-btn" data-action="seed">رفع البيانات الأولية إلى Firebase</button><button class="ghost-btn" data-action="downloadBackup">تحميل البيانات الحالية JSON</button></div>
      <label>استيراد JSON<textarea id="backupJson" class="json-box" placeholder='{"categories":[],"items":[]}'></textarea></label>
      <button class="warning-btn" data-action="restoreBackup">استعادة النسخة</button>
    </section>`;
  }

  async function saveCategory() {
    const id = val("categoryId") || K.id("cat");
    const activeInput = document.getElementById("categoryActive");
    const hiddenInput = document.getElementById("categoryHidden");
    const payload = {
      name: val("categoryName"),
      details: val("categoryDetails"),
      icon: val("categoryIcon"),
      imageUrl: val("categoryImage"),
      order: num("categoryOrder"),
      active: activeInput ? activeInput.checked : true,
      hidden: hiddenInput ? hiddenInput.checked : false,
      isOffers: checked("categoryOffers")
    };
    state.editing = null;
    state.categories = state.categories.filter(category => category.id !== id).concat({ id, ...payload });
    publishMenuSync();
    await db.collection("categories").doc(id).set(payload, { merge: true });
    toast("تم حفظ الفئة.");
  }

  async function saveItem() {
    const file = document.getElementById("itemImageFile")?.files?.[0];
    const imageUrl = file ? await K.uploadImage(file, "items") : val("itemImage");
    let options = [...document.querySelectorAll(".option-editor")].map(row => ({
      id: row.dataset.optionId || K.id("opt"),
      name: row.querySelector('[data-opt="name"]').value,
      price: Number(row.querySelector('[data-opt="price"]').value || 0),
      cost: Number(row.querySelector('[data-opt="cost"]').value || 0),
      available: row.querySelector('[data-opt="available"]').checked
    })).filter(o => o.name);
    if (!options.length) {
      options = [{ id: K.id("opt"), name: "عادي", price: 0, cost: 0, available: true }];
    }
    const id = val("itemId") || K.id("item");
    const isOffer = Boolean(val("itemIsOffer"));
    const availableInput = document.getElementById("itemAvailable");
    const visibleInput = document.getElementById("itemVisible");
    const categoryId = val("itemCategory") || state.categories[0]?.id || "uncategorized";
    const payload = {
      name: val("itemName"),
      categoryId,
      description: val("itemDescription"),
      imageUrl,
      order: num("itemOrder"),
      available: availableInput ? availableInput.checked : true,
      visible: visibleInput ? visibleInput.checked : true,
      isOffer,
      oldPrice: isOffer ? num("itemOldPrice") : 0,
      offerStart: isOffer ? val("itemOfferStart") : "",
      offerEnd: isOffer ? val("itemOfferEnd") : "",
      options
    };
    state.editing = null;
    state.items = state.items.filter(item => item.id !== id).concat({ id, ...payload });
    publishMenuSync();
    await db.collection("items").doc(id).set(payload, { merge: true });
    const optionBatch = db.batch();
    options.forEach(option => optionBatch.set(db.collection("item_options").doc(`${id}_${option.id}`), { ...option, itemId: id }, { merge: true }));
    if (isOffer) {
      optionBatch.set(db.collection("offers").doc(id), {
        itemId: id,
        name: payload.name,
        oldPrice: payload.oldPrice,
        newPrice: options[0]?.price || 0,
        active: payload.available && payload.visible,
        offerStart: payload.offerStart,
        offerEnd: payload.offerEnd
      }, { merge: true });
    }
    await optionBatch.commit();
    toast("تم حفظ الصنف.");
  }

  async function saveSettings() {
    await db.collection("settings").doc("main").set({
      restaurantName: val("setName"),
      logoUrl: val("setLogo"),
      phones: [val("setPhone1"), val("setPhone2")].filter(Boolean),
      whatsappNumber: val("setWhatsapp"),
      address: val("setAddress"),
      isOpen: checked("setOpen"),
      whatsappEnabled: checked("setWhatsappEnabled"),
      deliveryEnabled: checked("setDeliveryEnabled"),
      workingHours: val("setHours"),
      minimumOrder: num("setMinimum"),
      closedMessage: val("setClosed"),
      restaurantLat: Number(val("setLat") || 0),
      restaurantLng: Number(val("setLng") || 0),
      deliveryRadiusKm: num("setRadius"),
      deliveryFeeType: val("setFeeType"),
      deliveryFee: num("setFee"),
      deliveryFeePerKm: num("setFeeKm"),
      currency: val("setCurrency") || K.currency
    }, { merge: true });
    state.settings = {
      ...state.settings,
      restaurantName: val("setName"),
      logoUrl: val("setLogo"),
      phones: [val("setPhone1"), val("setPhone2")].filter(Boolean),
      whatsappNumber: val("setWhatsapp"),
      address: val("setAddress"),
      isOpen: checked("setOpen"),
      whatsappEnabled: checked("setWhatsappEnabled"),
      deliveryEnabled: checked("setDeliveryEnabled"),
      workingHours: val("setHours"),
      minimumOrder: num("setMinimum"),
      closedMessage: val("setClosed"),
      restaurantLat: Number(val("setLat") || 0),
      restaurantLng: Number(val("setLng") || 0),
      deliveryRadiusKm: num("setRadius"),
      deliveryFeeType: val("setFeeType"),
      deliveryFee: num("setFee"),
      deliveryFeePerKm: num("setFeeKm"),
      currency: val("setCurrency") || K.currency
    };
    publishMenuSync();
    toast("تم حفظ الإعدادات.");
  }

  async function backupData() {
    const data = {
      settings: state.settings,
      categories: state.categories,
      items: state.items,
      addons: state.addons,
      offers: state.items.filter(item => item.isOffer),
      item_options: state.items.flatMap(item => (item.options || []).map(option => ({ ...option, itemId: item.id }))),
      orders: state.orders,
      customers: state.customers,
      exportedAt: new Date().toISOString()
    };
    download("kabab-backup.json", JSON.stringify(data, null, 2), "application/json");
  }
  async function restoreBackup() {
    const data = JSON.parse(val("backupJson"));
    const batch = db.batch();
    if (data.settings) batch.set(db.collection("settings").doc("main"), data.settings, { merge: true });
    ["categories", "items", "addons", "customers"].forEach(col => (data[col] || []).forEach(doc => {
      const { id, ...payload } = doc;
      batch.set(db.collection(col).doc(id || K.id(col)), payload, { merge: true });
    }));
    await batch.commit();
    toast("تمت استعادة النسخة.");
  }
  async function repairVisibility() {
    const batch = db.batch();
    state.categories.forEach(category => {
      batch.set(db.collection("categories").doc(category.id), { active: true, hidden: false }, { merge: true });
    });
    state.items.forEach(item => {
      const options = (item.options || []).length
        ? item.options.map(option => ({ ...option, available: option.available !== false }))
        : [{ id: K.id("opt"), name: "عادي", price: 0, cost: 0, available: true }];
      batch.set(db.collection("items").doc(item.id), { available: true, visible: true, options }, { merge: true });
    });
    await batch.commit();
    toast("تم إظهار الفئات والأصناف.");
  }
  function exportReport(type) {
    const list = filteredOrders();
    if (type === "json") return download("orders-report.json", JSON.stringify(list, null, 2), "application/json");
    const rows = [["id","date","customer","phone","status","total","delivery"]];
    list.forEach(o => rows.push([o.id, orderTime(o).toISOString(), o.customer?.name || "", o.customer?.phone || "", o.status || "", o.total || 0, o.deliveryFee || 0]));
    download("orders-report.csv", rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  }
  function printOrder(id) {
    const order = state.orders.find(o => o.id === id);
    const area = document.createElement("div");
    area.id = "printArea";
    area.innerHTML = `<h1>كباب الديرة</h1><h2>طلب #${esc(id)}</h2><p>${orderTime(order).toLocaleString("ar-IQ")}</p><p>${esc(order.customer?.name)} - ${esc(order.customer?.phone)}</p><hr>${(order.items || []).map(i => `<p>${esc(i.name)} / ${esc(i.optionName)} × ${esc(i.quantity)} - ${K.fmt(i.price * i.quantity)}</p>`).join("")}<hr><h2>${K.fmt(order.total)}</h2>`;
    document.body.appendChild(area);
    window.print();
    area.remove();
  }

  app.addEventListener("click", async event => {
    const el = event.target.closest("[data-tab],[data-action],[data-edit-category],[data-toggle-category],[data-delete-category],[data-edit-item],[data-toggle-item],[data-delete-item],[data-archive],[data-delete-order],[data-print],[data-export],[data-remove-option]");
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; state.editing = null; render(); }
    if (el.dataset.action === "logout") await services.auth.signOut();
    if (el.dataset.action === "enableAudio") { audioReady = true; toast("تم تفعيل صوت تنبيه الطلبات."); }
    if (el.dataset.action === "newCategory") { state.editing = null; render(); }
    if (el.dataset.action === "newItem" || el.dataset.action === "newOffer") { state.editing = null; render(); }
    if (el.dataset.editCategory) { state.editing = { type: "category", data: state.categories.find(c => c.id === el.dataset.editCategory) }; render(); }
    if (el.dataset.toggleCategory) { const c = state.categories.find(x => x.id === el.dataset.toggleCategory); await db.collection("categories").doc(c.id).set({ hidden: !c.hidden }, { merge: true }); }
    if (el.dataset.deleteCategory && confirm("حذف الفئة؟")) await db.collection("categories").doc(el.dataset.deleteCategory).delete();
    if (el.dataset.editItem) { state.editing = { type: "item", data: state.items.find(i => i.id === el.dataset.editItem) }; render(); }
    if (el.dataset.toggleItem) { const i = state.items.find(x => x.id === el.dataset.toggleItem); await db.collection("items").doc(i.id).set({ available: i.available === false }, { merge: true }); }
    if (el.dataset.deleteItem && confirm("حذف الصنف؟")) await db.collection("items").doc(el.dataset.deleteItem).delete();
    if (el.dataset.action === "addOption") document.getElementById("optionsEditor").insertAdjacentHTML("beforeend", optionForm());
    if (el.dataset.removeOption !== undefined) el.closest(".option-editor")?.remove();
    if (el.dataset.archive) await db.collection("orders").doc(el.dataset.archive).set({ archived: true }, { merge: true });
    if (el.dataset.deleteOrder && confirm("حذف الطلب؟")) await db.collection("orders").doc(el.dataset.deleteOrder).delete();
    if (el.dataset.print) printOrder(el.dataset.print);
    if (el.dataset.action === "archiveDone") {
      const batch = db.batch();
      state.orders.filter(o => o.status === "تم التسليم" || o.status === "ملغي").forEach(o => batch.set(db.collection("orders").doc(o.id), { archived: true }, { merge: true }));
      await batch.commit();
      toast("تمت الأرشفة.");
    }
    if (el.dataset.action === "seed" && confirm("رفع البيانات الأولية؟")) { await K.seedFirestore(); toast("تم رفع البيانات الأولية."); }
    if (el.dataset.action === "repairVisibility") await repairVisibility();
    if (el.dataset.action === "downloadBackup") backupData();
    if (el.dataset.action === "restoreBackup") await restoreBackup();
    if (el.dataset.export) exportReport(el.dataset.export);
  });

  app.addEventListener("change", async event => {
    if (event.target.dataset.status) {
      const id = event.target.dataset.status;
      await db.collection("orders").doc(id).set({ status: event.target.value }, { merge: true });
      await db.collection("public_order_status").doc(id).set({ status: event.target.value, updatedAtMs: Date.now() }, { merge: true });
    }
    if (event.target.dataset.filter === "from") { state.dateFrom = event.target.value; render(); }
    if (event.target.dataset.filter === "to") { state.dateTo = event.target.value; render(); }
  });

  app.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target.dataset.form;
    try {
      if (form === "category") await saveCategory();
      if (form === "item") await saveItem();
      if (form === "settings") await saveSettings();
    } catch (error) {
      toast(error.message || "حدث خطأ أثناء الحفظ.", "error-notice");
    }
  });

  services.auth.onAuthStateChanged(user => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    state.user = user;
    render();
    db.collection("categories").onSnapshot(s => { state.categories = docData(s); publishMenuSync(); render(); });
    db.collection("items").onSnapshot(s => { state.items = docData(s); publishMenuSync(); render(); });
    db.collection("settings").doc("main").onSnapshot(d => { state.settings = { ...K.settingsSeed, ...(d.exists ? d.data() : {}) }; publishMenuSync(); render(); });
    db.collection("addons").onSnapshot(s => { state.addons = docData(s); });
    db.collection("customers").onSnapshot(s => { state.customers = docData(s); });
    db.collection("orders").orderBy("createdAtMs", "desc").limit(200).onSnapshot(s => {
      const orders = docData(s);
      const newOrders = orders.filter(o => o.status === "جديد");
      if (lastNewOrderIds.size && newOrders.some(o => !lastNewOrderIds.has(o.id))) playNewOrderSound();
      lastNewOrderIds = new Set(newOrders.map(o => o.id));
      state.orders = orders;
      render();
    });
  });
})();
