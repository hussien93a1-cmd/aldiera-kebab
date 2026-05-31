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
    categories: K.localSync.read()?.categories || [],
    items: K.localSync.read()?.items || [],
    settings: K.localSync.read()?.settings || K.settingsSeed,
    orders: [],
    captainCalls: [],
    addons: K.localSync.read()?.addons || [],
    customers: [],
    editing: null,
    modal: "",
    selectedOrderId: "",
    orderDetailsFull: false,
    orderToast: "",
    dismissedOrderPopups: new Set((() => {
      try {
        return JSON.parse(localStorage.getItem("kd_dismissed_order_popups")) || [];
      } catch (error) {
        return [];
      }
    })()),
    orderFilters: {
      tab: "all",
      status: "all",
      type: "all",
      payment: "all",
      captain: "",
      date: "",
      search: "",
      sort: "newest",
      newOnly: false,
      lateOnly: false
    },
    alarmMuted: false,
    alarmSettings: (() => {
      try {
        return { sound: "urgent", volume: 0.9, browserNotifications: true, ...(JSON.parse(localStorage.getItem("kd_alarm_settings")) || {}) };
      } catch (error) {
        return { sound: "urgent", volume: 0.9, browserNotifications: true };
      }
    })(),
    dateFrom: "",
    dateTo: ""
  };
  let lastNewOrderIds = new Set();
  let audioReady = true;
  let alarmCtx = null;
  let alarmTimer = null;
  const baseTitle = document.title;
  let titleTimer = null;

  const tabs = [
    ["dashboard", "الرئيسية"],
    ["orders", "الطلبات"],
    ["categories", "الفئات"],
    ["items", "الأصناف"],
    ["addons", "الإضافات"],
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
  function visibleDocs(snap) { return docData(snap).filter(doc => doc.deleted !== true); }
  function clearMenuCache() {
    ["kd_cached_categories", "kd_cached_items", "kd_cached_settings", "kabab_menu_sync_payload", "menu_cache", "categories_cache", "items_cache"].forEach(key => localStorage.removeItem(key));
  }
  function toast(text, type = "success-notice") {
    state.modal = `<div class="notice ${type}">${esc(text)}</div>`;
    render();
    setTimeout(() => { state.modal = ""; render(); }, 2500);
  }
  function publishMenuSync() {
    K.localSync.publish({
      categories: state.categories,
      items: state.items,
      addons: state.addons,
      settings: state.settings
    });
  }
  function applyMenuSnapshot(collectionName, snap) {
    const data = visibleDocs(snap);
    state[collectionName] = data;
    publishMenuSync();
    render();
  }
  function isNewOrder(order) {
    return ["new", "جديد"].includes(order.status || "جديد") && !order.archived;
  }
  function pendingNewOrders() {
    return state.orders.filter(isNewOrder);
  }
  function saveDismissedPopups() {
    localStorage.setItem("kd_dismissed_order_popups", JSON.stringify([...state.dismissedOrderPopups]));
  }
  function activePopupOrder() {
    return pendingNewOrders().find(order => !state.dismissedOrderPopups.has(order.id));
  }
  function alarmPattern() {
    const patterns = {
      urgent: [920, 1180, 920, 1380],
      classic: [740, 740, 980],
      soft: [520, 660, 780]
    };
    return patterns[state.alarmSettings.sound] || patterns.urgent;
  }
  function saveAlarmSettings() {
    state.alarmSettings.browserNotifications = true;
    localStorage.setItem("kd_alarm_settings", JSON.stringify(state.alarmSettings));
    localStorage.setItem("kd_alarm_muted", "0");
  }
  function requestBrowserNotificationPermission() {
    if (!("Notification" in window)) return;
    state.alarmSettings.browserNotifications = true;
    saveAlarmSettings();
    if (Notification.permission === "default") {
      Notification.requestPermission().then(permission => {
        state.alarmSettings.browserNotifications = permission === "granted";
        saveAlarmSettings();
      }).catch(() => {});
    }
  }
  function startTitleAlert() {
    if (titleTimer) return;
    titleTimer = setInterval(() => {
      document.title = document.title === baseTitle ? "طلب جديد - كباب الديرة" : baseTitle;
    }, 900);
  }
  function stopTitleAlert() {
    if (titleTimer) {
      clearInterval(titleTimer);
      titleTimer = null;
    }
    document.title = baseTitle;
  }
  function primeAudio() {
    if (alarmCtx) return;
    try {
      alarmCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (alarmCtx.state === "suspended") alarmCtx.resume().catch(() => {});
      audioReady = true;
      state.alarmMuted = false;
      saveAlarmSettings();
      requestBrowserNotificationPermission();
    } catch (error) {
      audioReady = true;
    }
  }
  function beepOnce() {
    if (state.alarmMuted) state.alarmMuted = false;
    try {
      alarmCtx = alarmCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (alarmCtx.state === "suspended") alarmCtx.resume().catch(() => {});
    } catch (error) {
      return;
    }
    const now = alarmCtx.currentTime;
    alarmPattern().forEach((freq, index) => {
      const osc = alarmCtx.createOscillator();
      const gain = alarmCtx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + index * 0.18);
      gain.gain.exponentialRampToValueAtTime(Number(state.alarmSettings.volume || 0.9), now + index * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.13);
      osc.connect(gain);
      gain.connect(alarmCtx.destination);
      osc.start(now + index * 0.18);
      osc.stop(now + index * 0.18 + 0.14);
    });
  }
  function startOrderAlarm() {
    if (!pendingNewOrders().length) return;
    state.alarmMuted = false;
    saveAlarmSettings();
    primeAudio();
    startTitleAlert();
    if (alarmTimer) return;
    beepOnce();
    alarmTimer = setInterval(beepOnce, 1250);
  }
  function stopOrderAlarm(force = false) {
    if (alarmTimer) {
      clearInterval(alarmTimer);
      alarmTimer = null;
    }
    if (force) state.alarmMuted = false;
    saveAlarmSettings();
    stopTitleAlert();
  }
  function enableOrderAudio() {
    audioReady = true;
    state.alarmMuted = false;
    saveAlarmSettings();
    beepOnce();
    checkPendingOrders();
  }
  function testOrderAlarm() {
    audioReady = true;
    state.alarmMuted = false;
    saveAlarmSettings();
    beepOnce();
  }
  function notifyNewOrder(order) {
    state.dismissedOrderPopups.delete(order.id);
    saveDismissedPopups();
    state.orderToast = `طلب جديد #${order.id.slice(0, 6)} من ${order.customer?.name || "زبون"}`;
    showBrowserOrderNotification(order);
  }
  function showBrowserOrderNotification(order) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = "طلب جديد - كباب الديرة";
    const options = {
      body: `${order.customer?.name || "زبون"} - ${orderTypeLabel(order.orderType)} - ${K.fmt(order.total)}`,
      tag: `order-${order.id}`,
      renotify: true,
      requireInteraction: true,
      icon: "icons/icon-192.svg",
      badge: "icons/icon-192.svg",
      vibrate: [300, 120, 300],
      data: { orderId: order.id, url: "admin.html" }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.ready
        .then(reg => reg.showNotification(title, options))
        .catch(() => {
          const note = new Notification(title, options);
          note.onclick = () => {
            window.focus();
            state.tab = "orders";
            openOrderDetails(order.id);
          };
        });
      return;
    }
    const note = new Notification(title, options);
    note.onclick = () => {
      window.focus();
      state.tab = "orders";
      openOrderDetails(order.id);
    };
  }
  function checkPendingOrders(newOrders = []) {
    if (newOrders.length) notifyNewOrder(newOrders[0]);
    if (pendingNewOrders().length) startOrderAlarm();
    else stopOrderAlarm();
    render();
  }
  function orderTime(order) {
    if (order.createdAt?.toDate) return order.createdAt.toDate();
    return new Date(order.createdAtMs || Date.now());
  }
  function orderWaitMinutes(order) {
    return Math.max(0, Math.floor((Date.now() - orderTime(order).getTime()) / 60000));
  }
  function isLateOrder(order) {
    return isNewOrder(order) && orderWaitMinutes(order) >= 10;
  }
  function orderTabKey(order) {
    const status = order.status || "جديد";
    if (["new", "جديد"].includes(status)) return "new";
    if (["مقبول", "قيد المراجعة", "قيد التحضير"].includes(status)) return "active";
    if (status === "جاهز") return "ready";
    if (status === "مع السائق") return "driver";
    if (["تم التسليم", "مكتمل"].includes(status)) return "done";
    if (["ملغي", "مرفوض"].includes(status)) return "canceled";
    return "active";
  }
  function orderTabCounts(list = state.orders.filter(order => !order.archived)) {
    const counts = { all: list.length, new: 0, active: 0, ready: 0, driver: 0, done: 0, canceled: 0 };
    list.forEach(order => { counts[orderTabKey(order)] += 1; });
    return counts;
  }
  function filteredOnlineOrders() {
    const filters = state.orderFilters;
    let list = state.orders.filter(order => !order.archived);
    if (state.settings.showDoneOrders === false) list = list.filter(order => !["تم التسليم", "مكتمل"].includes(order.status));
    if (state.settings.showCanceledOrders === false) list = list.filter(order => !["ملغي", "مرفوض"].includes(order.status));
    if (filters.tab && filters.tab !== "all") list = list.filter(order => orderTabKey(order) === filters.tab);
    if (filters.status !== "all") list = list.filter(order => (order.status || "جديد") === filters.status);
    if (filters.type !== "all") list = list.filter(order => (order.orderType || "") === filters.type);
    if (filters.payment !== "all") list = list.filter(order => (order.paymentStatus || "دفع عند الاستلام") === filters.payment);
    if (filters.captain.trim()) {
      const q = filters.captain.trim().toLowerCase();
      list = list.filter(order => [order.driverName, order.driverPhone, order.captainName, order.captainPhone].some(value => String(value || "").toLowerCase().includes(q)));
    }
    if (filters.date) list = list.filter(order => orderTime(order).toISOString().slice(0, 10) === filters.date);
    if (filters.newOnly) list = list.filter(isNewOrder);
    if (filters.lateOnly) list = list.filter(isLateOrder);
    if (filters.search.trim()) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter(order => [order.id, order.customer?.name, order.customer?.phone].some(value => String(value || "").toLowerCase().includes(q)));
    }
    const sorters = {
      newest: (a, b) => orderTime(b) - orderTime(a),
      oldest: (a, b) => orderTime(a) - orderTime(b),
      highest: (a, b) => Number(b.total || 0) - Number(a.total || 0),
      status: (a, b) => statusClass(a.status).localeCompare(statusClass(b.status), "ar")
    };
    return [...list].sort(sorters[filters.sort] || sorters.newest).slice(0, Number(state.settings.ordersLimit || 200));
  }
  function onlineOrderStats(list = state.orders.filter(order => !order.archived)) {
    const today = new Date().toDateString();
    const doneToday = list.filter(order => ["تم التسليم", "مكتمل"].includes(order.status) && orderTime(order).toDateString() === today);
    const prepTimes = list.filter(order => order.acceptedAtMs && order.readyAtMs).map(order => Math.max(0, Math.round((order.readyAtMs - order.acceptedAtMs) / 60000)));
    return {
      newCount: list.filter(isNewOrder).length,
      preparing: list.filter(order => order.status === "قيد التحضير").length,
      ready: list.filter(order => order.status === "جاهز").length,
      completed: doneToday.length,
      canceled: list.filter(order => ["ملغي", "مرفوض"].includes(order.status)).length,
      sales: doneToday.reduce((sum, order) => sum + Number(order.total || 0), 0),
      avgPrep: prepTimes.length ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length) : 0,
      delivery: list.reduce((sum, order) => sum + Number(order.deliveryFee || 0), 0)
    };
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
    const canceled = list.filter(o => o.status === "ملغي" || o.status === "مرفوض");
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
        <button class="danger-btn" data-action="logout">تسجيل خروج</button>
      </aside>
      <section class="admin-main">
        <div class="admin-top"><h2>${tabs.find(t => t[0] === state.tab)?.[1] || ""}</h2><a class="ghost-btn" href="index.html">صفحة الزبون</a></div>
        ${state.orderToast ? `<div class="order-toast"><strong>${esc(state.orderToast)}</strong><button class="mini-btn" data-action="clearOrderToast">إغلاق</button></div>` : ""}
        ${state.modal}
        ${renderTab()}
      </section>
      ${renderNewOrderPopup()}
      ${renderOrderDetailsModal()}
    `;
    if (state.tab === "settings") requestAnimationFrame(applyItemCardPreview);
  }

  function renderTab() {
    if (state.tab === "dashboard") return renderDashboard();
    if (state.tab === "orders") return renderOrders();
    if (state.tab === "categories") return renderCategories();
    if (state.tab === "items") return renderItems(false);
    if (state.tab === "addons") return renderAddons();
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
    const live = filteredOnlineOrders();
    const pending = pendingNewOrders().length;
    const stats = onlineOrderStats();
    const tabCounts = orderTabCounts();
    return `<section class="panel order-control-panel online-orders-section">
      <div class="panel-head">
        <div><h3>طلبات الأونلاين / Online Orders</h3><p class="muted">طلبات صفحة الزبون و APK تظهر هنا لحظيًا</p></div>
        <div class="row-actions">
          <button class="ghost-btn" data-action="archiveDone">أرشفة المكتملة</button>
        </div>
      </div>
      <div class="metrics online-metrics">
        ${metric("الطلبات الجديدة", stats.newCount)}
        ${metric("قيد التحضير", stats.preparing)}
        ${metric("الجاهزة", stats.ready)}
        ${metric("مكتملة اليوم", stats.completed)}
        ${metric("الملغية", stats.canceled)}
        ${metric("مبيعات اليوم", K.fmt(stats.sales))}
        ${metric("متوسط التحضير", stats.avgPrep + " دقيقة")}
        ${metric("أجور التوصيل", K.fmt(stats.delivery))}
      </div>
      <div class="alarm-settings">
        <label>صوت التنبيه<select data-alarm-setting="sound">
          <option value="urgent" ${state.alarmSettings.sound === "urgent" ? "selected" : ""}>قوي وصاخب</option>
          <option value="classic" ${state.alarmSettings.sound === "classic" ? "selected" : ""}>كلاسيكي</option>
          <option value="soft" ${state.alarmSettings.sound === "soft" ? "selected" : ""}>هادئ</option>
        </select></label>
        <label>مستوى الصوت<input type="range" min="0.1" max="1" step="0.1" value="${esc(state.alarmSettings.volume)}" data-alarm-setting="volume"></label>
      </div>
      ${renderCaptainCalls()}
      <div class="order-tabs">
        ${[
          ["all", "جميع الطلبات"],
          ["new", "جديدة"],
          ["active", "قيد التنفيذ"],
          ["ready", "جاهزة"],
          ["driver", "مع السائق"],
          ["done", "مكتملة"],
          ["canceled", "ملغية"]
        ].map(([key, label]) => `<button class="order-tab ${state.orderFilters.tab === key ? "active" : ""}" data-order-tab="${key}">${label} (${tabCounts[key] || 0})</button>`).join("")}
      </div>
      <div class="order-filters">
        <label>بحث<input data-order-filter="search" placeholder="رقم الطلب / الاسم / الهاتف" value="${esc(state.orderFilters.search)}"></label>
        <label>الحالة<select data-order-filter="status"><option value="all">كل الحالات</option>${K.orderStatuses.map(s => `<option value="${s}" ${state.orderFilters.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label>نوع الطلب<select data-order-filter="type"><option value="all">كل الأنواع</option><option value="delivery" ${state.orderFilters.type === "delivery" ? "selected" : ""}>دليفري</option><option value="takeaway" ${state.orderFilters.type === "takeaway" ? "selected" : ""}>سفري</option><option value="dinein" ${state.orderFilters.type === "dinein" ? "selected" : ""}>صالة</option></select></label>
        <label>الدفع<select data-order-filter="payment"><option value="all">كل حالات الدفع</option><option value="دفع عند الاستلام" ${state.orderFilters.payment === "دفع عند الاستلام" ? "selected" : ""}>دفع عند الاستلام</option><option value="مدفوع" ${state.orderFilters.payment === "مدفوع" ? "selected" : ""}>مدفوع</option><option value="غير مدفوع" ${state.orderFilters.payment === "غير مدفوع" ? "selected" : ""}>غير مدفوع</option></select></label>
        <label>التاريخ<input type="date" data-order-filter="date" value="${esc(state.orderFilters.date || "")}"></label>
        <label>الكابتن<input data-order-filter="captain" placeholder="اسم أو رقم الكابتن" value="${esc(state.orderFilters.captain || "")}"></label>
        <label>الترتيب<select data-order-filter="sort"><option value="newest" ${state.orderFilters.sort === "newest" ? "selected" : ""}>الأحدث</option><option value="oldest" ${state.orderFilters.sort === "oldest" ? "selected" : ""}>الأقدم</option><option value="highest" ${state.orderFilters.sort === "highest" ? "selected" : ""}>الأعلى قيمة</option><option value="status" ${state.orderFilters.sort === "status" ? "selected" : ""}>حسب الحالة</option></select></label>
        <label class="inline-check"><input type="checkbox" data-order-filter="newOnly" ${state.orderFilters.newOnly ? "checked" : ""}> الطلبات الجديدة فقط</label>
        <label class="inline-check"><input type="checkbox" data-order-filter="lateOnly" ${state.orderFilters.lateOnly ? "checked" : ""}> الطلبات المتأخرة</label>
        <button class="ghost-btn" data-action="refreshOrders">تحديث</button>
      </div>
      <div class="order-status-board">${renderOrderStatusBoard(live)}</div>
    </section>`;
  }

  function statusClass(status = "جديد") {
    if (["new", "جديد"].includes(status)) return "new";
    if (status === "قيد المراجعة") return "review";
    if (status === "مقبول") return "accepted";
    if (status === "قيد التحضير") return "preparing";
    if (status === "جاهز") return "ready";
    if (status === "مع السائق") return "driver";
    if (status === "تم التسليم" || status === "مكتمل") return "done";
    if (status === "مرفوض" || status === "ملغي") return "canceled";
    return "neutral";
  }

  function orderTypeLabel(type) {
    return { delivery: "دليفري", takeaway: "سفري", dinein: "صالة" }[type] || type || "غير محدد";
  }

  function renderNewOrderPopup() {
    const order = activePopupOrder();
    if (!order) return "";
    return `<div class="new-order-popup" role="dialog" aria-modal="true">
      <section class="floating-order-modal status-new">
        <div class="popup-pulse"></div>
        <div class="panel-head">
          <div><span class="new-badge">طلب جديد</span><h2>#${esc(order.id.slice(0, 8))}</h2></div>
          <button class="mini-btn" data-dismiss-order-popup="${order.id}">إغلاق مؤقت</button>
        </div>
        <div class="popup-order-summary">
          <p><strong>الزبون:</strong> ${esc(order.customer?.name || "زبون")}</p>
          <p><strong>الهاتف:</strong> ${esc(order.customer?.phone || "غير مسجل")}</p>
          <p><strong>نوع الطلب:</strong> ${esc(orderTypeLabel(order.orderType))}</p>
          <p><strong>المبلغ:</strong> ${K.fmt(order.total)}</p>
          <p><strong>الوقت:</strong> ${orderTime(order).toLocaleString("ar-IQ")}</p>
        </div>
        <div class="row-actions popup-actions">
          <button class="success-btn" data-accept-order="${order.id}">قبول الطلب</button>
          <button class="ghost-btn" data-order-open="${order.id}">عرض التفاصيل</button>
          <button class="danger-btn" data-reject-order="${order.id}">رفض الطلب</button>
        </div>
      </section>
    </div>`;
  }

  function renderOrderStatusBoard(orders) {
    const statuses = ["جديد", "قيد المراجعة", "مقبول", "قيد التحضير", "جاهز", "مع السائق", "تم التسليم", "مرفوض", "ملغي"];
    const lanes = statuses.map(status => {
      const group = orders.filter(order => (order.status || "جديد") === status || (status === "جديد" && order.status === "new"));
      if (!group.length) return "";
      return `<section class="status-lane status-${statusClass(status)}">
        <div class="status-lane-head"><h4>${esc(status)}</h4><span>${group.length}</span></div>
        ${renderOrderCards(group)}
      </section>`;
    }).join("");
    return lanes || `<div class="notice">لا توجد طلبات واردة حاليًا.</div>`;
  }

  function renderCaptainCalls() {
    const calls = state.captainCalls.filter(call => !call.handled).slice(0, 5);
    if (!calls.length) return "";
    return `<section class="captain-calls-panel">
      <div>
        <strong>استدعاءات الكابتن</strong>
        <p class="muted">طلبات تواصل أرسلها الزبائن من شاشة متابعة الطلب.</p>
      </div>
      <div class="captain-calls-list">
        ${calls.map(call => `<article class="captain-call-card">
          <div>
            <span class="new-badge">استدعاء كابتن</span>
            <h4>طلب #${esc(call.orderShortId || String(call.orderId || "").slice(0, 8))}</h4>
            <p>${esc(call.customerName || "زبون")} - ${esc(call.customerPhone || "")}</p>
            <small>${new Date(call.createdAtMs || Date.now()).toLocaleString("ar-IQ")}</small>
          </div>
          <div class="row-actions">
            ${call.driverPhone ? `<a class="mini-btn green" href="tel:${esc(call.driverPhone)}">اتصال بالكابتن</a>` : `<span class="muted">لا يوجد كابتن معين</span>`}
            <button class="mini-btn" data-handle-captain-call="${call.id}">تمت المعالجة</button>
          </div>
        </article>`).join("")}
      </div>
    </section>`;
  }

  function renderOrderCards(orders) {
    if (!orders.length) return `<div class="notice">لا توجد طلبات واردة حاليًا.</div>`;
    return `<div class="order-card-grid">${orders.map(order => {
      const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const status = order.status || "جديد";
      const wait = orderWaitMinutes(order);
      const mapsUrl = orderMapsUrl(order);
      const payment = order.paymentStatus || "دفع عند الاستلام";
      const source = order.source || "صفحة الزبون";
      const driverName = order.driverName || order.captainName || "";
      const driverPhone = order.driverPhone || order.captainPhone || "";
      const quickActions = orderCardActions(order);
      return `<article class="order-card enhanced-order-card status-${statusClass(status)} ${isNewOrder(order) ? "is-new-order" : ""}">
        <div class="order-card-head">
          <div><strong>#${esc(order.id.slice(0, 8))}</strong><span class="status-chip status-${statusClass(status)}">${esc(status)}</span></div>
          ${isNewOrder(order) ? `<span class="new-badge">طلب جديد</span>` : ""}
        </div>
        <div class="order-status-control order-status-control-card status-${statusClass(status)}">
          <label><span>🔄 تحديث الحالة</span><select data-status="${order.id}">${K.orderStatuses.map(s => `<option class="status-option-${statusClass(s)}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        </div>
        <div class="order-meta">
          <span>${orderTime(order).toLocaleString("ar-IQ")}</span>
          <span>منذ ${wait} دقيقة</span>
          <span>${esc(orderTypeLabel(order.orderType))}</span>
          <span>المصدر: ${esc(source)}</span>
          <span>${esc(payment)}</span>
          ${isLateOrder(order) ? `<span class="late-badge">متأخر</span>` : ""}
        </div>
        <div class="order-customer-block">
          <h3>${esc(order.customer?.name || "زبون")}</h3>
          <p>${esc(order.customer?.phone || "لا يوجد رقم")}</p>
        </div>
        <p class="muted">${esc(order.orderType === "delivery" ? (order.customer?.address || "لا يوجد عنوان توصيل") : (order.tableNumber ? `طاولة ${order.tableNumber}` : order.customer?.address || "سفري / صالة"))}</p>
        ${driverName || driverPhone ? `<p class="muted">الكابتن: ${esc(driverName || "غير مسمى")} ${driverPhone ? `- ${esc(driverPhone)}` : ""}</p>` : ""}
        ${order.distanceKm ? `<p class="muted">المسافة: ${Number(order.distanceKm).toFixed(2)} كم - الوقت: ${Number(order.routeDurationMin || 0)} دقيقة - التوصيل: ${K.fmt(order.deliveryFee)}</p>` : ""}
        <div class="order-summary-line"><span>${itemCount} صنف</span><strong>${K.fmt(order.total)}</strong></div>
        ${order.notes ? `<p class="order-note">${esc(order.notes)}</p>` : ""}
        <div class="row-actions order-card-actions">
          ${quickActions}
          <button class="mini-btn" data-print-kitchen="${order.id}">طباعة</button>
          <button class="mini-btn" data-order-open="${order.id}">التفاصيل</button>
          ${order.customer?.phone ? `<a class="mini-btn" href="tel:${esc(order.customer.phone)}">اتصال</a><a class="mini-btn green" target="_blank" href="${esc(orderWhatsAppUrl(order))}">واتساب</a>` : ""}
          ${mapsUrl ? `<a class="mini-btn" href="${esc(mapsUrl)}" target="_blank">الخريطة</a>` : ""}
          <button class="mini-btn" data-assign-driver="${order.id}">تعيين كابتن</button>
          <button class="mini-btn" data-internal-note="${order.id}">ملاحظة</button>
        </div>
      </article>`;
    }).join("")}</div>`;
  }

  function orderCardActions(order) {
    const status = order.status || "جديد";
    const id = order.id;
    if (["new", "جديد"].includes(status)) {
      return `<button class="mini-btn green" data-accept-order="${id}">قبول</button><button class="mini-btn red" data-reject-order="${id}">إلغاء</button>`;
    }
    if (status === "مقبول" || status === "قيد المراجعة") {
      return `<button class="mini-btn orange" data-status-quick="${id}" data-next-status="قيد التحضير">بدء التحضير</button><button class="mini-btn red" data-status-quick="${id}" data-next-status="ملغي">إلغاء</button>`;
    }
    if (status === "قيد التحضير") {
      return `<button class="mini-btn green" data-status-quick="${id}" data-next-status="جاهز">جاهز</button><button class="mini-btn red" data-status-quick="${id}" data-next-status="ملغي">إلغاء</button>`;
    }
    if (status === "جاهز") {
      return `${order.orderType === "delivery" ? `<button class="mini-btn" data-assign-driver="${id}">تعيين كابتن</button><button class="mini-btn cyan" data-status-quick="${id}" data-next-status="مع السائق">تسليم للكابتن</button>` : `<button class="mini-btn green" data-status-quick="${id}" data-next-status="تم التسليم">مكتمل</button>`}`;
    }
    if (status === "مع السائق") {
      return `<button class="mini-btn green" data-status-quick="${id}" data-next-status="تم التسليم">مكتمل</button>`;
    }
    return "";
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

  function selectedOrder() {
    return state.orders.find(order => order.id === state.selectedOrderId);
  }

  function orderMapsUrl(order) {
    return order.customer?.lat && order.customer?.lng
      ? `https://www.google.com/maps/dir/?api=1&destination=${order.customer.lat},${order.customer.lng}`
      : (order.customer?.mapsUrl || "");
  }
  function customerLocationUrl(order) {
    if (order.customer?.lat && order.customer?.lng) {
      return `https://www.google.com/maps?q=${order.customer.lat},${order.customer.lng}`;
    }
    return order.customer?.mapsUrl || "";
  }
  function whatsappPhone(raw) {
    let digits = String(raw || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = `964${digits.slice(1)}`;
    if (!digits.startsWith("964") && digits.length === 10) digits = `964${digits}`;
    return digits;
  }
  function orderWhatsAppText(order) {
    const location = customerLocationUrl(order);
    const lines = [
      `طلب #${order.id.slice(0, 8)}`,
      `الزبون: ${order.customer?.name || ""}`,
      `الهاتف: ${order.customer?.phone || ""}`,
      `نوع الطلب: ${orderTypeLabel(order.orderType)}`,
      `العنوان: ${order.customer?.address || order.tableNumber || ""}`,
      location ? `موقع الزبون: ${location}` : "موقع الزبون: غير محدد",
      "",
      "الأصناف:"
    ];
    (order.items || []).forEach(item => {
      lines.push(`- ${item.name || ""}${item.optionName ? ` / ${item.optionName}` : ""} × ${item.quantity || 1} = ${K.fmt(Number(item.price || 0) * Number(item.quantity || 1))}`);
      if (item.addons) lines.push(`  الإضافات: ${item.addons}`);
      if (item.notes) lines.push(`  ملاحظة: ${item.notes}`);
    });
    lines.push("");
    if (order.notes) lines.push(`ملاحظات الطلب: ${order.notes}`);
    lines.push(`المجموع الفرعي: ${K.fmt(order.subtotal || 0)}`);
    lines.push(`التوصيل: ${K.fmt(order.deliveryFee || 0)}`);
    lines.push(`الخصم: ${K.fmt(order.discount || 0)}`);
    lines.push(`الإجمالي النهائي: ${K.fmt(order.total || 0)}`);
    return lines.join("\n");
  }
  function orderWhatsAppUrl(order) {
    const phone = whatsappPhone(order.customer?.phone || state.settings.whatsappNumber);
    return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(orderWhatsAppText(order))}` : "";
  }
  function renderStatusTimeline(order) {
    const history = order.statusHistory || [];
    if (!history.length) {
      return `<div class="timeline"><div><strong>وصول الطلب</strong><span>${orderTime(order).toLocaleString("ar-IQ")}</span></div></div>`;
    }
    return `<div class="timeline">${history.map(entry => `<div><strong>${esc(entry.status || "")}</strong><span>${new Date(entry.atMs || Date.now()).toLocaleString("ar-IQ")} - ${esc(entry.by || "النظام")}</span>${entry.reason ? `<p class="muted">${esc(entry.reason)}</p>` : ""}</div>`).join("")}</div>`;
  }

  function renderOrderDetailsModal() {
    const order = selectedOrder();
    if (!order) return `<div id="adminModal" class="modal"></div>`;
    const mapsUrl = orderMapsUrl(order);
    const locationUrl = customerLocationUrl(order);
    const waUrl = orderWhatsAppUrl(order);
    const status = order.status || "جديد";
    const statusControl = `<div class="order-status-control status-${statusClass(status)}">
      <label><span>🔄 تحديث الحالة</span><select data-status="${order.id}">${K.orderStatuses.map(s => `<option class="status-option-${statusClass(s)}" ${s === status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
    </div>`;
    const orderItemsHtml = `<div class="order-lines order-lines-large">${(order.items || []).map(item => `<div class="order-line order-line-summary">
      <div><strong>${esc(item.name)}</strong><p class="muted">${esc(item.optionName || "")}${item.addons ? ` - إضافات: ${esc(item.addons)}` : ""}</p>${item.notes ? `<p class="muted">ملاحظة: ${esc(item.notes)}</p>` : ""}</div>
      ${item.available === false ? `<span class="late-badge">غير متوفر</span>` : ""}
      <span>×${esc(item.quantity || 1)}</span>
      <span>${K.fmt(item.price || 0)}</span>
      <strong>${K.fmt(Number(item.price || 0) * Number(item.quantity || 1))}</strong>
    </div>`).join("") || `<div class="notice">لا توجد أصناف داخل الطلب.</div>`}</div>`;
    if (!state.orderDetailsFull) {
      return `<div id="adminModal" class="modal open">
        <section class="modal-card order-details-modal order-items-modal">
          <div class="panel-head">
            <div><h2>أصناف الطلب #${esc(order.id.slice(0, 8))}</h2><p class="muted">${esc(orderTypeLabel(order.orderType))} - ${K.fmt(order.total)}</p></div>
            <button class="ghost-btn" data-action="closeOrderModal">إغلاق</button>
          </div>
          ${statusControl}
          <div class="panel">
            <h3>الأصناف المطلوبة</h3>
            ${orderItemsHtml}
          </div>
          <div class="row-actions order-modal-actions">
            <button class="primary-btn details-full-btn" data-show-full-details="${order.id}">إظهار التفاصيل الكاملة</button>
            <button class="success-btn" data-accept-order="${order.id}">قبول الطلب</button>
            <button class="danger-btn" data-reject-order="${order.id}">رفض الطلب</button>
          </div>
        </section>
      </div>`;
    }
    return `<div id="adminModal" class="modal open">
      <section class="modal-card order-details-modal">
        <div class="panel-head">
          <div><h2>تفاصيل الطلب #${esc(order.id.slice(0, 8))}</h2><p class="muted">${orderTime(order).toLocaleString("ar-IQ")} - ${esc(orderTypeLabel(order.orderType))}</p></div>
          <button class="ghost-btn" data-action="closeOrderModal">إغلاق</button>
        </div>
        ${statusControl}
        <div class="order-detail-grid">
          <div class="panel stack">
            <h3>معلومات الزبون</h3>
            <p><strong>الاسم:</strong> ${esc(order.customer?.name || "")}</p>
            <p><strong>الهاتف:</strong> ${esc(order.customer?.phone || "")}</p>
            <p><strong>العنوان:</strong> ${esc(order.customer?.address || order.tableNumber || "")}</p>
            <p><strong>موقع الزبون:</strong> ${locationUrl ? `<a href="${esc(locationUrl)}" target="_blank">فتح Google Maps</a>` : "غير محدد"}</p>
            <p><strong>المنطقة:</strong> ${esc(order.customer?.region || "غير محددة")}</p>
            <p><strong>المسافة:</strong> ${order.distanceKm ? `${Number(order.distanceKm).toFixed(2)} كم` : "غير محسوبة"}</p>
            <p><strong>مدة الطريق:</strong> ${order.routeDurationMin ? `${Number(order.routeDurationMin)} دقيقة` : "غير محسوبة"}</p>
            <p><strong>مزود الخرائط:</strong> ${esc(order.routeProvider || "غير محدد")}</p>
            <p><strong>الملاحظات:</strong> ${esc(order.notes || "لا توجد")}</p>
            <p><strong>الدفع:</strong> ${esc(order.paymentStatus || "غير محدد")}</p>
            <p><strong>المصدر:</strong> ${esc(order.source || "صفحة الزبون")}</p>
          </div>
          <div class="panel stack">
            <h3>الحالة والإجمالي</h3>
            <span class="status-chip">${esc(status)}</span>
            <p><strong>مجموع الطلب:</strong> ${K.fmt(order.subtotal)}</p>
            <p><strong>التوصيل:</strong> ${K.fmt(order.deliveryFee)}</p>
            <p><strong>التوصيل قبل التقريب:</strong> ${K.fmt(order.rawDeliveryFee || order.deliveryFee || 0)}</p>
            <p><strong>التوصيل بعد التقريب:</strong> ${K.fmt(order.roundedDeliveryFee || order.deliveryFee || 0)}</p>
            <p><strong>طريقة التقريب:</strong> ${esc(order.roundingMethod || "nearest_250_up")}</p>
            <p><strong>الخصم:</strong> ${K.fmt(order.discount || 0)}</p>
            <p><strong>الإجمالي النهائي:</strong> ${K.fmt(order.total)}</p>
          </div>
        </div>
        <div class="panel">
          <h3>الأصناف</h3>
          ${orderItemsHtml}
        </div>
        <div class="panel"><h3>سجل الحالة</h3>${renderStatusTimeline(order)}</div>
        <div class="order-detail-grid">
          <div class="panel stack">
            <h3>الكابتن / السائق</h3>
            <p><strong>الاسم:</strong> ${esc(order.driverName || order.captainName || "غير معين")}</p>
            <p><strong>الهاتف:</strong> ${esc(order.driverPhone || order.captainPhone || "غير متوفر")}</p>
            <p><strong>وقت التعيين:</strong> ${order.driverAssignedAtMs ? new Date(order.driverAssignedAtMs).toLocaleString("ar-IQ") : "غير معين"}</p>
          </div>
          <div class="panel stack">
            <h3>ملاحظات الإدارة</h3>
            <p>${esc(order.internalNote || "لا توجد ملاحظات داخلية")}</p>
            ${(order.internalNotes || []).slice(-4).map(entry => `<small class="muted">${new Date(entry.atMs || Date.now()).toLocaleString("ar-IQ")} - ${esc(entry.by || "admin")}: ${esc(entry.note || "")}</small>`).join("")}
          </div>
        </div>
        <div class="panel stack">
          <h3>سجل واتساب واستدعاءات الكابتن</h3>
          <p><strong>رسائل واتساب المرسلة:</strong> ${Object.keys(order.whatsappStatusSent || {}).join("، ") || "لا توجد"}</p>
          <p><strong>استدعاءات الكابتن:</strong> ${state.captainCalls.filter(call => call.orderId === order.id).length || 0}</p>
        </div>
        <div class="row-actions order-modal-actions">
          <button class="success-btn" data-accept-order="${order.id}">قبول الطلب</button>
          <button class="danger-btn" data-reject-order="${order.id}">رفض الطلب</button>
          <button class="warning-btn" data-status-quick="${order.id}" data-next-status="قيد التحضير">قيد التحضير</button>
          <button class="success-btn" data-status-quick="${order.id}" data-next-status="جاهز">جاهز</button>
          <button class="ghost-btn" data-status-quick="${order.id}" data-next-status="مع السائق">مع السائق</button>
          <button class="success-btn" data-status-quick="${order.id}" data-next-status="تم التسليم">مكتمل</button>
          <button class="danger-btn" data-status-quick="${order.id}" data-next-status="ملغي">ملغي</button>
          <button class="ghost-btn" data-print-driver="${order.id}">طباعة نسخة الموصل</button>
          <button class="ghost-btn" data-print-kitchen="${order.id}">طباعة طلب مطبخ</button>
          <button class="ghost-btn" data-print-invoice="${order.id}">طباعة فاتورة زبون</button>
          <button class="ghost-btn" data-copy-order="${order.id}">نسخ بيانات الطلب</button>
          <button class="ghost-btn" data-assign-driver="${order.id}">تعيين كابتن</button>
          <button class="ghost-btn" data-internal-note="${order.id}">حفظ ملاحظة داخلية</button>
          ${order.customer?.phone ? `<button class="ghost-btn" data-copy-phone="${order.id}">نسخ رقم الهاتف</button>` : ""}
          ${mapsUrl ? `<a class="ghost-btn" href="${esc(mapsUrl)}" target="_blank">فتح المسار للسائق</a>` : ""}
          ${order.customer?.phone ? `<a class="ghost-btn" href="tel:${esc(order.customer.phone)}">اتصال</a>` : ""}
          ${waUrl ? `<a class="success-btn" target="_blank" href="${esc(waUrl)}">إرسال واتساب</a>` : ""}
        </div>
      </section>
    </div>`;
  }

  function renderCategories() {
    return `<div class="split">
      <section class="panel">${categoryForm()}</section>
      <section class="panel"><div class="panel-head"><h3>الفئات</h3><div class="row-actions"><button class="ghost-btn" data-action="repairVisibility">إظهار الكل</button><button class="ghost-btn" data-action="newCategory">تفريغ النموذج</button></div></div>
        <div class="data-grid">${K.sortByOrder(state.categories).map(c => rowCard(c.name, `${c.details || ""}${c.details ? " | " : ""}${categoryVisibilityText(c)}`, [
          ["تعديل", `data-edit-category="${c.id}"`, ""],
          [c.hidden ? "إظهار" : "إخفاء", `data-toggle-category="${c.id}"`, "orange"],
          ["حذف", `data-delete-category="${c.id}"`, "red"]
        ])).join("")}</div>
      </section>
    </div>`;
  }

  function categoryForm(c = state.editing?.type === "category" ? state.editing.data : {}) {
    const visibility = categoryVisibility(c);
    return `<h3>${c.id ? "تعديل فئة" : "إضافة فئة"}</h3><form class="stack" data-form="category">
      <input id="categoryId" type="hidden" value="${esc(c.id || "")}">
      <div class="form-grid"><label>اسم الفئة<input id="categoryName" value="${esc(c.name || "")}" required></label><label>الترتيب<input id="categoryOrder" type="number" value="${esc(c.order || 1)}"></label></div>
      <div class="form-grid"><label>الأيقونة<input id="categoryIcon" value="${esc(c.icon || "flame")}"></label><label>رابط الصورة<input id="categoryImage" value="${esc(c.imageUrl || "")}"></label><label>رفع صورة من الجهاز<input id="categoryImageFile" type="file" accept="image/*"></label></div>
      <label>الوصف<textarea id="categoryDetails">${esc(c.details || "")}</textarea></label>
      <div class="form-grid"><label><input id="categoryActive" type="checkbox" ${c.active !== false ? "checked" : ""}> مفعلة</label><label><input id="categoryHidden" type="checkbox" ${c.hidden ? "checked" : ""}> مخفية</label><label><input id="categoryOffers" type="checkbox" ${c.isOffers ? "checked" : ""}> فئة عروض</label></div>
      <section class="visibility-settings">
        <div class="panel-head">
          <div><h4>إعدادات الظهور حسب نوع الطلب</h4><p class="muted">حدد أين تظهر هذه الفئة في صفحة الزبون.</p></div>
          <div class="row-actions">
            <button class="mini-btn" type="button" data-action="categoryVisibilityAll">تحديد الكل</button>
            <button class="mini-btn red" type="button" data-action="categoryVisibilityNone">إلغاء الكل</button>
          </div>
        </div>
        <div class="form-grid">
          <label><input class="category-visibility-input" id="categoryShowDinein" type="checkbox" ${visibility.dinein ? "checked" : ""}> إظهار في تناول داخل المطعم</label>
          <label><input class="category-visibility-input" id="categoryShowTakeaway" type="checkbox" ${visibility.takeaway ? "checked" : ""}> إظهار في السفري</label>
          <label><input class="category-visibility-input" id="categoryShowDelivery" type="checkbox" ${visibility.delivery ? "checked" : ""}> إظهار في الدليفري</label>
        </div>
      </section>
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

  function categoryVisibility(category = {}) {
    const saved = category.orderVisibility || {};
    return {
      dinein: saved.dinein !== undefined ? saved.dinein !== false : category.id === "weight" ? false : true,
      takeaway: saved.takeaway !== undefined ? saved.takeaway !== false : true,
      delivery: saved.delivery !== undefined ? saved.delivery !== false : true
    };
  }
  function categoryVisibilityText(category = {}) {
    const v = categoryVisibility(category);
    const labels = [];
    if (v.dinein) labels.push("صالة");
    if (v.takeaway) labels.push("سفري");
    if (v.delivery) labels.push("دليفري");
    return labels.length ? `الظهور: ${labels.join("، ")}` : "مخفية من كل أنواع الطلب";
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

  function renderAddons() {
    return `<div class="split">
      <section class="panel">${addonForm()}</section>
      <section class="panel"><div class="panel-head"><h3>الإضافات</h3><button class="ghost-btn" data-action="newAddon">تفريغ النموذج</button></div>
        <div class="data-grid">${K.sortByOrder(state.addons).map(addon => rowCard(`${addon.name} - ${K.fmt(addon.price)}`, `${addon.available === false ? "غير متوفر" : "متوفر"} | ${addon.visible === false ? "مخفي" : "ظاهر"}`, [
          ["تعديل", `data-edit-addon="${addon.id}"`, ""],
          [addon.visible === false ? "إظهار" : "إخفاء", `data-toggle-addon="${addon.id}"`, "orange"],
          ["حذف", `data-delete-addon="${addon.id}"`, "red"]
        ])).join("") || `<div class="notice">لا توجد إضافات بعد.</div>`}</div>
      </section>
    </div>`;
  }

  function addonForm(addon = state.editing?.type === "addon" ? state.editing.data : {}) {
    return `<h3>${addon.id ? "تعديل إضافة" : "إضافة جديدة"}</h3><form class="stack" data-form="addon">
      <input id="addonId" type="hidden" value="${esc(addon.id || "")}">
      <div class="form-grid">
        <label>اسم الإضافة<input id="addonName" value="${esc(addon.name || "")}" required></label>
        <label>السعر<input id="addonPrice" type="number" value="${esc(addon.price || 0)}"></label>
      </div>
      <div class="form-grid">
        <label>التكلفة<input id="addonCost" type="number" value="${esc(addon.cost || 0)}"></label>
        <label>الترتيب<input id="addonOrder" type="number" value="${esc(addon.order || 1)}"></label>
      </div>
      <div class="form-grid">
        <label><input id="addonAvailable" type="checkbox" ${addon.available !== false ? "checked" : ""}> متوفر</label>
        <label><input id="addonVisible" type="checkbox" ${addon.visible !== false ? "checked" : ""}> ظاهر</label>
      </div>
      <button class="primary-btn" type="submit">حفظ الإضافة</button>
    </form>`;
  }

  function rowCard(title, subtitle, actions) {
    return `<div class="row-card"><div class="row-head"><div><strong>${esc(title)}</strong><p class="muted">${esc(subtitle || "")}</p></div></div><div class="row-actions">${actions.map(([label, attrs, color]) => `<button class="mini-btn ${color}" ${attrs}>${label}</button>`).join("")}</div></div>`;
  }

  const itemCardPresets = {
    luxury_dark: {
      background: "#111827", text: "#fff7ed", description: "#ffedd5", price: "#fbbf24", badgeBg: "#f97316", badgeText: "#ffffff", buttonBg: "#f97316", buttonText: "#ffffff", border: "#fbbf24", shadowColor: "#0f172a"
    },
    modern_blue: {
      background: "#f8fcff", text: "#0f172a", description: "#475569", price: "#0284c7", badgeBg: "#38bdf8", badgeText: "#083344", buttonBg: "#0ea5e9", buttonText: "#ffffff", border: "#7dd3fc", shadowColor: "#0ea5e9"
    },
    minimal_white: {
      background: "#ffffff", text: "#111827", description: "#6b7280", price: "#111827", badgeBg: "#f3f4f6", badgeText: "#111827", buttonBg: "#111827", buttonText: "#ffffff", border: "#e5e7eb", shadowColor: "#9ca3af"
    },
    premium_orange: {
      background: "#fff7ed", text: "#1c1917", description: "#78716c", price: "#ea580c", badgeBg: "#f97316", badgeText: "#ffffff", buttonBg: "#ea580c", buttonText: "#ffffff", border: "#fdba74", shadowColor: "#ea580c"
    },
    indigo_pro: {
      background: "#eef2ff", text: "#111827", description: "#475569", price: "#4f46e5", badgeBg: "#4f46e5", badgeText: "#ffffff", buttonBg: "#f97316", buttonText: "#ffffff", border: "#818cf8", shadowColor: "#4f46e5"
    }
  };

  function itemCardThemeSettings() {
    return { ...(K.settingsSeed.itemCardTheme || {}), ...(state.settings.itemCardTheme || {}) };
  }

  function itemCardThemeInputs(theme = itemCardThemeSettings()) {
    return `<div class="form-grid">
          <label>لون خلفية البطاقة<input id="setItemCardBg" data-item-card-theme="background" type="color" value="${esc(theme.background || "#111827")}"><input id="setItemCardBgHex" data-item-card-theme="background" value="${esc(theme.background || "#111827")}"></label>
          <label>لون اسم الصنف<input id="setItemCardText" data-item-card-theme="text" type="color" value="${esc(theme.text || "#fff7ed")}"><input id="setItemCardTextHex" data-item-card-theme="text" value="${esc(theme.text || "#fff7ed")}"></label>
          <label>لون الوصف<input id="setItemCardDesc" data-item-card-theme="description" type="color" value="${esc(theme.description || "#ffedd5")}"><input id="setItemCardDescHex" data-item-card-theme="description" value="${esc(theme.description || "#ffedd5")}"></label>
        </div>
        <div class="form-grid">
          <label>لون السعر<input id="setItemCardPrice" data-item-card-theme="price" type="color" value="${esc(theme.price || "#fbbf24")}"><input id="setItemCardPriceHex" data-item-card-theme="price" value="${esc(theme.price || "#fbbf24")}"></label>
          <label>لون البادج<input id="setItemCardBadgeBg" data-item-card-theme="badgeBg" type="color" value="${esc(theme.badgeBg || "#f97316")}"><input id="setItemCardBadgeBgHex" data-item-card-theme="badgeBg" value="${esc(theme.badgeBg || "#f97316")}"></label>
          <label>لون نص البادج<input id="setItemCardBadgeText" data-item-card-theme="badgeText" type="color" value="${esc(theme.badgeText || "#ffffff")}"><input id="setItemCardBadgeTextHex" data-item-card-theme="badgeText" value="${esc(theme.badgeText || "#ffffff")}"></label>
        </div>
        <div class="form-grid">
          <label>لون زر الإضافة<input id="setItemCardButtonBg" data-item-card-theme="buttonBg" type="color" value="${esc(theme.buttonBg || "#f97316")}"><input id="setItemCardButtonBgHex" data-item-card-theme="buttonBg" value="${esc(theme.buttonBg || "#f97316")}"></label>
          <label>لون نص الزر<input id="setItemCardButtonText" data-item-card-theme="buttonText" type="color" value="${esc(theme.buttonText || "#ffffff")}"><input id="setItemCardButtonTextHex" data-item-card-theme="buttonText" value="${esc(theme.buttonText || "#ffffff")}"></label>
          <label>لون الحدود<input id="setItemCardBorder" data-item-card-theme="border" type="color" value="${esc(theme.border || "#fbbf24")}"><input id="setItemCardBorderHex" data-item-card-theme="border" value="${esc(theme.border || "#fbbf24")}"></label>
        </div>
        <div class="form-grid">
          <label><input id="setItemCardBorderEnabled" data-item-card-theme="borderEnabled" type="checkbox" ${theme.borderEnabled !== false ? "checked" : ""}> تفعيل الحدود</label>
          <label>سمك الحدود<input id="setItemCardBorderWidth" data-item-card-theme="borderWidth" type="number" min="0" max="8" value="${esc(theme.borderWidth ?? 1)}"></label>
          <label>Border Radius<input id="setItemCardRadius" data-item-card-theme="radius" type="range" min="0" max="42" value="${esc(theme.radius ?? 26)}"><span class="muted" id="itemCardRadiusValue">${esc(theme.radius ?? 26)}px</span></label>
        </div>
        <div class="form-grid">
          <label><input id="setItemCardShadowEnabled" data-item-card-theme="shadowEnabled" type="checkbox" ${theme.shadowEnabled !== false ? "checked" : ""}> تفعيل الظل</label>
          <label>لون الظل<input id="setItemCardShadowColor" data-item-card-theme="shadowColor" type="color" value="${esc(theme.shadowColor || "#0f172a")}"></label>
          <label>قوة الظل<input id="setItemCardShadowStrength" data-item-card-theme="shadowStrength" type="range" min="0" max="60" value="${esc(theme.shadowStrength ?? 24)}"><span class="muted" id="itemCardShadowValue">${esc(theme.shadowStrength ?? 24)}%</span></label>
        </div>
        <div class="form-grid">
          <label>Blur الظل<input id="setItemCardShadowBlur" data-item-card-theme="shadowBlur" type="number" min="0" max="90" value="${esc(theme.shadowBlur ?? 42)}"></label>
          <label>ارتفاع الظل<input id="setItemCardShadowY" data-item-card-theme="shadowY" type="number" min="-20" max="60" value="${esc(theme.shadowY ?? 18)}"></label>
          <label><input id="setItemCardGlass" data-item-card-theme="glass" type="checkbox" ${theme.glass !== false ? "checked" : ""}> Glass Effect</label>
        </div>
        <div class="form-grid">
          <label><input id="setItemCardGradient" data-item-card-theme="gradient" type="checkbox" ${theme.gradient !== false ? "checked" : ""}> Gradient Background</label>
          <label><input id="setItemCardGlow" data-item-card-theme="glow" type="checkbox" ${theme.glow !== false ? "checked" : ""}> Glow Effect</label>
          <label><input id="setItemCardHoverScale" data-item-card-theme="hoverScale" type="checkbox" ${theme.hoverScale !== false ? "checked" : ""}> Hover Scale</label>
        </div>
        <label><input id="setItemCardBorderGlow" data-item-card-theme="borderGlow" type="checkbox" ${theme.borderGlow !== false ? "checked" : ""}> Border Glow عند المرور</label>`;
  }

  function renderItemCardCustomizer() {
    const theme = itemCardThemeSettings();
    return `<div class="panel theme-settings-panel item-card-customizer">
        <h3>تخصيص ألوان بطاقات الأصناف</h3>
        <div class="form-grid">
          <label>ثيم جاهز
            <select id="setItemCardPreset" data-item-card-theme="preset">
              <option value="luxury_dark" ${(theme.preset || "luxury_dark") === "luxury_dark" ? "selected" : ""}>Luxury Dark</option>
              <option value="modern_blue" ${theme.preset === "modern_blue" ? "selected" : ""}>Modern Blue</option>
              <option value="minimal_white" ${theme.preset === "minimal_white" ? "selected" : ""}>Minimal White</option>
              <option value="premium_orange" ${theme.preset === "premium_orange" ? "selected" : ""}>Premium Orange</option>
              <option value="indigo_pro" ${theme.preset === "indigo_pro" ? "selected" : ""}>Indigo Professional</option>
              <option value="custom" ${theme.preset === "custom" ? "selected" : ""}>Custom</option>
            </select>
          </label>
          <label>تصدير الثيم<input id="itemCardThemeExport" readonly value='${esc(JSON.stringify(theme))}'></label>
          <label>استيراد ثيم<input id="itemCardThemeImport" placeholder='{"background":"#111827"}'></label>
        </div>
        ${itemCardThemeInputs(theme)}
        <div class="item-card-live-preview" id="itemCardThemePreview">
          <div class="item-preview-card">
            <span class="item-card-number">14</span>
            <span class="item-popular-badge">🔥 الأكثر طلباً</span>
            <span class="item-deco-icon">♨</span>
            <span class="item-curve-line"></span>
            <div class="item-main"><h3>ريش غنم</h3><p>ريش غنم مشوية على الفحم</p></div>
            <div class="item-price-block"><span>السعر</span><strong>3,500 د.ع</strong></div>
            <button type="button">➕ إضافة</button>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="ghost-btn" data-action="resetItemCardTheme">إعادة للوضع الافتراضي</button>
          <button type="button" class="warning-btn" data-action="importItemCardTheme">استيراد الثيم</button>
        </div>
        <p class="muted">أي تغيير يظهر في المعاينة مباشرة، وبعد الحفظ يطبق على صفحة الزبون من Firebase بدون تعديل الكود.</p>
      </div>`;
  }

  function renderSettings() {
    const s = state.settings;
    return `<section class="panel"><form class="stack" data-form="settings">
      <div class="form-grid"><label>اسم المطعم<input id="setName" value="${esc(s.restaurantName)}"></label><label>الشعار URL<input id="setLogo" value="${esc(s.logoUrl)}"></label><label>العملة<input id="setCurrency" value="${esc(s.currency || K.currency)}"></label></div>
      <div class="form-grid"><label>الهاتف 1<input id="setPhone1" value="${esc((s.phones || [])[0] || "")}"></label><label>الهاتف 2<input id="setPhone2" value="${esc((s.phones || [])[1] || "")}"></label><label>واتساب الطلبات<input id="setWhatsapp" value="${esc(s.whatsappNumber || "07838468817")}" placeholder="07838468817 أو +9647838468817"></label></div>
      <label>العنوان<input id="setAddress" value="${esc(s.address || "")}"></label>
      <label>شريط أعلى الأقسام<input id="setCustomerHeroText" value="${esc(s.customerHeroText || "اختر القسم واطلب أشهى مشويات كباب الديرة")}"></label>
      <div class="panel theme-settings-panel">
        <h3>إعدادات الثيم / Theme Settings</h3>
        <label>اختيار الثيم
          <select id="setCustomerTheme">
            <option value="orange" ${!s.customerTheme || s.customerTheme === "orange" ? "selected" : ""}>Orange Classic</option>
            <option value="sky" ${s.customerTheme === "sky" ? "selected" : ""}>Sky Blue + White</option>
            <option value="dark" ${s.customerTheme === "dark" ? "selected" : ""}>Dark Mode</option>
            <option value="custom" ${s.customerTheme === "custom" ? "selected" : ""}>Custom Theme</option>
          </select>
        </label>
        <div class="form-grid">
          <label>Primary<input id="setThemePrimary" type="color" value="${esc(s.themeCustom?.primary || "#38BDF8")}"></label>
          <label>Secondary<input id="setThemeSecondary" type="color" value="${esc(s.themeCustom?.secondary || "#0EA5E9")}"></label>
          <label>Light<input id="setThemeLight" type="color" value="${esc(s.themeCustom?.light || "#E0F7FF")}"></label>
          <label>Soft Background<input id="setThemeBackground" type="color" value="${esc(s.themeCustom?.background || "#F8FCFF")}"></label>
          <label>Text<input id="setThemeText" type="color" value="${esc(s.themeCustom?.text || "#0F172A")}"></label>
          <label>Accent<input id="setThemeAccent" type="color" value="${esc(s.themeCustom?.accent || "#7DD3FC")}"></label>
          <label>Hover<input id="setThemeHover" type="color" value="${esc(s.themeCustom?.hover || "#0284C7")}"></label>
        </div>
        <p class="muted">هذه الألوان تطبق على صفحة الزبون فقط، ولا تغير ألوان لوحة التحكم.</p>
      </div>
      <div class="panel theme-settings-panel">
        <h3>إعداد بطاقات الأصناف</h3>
        <label>شكل بطاقة الصنف
          <select id="setItemCardStyle">
            <option value="image" ${!s.itemCardStyle || s.itemCardStyle === "image" ? "selected" : ""}>بطاقات بالصورة الحالية</option>
            <option value="no_image_luxury" ${s.itemCardStyle === "no_image_luxury" ? "selected" : ""}>Premium بدون صور</option>
          </select>
        </label>
        <p class="muted">خيار Premium بدون صور يخفي صور الأصناف من صفحة الزبون ويستخدم تصميمًا أحمر فاخرًا مع عناصر زخرفية فقط.</p>
      </div>
      ${renderItemCardCustomizer()}
      <div class="panel banner-settings">
        <h3>بانر أعلى صفحة الزبون</h3>
        <div class="form-grid"><label><input id="setAnnouncementEnabled" type="checkbox" ${s.announcementEnabled ? "checked" : ""}> تفعيل البانر</label><label>عنوان البانر<input id="setAnnouncementTitle" value="${esc(s.announcementTitle || "")}" placeholder="مثال: تهنئة بمناسبة العيد"></label></div>
        <label>نص البانر<textarea id="setAnnouncementText" placeholder="اكتب ملاحظة أو تهنئة دينية أو وطنية">${esc(s.announcementText || "")}</textarea></label>
        <div class="form-grid"><label>رابط صورة البانر<input id="setAnnouncementImage" value="${esc(s.announcementImageUrl || "")}" placeholder="https://..."></label><label>رفع صورة<input id="setAnnouncementImageFile" type="file" accept="image/*"></label></div>
      </div>
      <div class="form-grid"><label><input id="setOpen" type="checkbox" ${s.isOpen ? "checked" : ""}> المطعم مفتوح</label><label><input id="setWhatsappEnabled" type="checkbox" ${s.whatsappEnabled ? "checked" : ""}> إظهار واتساب كخيار إضافي</label><label><input id="setDeliveryEnabled" type="checkbox" ${s.deliveryEnabled ? "checked" : ""}> تفعيل الدليفري</label></div>
      <div class="form-grid"><label><input id="setPopularEnabled" type="checkbox" ${s.popularEnabled !== false ? "checked" : ""}> إظهار الأكثر طلبًا</label><label>وقت الفتح<input id="setOpenTime" type="time" value="${esc(s.openTime || "12:00")}"></label><label>وقت الإغلاق<input id="setCloseTime" type="time" value="${esc(s.closeTime || "00:00")}"></label></div>
      <div class="form-grid"><label>أوقات الدوام<input id="setHours" value="${esc(s.workingHours || "")}"></label><label>الحد الأدنى<input id="setMinimum" type="number" value="${esc(s.minimumOrder || 0)}"></label><label>رسالة الإغلاق<input id="setClosed" value="${esc(s.closedMessage || "")}"></label></div>
      <div class="panel banner-settings">
        <h3>رسائل واتساب لحالة الطلب</h3>
        <label><input id="setWhatsappStatusEnabled" type="checkbox" ${s.whatsappStatusEnabled !== false ? "checked" : ""}> تفعيل رسائل واتساب عند تغيير الحالة</label>
        <div class="form-grid"><label>رسالة القبول<input id="setWaAccepted" value="${esc(s.whatsappAcceptedMessage || "")}"></label><label>رسالة الجاهزية<input id="setWaReady" value="${esc(s.whatsappReadyMessage || "")}"></label></div>
        <div class="form-grid"><label>رسالة مع السائق<input id="setWaDriver" value="${esc(s.whatsappDriverMessage || "")}"></label><label>رسالة الإكمال<input id="setWaCompleted" value="${esc(s.whatsappCompletedMessage || "")}"></label></div>
        <label>رسالة الإلغاء<input id="setWaCanceled" value="${esc(s.whatsappCanceledMessage || "")}"></label>
      </div>
      <div class="form-grid"><label>خط عرض المطعم<input id="setLat" type="number" step="any" value="${esc(s.restaurantLat || "")}"></label><label>خط طول المطعم<input id="setLng" type="number" step="any" value="${esc(s.restaurantLng || "")}"></label><label>منطقة المطعم<input id="setArea" value="${esc(s.restaurantArea || "")}"></label></div>
      <div class="form-grid"><label>نطاق التوصيل كم<input id="setRadius" type="number" step="0.1" value="${esc(s.deliveryRadiusKm || 7)}"></label><label><input id="setRouteEnabled" type="checkbox" ${s.deliveryRouteEnabled !== false ? "checked" : ""}> حساب التوصيل حسب مسافة الطريق</label><label>مزود الخرائط<select id="setMapProvider"><option value="osrm" ${s.mapProvider === "osrm" ? "selected" : ""}>OSRM مجاني للاختبار</option><option value="openrouteservice" ${s.mapProvider === "openrouteservice" ? "selected" : ""}>OpenRouteService</option><option value="mapbox" ${s.mapProvider === "mapbox" ? "selected" : ""}>Mapbox</option><option value="google" ${s.mapProvider === "google" ? "selected" : ""}>Google Directions</option></select></label></div>
      <div class="form-grid"><label>API Key للخرائط<input id="setMapApiKey" value="${esc(s.mapApiKey || "")}" placeholder="اتركه فارغًا مع OSRM"></label><label>أجور أول 1 كم<input id="setFirstKmFee" type="number" value="${esc(s.deliveryFirstKmFee || s.deliveryFee || 1000)}"></label><label>أجور كل كم إضافي<input id="setExtraKmFee" type="number" value="${esc(s.deliveryExtraKmFee || s.deliveryFeePerKm || 500)}"></label></div>
      <div class="form-grid"><label>طريقة التقريب<select id="setRounding"><option value="none" ${s.deliveryRounding === "none" ? "selected" : ""}>بدون تقريب</option><option value="nearest_250_up" ${!s.deliveryRounding || s.deliveryRounding === "nearest_250_up" ? "selected" : ""}>تقريب لأقرب 250 للأعلى</option><option value="ceil_500" ${s.deliveryRounding === "ceil_500" ? "selected" : ""}>تقريب لأقرب 500 للأعلى</option><option value="ceil_1000" ${s.deliveryRounding === "ceil_1000" ? "selected" : ""}>تقريب لأعلى 1000</option><option value="smart" ${s.deliveryRounding === "smart" ? "selected" : ""}>تقريب ذكي</option></select></label><label>أجور ثابتة احتياطية<input id="setFee" type="number" value="${esc(s.deliveryFee || 0)}"></label><label>نوع الأجور<input id="setFeeType" value="${esc(s.deliveryFeeType || "route")}" readonly></label></div>
      <div class="panel banner-settings">
        <h3>إعدادات الطلبات الواردة</h3>
        <div class="form-grid">
          <label>عدد الطلبات المعروضة<input id="setOrdersLimit" type="number" min="20" value="${esc(s.ordersLimit || 200)}"></label>
          <label>مدة تمييز الطلب الجديد بالدقائق<input id="setNewOrderMinutes" type="number" value="${esc(s.newOrderHighlightMinutes || 10)}"></label>
          <label>ترتيب الطلبات<select id="setOrdersDefaultSort"><option value="newest" ${s.ordersDefaultSort === "newest" ? "selected" : ""}>الأحدث أولًا</option><option value="oldest" ${s.ordersDefaultSort === "oldest" ? "selected" : ""}>الأقدم أولًا</option><option value="status" ${s.ordersDefaultSort === "status" ? "selected" : ""}>حسب الحالة</option></select></label>
        </div>
        <div class="form-grid">
          <label><input id="setShowDoneOrders" type="checkbox" ${s.showDoneOrders !== false ? "checked" : ""}> إظهار الطلبات المكتملة</label>
          <label><input id="setShowCanceledOrders" type="checkbox" ${s.showCanceledOrders !== false ? "checked" : ""}> إظهار الطلبات الملغية</label>
          <label><input id="setHighlightNewOrders" type="checkbox" ${s.highlightNewOrders !== false ? "checked" : ""}> تفعيل تمييز الطلبات الجديدة</label>
        </div>
        <div class="form-grid">
          <label><input id="setManualStatusChange" type="checkbox" ${s.manualStatusChange !== false ? "checked" : ""}> السماح بتغيير الحالة يدويًا</label>
          <label><input id="setAutoPrintOnNew" type="checkbox" ${s.autoPrintOnNew ? "checked" : ""}> طباعة تلقائية عند وصول الطلب</label>
          <label><input id="setAutoPrintOnAccept" type="checkbox" ${s.autoPrintOnAccept ? "checked" : ""}> طباعة تلقائية عند قبول الطلب</label>
        </div>
      </div>
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
      <div class="notice error-notice"><strong>تنبيه:</strong> زر حذف المنيو يمسح الفئات والأصناف والخيارات والعروض والإضافات فقط، ولا يحذف الطلبات.</div>
      <button class="danger-btn" data-action="clearMenuData">حذف الفئات والأصناف القديمة والبدء من الصفر</button>
      <label>استيراد JSON<textarea id="backupJson" class="json-box" placeholder='{"categories":[],"items":[]}'></textarea></label>
      <button class="warning-btn" data-action="restoreBackup">استعادة النسخة</button>
    </section>`;
  }

  async function saveCategory() {
    const id = val("categoryId") || K.id("cat");
    const file = document.getElementById("categoryImageFile")?.files?.[0];
    const imageUrl = file ? await K.uploadImage(file, "categories") : val("categoryImage");
    const activeInput = document.getElementById("categoryActive");
    const hiddenInput = document.getElementById("categoryHidden");
    const payload = {
      name: val("categoryName"),
      details: val("categoryDetails"),
      icon: val("categoryIcon"),
      imageUrl,
      order: num("categoryOrder"),
      active: activeInput ? activeInput.checked : true,
      hidden: hiddenInput ? hiddenInput.checked : false,
      isOffers: checked("categoryOffers"),
      orderVisibility: {
        dinein: checked("categoryShowDinein"),
        takeaway: checked("categoryShowTakeaway"),
        delivery: checked("categoryShowDelivery")
      }
    };
    state.editing = null;
    state.categories = state.categories.filter(category => category.id !== id).concat({ id, ...payload });
    state.settings = { ...state.settings, menuCleared: false };
    clearMenuCache();
    publishMenuSync();
    await db.collection("categories").doc(id).set(payload, { merge: true });
    await db.collection("settings").doc("main").set({ menuCleared: false }, { merge: true });
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
    state.settings = { ...state.settings, menuCleared: false };
    clearMenuCache();
    publishMenuSync();
    await db.collection("items").doc(id).set(payload, { merge: true });
    await db.collection("settings").doc("main").set({ menuCleared: false }, { merge: true });
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

  async function saveAddon() {
    const id = val("addonId") || K.id("addon");
    const payload = {
      name: val("addonName"),
      price: num("addonPrice"),
      cost: num("addonCost"),
      order: num("addonOrder"),
      available: document.getElementById("addonAvailable")?.checked !== false,
      visible: document.getElementById("addonVisible")?.checked !== false
    };
    state.editing = null;
    state.addons = state.addons.filter(addon => addon.id !== id).concat({ id, ...payload });
    clearMenuCache();
    publishMenuSync();
    await db.collection("addons").doc(id).set(payload, { merge: true });
    toast("تم حفظ الإضافة.");
  }

  function colorValue(id, fallback) {
    const value = val(id);
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  }

  function collectItemCardTheme() {
    return {
      preset: val("setItemCardPreset") || "custom",
      background: colorValue("setItemCardBgHex", colorValue("setItemCardBg", "#111827")),
      text: colorValue("setItemCardTextHex", colorValue("setItemCardText", "#fff7ed")),
      description: colorValue("setItemCardDescHex", colorValue("setItemCardDesc", "#ffedd5")),
      price: colorValue("setItemCardPriceHex", colorValue("setItemCardPrice", "#fbbf24")),
      badgeBg: colorValue("setItemCardBadgeBgHex", colorValue("setItemCardBadgeBg", "#f97316")),
      badgeText: colorValue("setItemCardBadgeTextHex", colorValue("setItemCardBadgeText", "#ffffff")),
      buttonBg: colorValue("setItemCardButtonBgHex", colorValue("setItemCardButtonBg", "#f97316")),
      buttonText: colorValue("setItemCardButtonTextHex", colorValue("setItemCardButtonText", "#ffffff")),
      border: colorValue("setItemCardBorderHex", colorValue("setItemCardBorder", "#fbbf24")),
      borderWidth: num("setItemCardBorderWidth"),
      borderEnabled: checked("setItemCardBorderEnabled"),
      radius: num("setItemCardRadius"),
      shadowColor: colorValue("setItemCardShadowColor", "#0f172a"),
      shadowBlur: num("setItemCardShadowBlur"),
      shadowY: num("setItemCardShadowY"),
      shadowStrength: num("setItemCardShadowStrength"),
      shadowEnabled: checked("setItemCardShadowEnabled"),
      glass: checked("setItemCardGlass"),
      gradient: checked("setItemCardGradient"),
      glow: checked("setItemCardGlow"),
      hoverScale: checked("setItemCardHoverScale"),
      borderGlow: checked("setItemCardBorderGlow")
    };
  }

  function hexToRgb(hex) {
    const clean = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return "15,23,42";
    const value = parseInt(clean, 16);
    return `${(value >> 16) & 255},${(value >> 8) & 255},${value & 255}`;
  }

  function applyItemCardPreview() {
    const preview = document.getElementById("itemCardThemePreview");
    if (!preview) return;
    const theme = collectItemCardTheme();
    const card = preview.querySelector(".item-preview-card");
    if (!card) return;
    const shadowAlpha = theme.shadowEnabled ? Math.max(0, Math.min(100, theme.shadowStrength || 0)) / 100 : 0;
    card.style.setProperty("--preview-bg", theme.background);
    card.style.setProperty("--preview-bg-rgb", hexToRgb(theme.background));
    card.style.setProperty("--preview-text", theme.text);
    card.style.setProperty("--preview-desc", theme.description);
    card.style.setProperty("--preview-price", theme.price);
    card.style.setProperty("--preview-badge-bg", theme.badgeBg);
    card.style.setProperty("--preview-badge-text", theme.badgeText);
    card.style.setProperty("--preview-button-bg", theme.buttonBg);
    card.style.setProperty("--preview-button-text", theme.buttonText);
    card.style.setProperty("--preview-border", theme.border);
    card.style.setProperty("--preview-border-width", theme.borderEnabled ? `${theme.borderWidth || 1}px` : "0px");
    card.style.setProperty("--preview-radius", `${theme.radius || 26}px`);
    card.style.setProperty("--preview-shadow", `0 ${theme.shadowY || 18}px ${theme.shadowBlur || 42}px rgba(${hexToRgb(theme.shadowColor)}, ${shadowAlpha})`);
    const radiusValue = document.getElementById("itemCardRadiusValue");
    if (radiusValue) radiusValue.textContent = `${theme.radius || 0}px`;
    const shadowValue = document.getElementById("itemCardShadowValue");
    if (shadowValue) shadowValue.textContent = `${theme.shadowStrength || 0}%`;
    const exportInput = document.getElementById("itemCardThemeExport");
    if (exportInput) exportInput.value = JSON.stringify(theme);
  }

  function syncItemCardColorPair(key, value) {
    const map = {
      background: ["setItemCardBg", "setItemCardBgHex"],
      text: ["setItemCardText", "setItemCardTextHex"],
      description: ["setItemCardDesc", "setItemCardDescHex"],
      price: ["setItemCardPrice", "setItemCardPriceHex"],
      badgeBg: ["setItemCardBadgeBg", "setItemCardBadgeBgHex"],
      badgeText: ["setItemCardBadgeText", "setItemCardBadgeTextHex"],
      buttonBg: ["setItemCardButtonBg", "setItemCardButtonBgHex"],
      buttonText: ["setItemCardButtonText", "setItemCardButtonTextHex"],
      border: ["setItemCardBorder", "setItemCardBorderHex"]
    };
    const ids = map[key];
    if (!ids || !/^#[0-9a-fA-F]{6}$/.test(value)) return;
    ids.forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    });
  }

  function applyItemCardPreset(presetId) {
    const preset = itemCardPresets[presetId];
    if (!preset) return;
    Object.entries(preset).forEach(([key, value]) => syncItemCardColorPair(key, value));
    const presetInput = document.getElementById("setItemCardPreset");
    if (presetInput) presetInput.value = presetId;
    applyItemCardPreview();
  }

  function resetItemCardTheme() {
    const defaults = K.settingsSeed.itemCardTheme || {};
    Object.entries(defaults).forEach(([key, value]) => {
      syncItemCardColorPair(key, value);
      const input = document.querySelector(`[data-item-card-theme="${key}"]`);
      if (!input) return;
      if (input.type === "checkbox") input.checked = value !== false;
      else input.value = value;
    });
    applyItemCardPreview();
  }

  function importItemCardTheme() {
    try {
      const imported = JSON.parse(val("itemCardThemeImport") || "{}");
      Object.entries(imported).forEach(([key, value]) => {
        syncItemCardColorPair(key, value);
        const input = document.querySelector(`[data-item-card-theme="${key}"]`);
        if (!input) return;
        if (input.type === "checkbox") input.checked = value !== false;
        else input.value = value;
      });
      applyItemCardPreview();
      toast("تم استيراد ثيم البطاقة.");
    } catch (error) {
      toast("صيغة JSON غير صحيحة.", "error-notice");
    }
  }

  async function saveSettings() {
    const bannerFile = document.getElementById("setAnnouncementImageFile")?.files?.[0];
    const announcementImageUrl = bannerFile ? await K.uploadImage(bannerFile, "settings") : val("setAnnouncementImage");
    await db.collection("settings").doc("main").set({
      restaurantName: val("setName"),
      logoUrl: val("setLogo"),
      phones: [val("setPhone1"), val("setPhone2")].filter(Boolean),
      whatsappNumber: val("setWhatsapp"),
      address: val("setAddress"),
      customerHeroText: val("setCustomerHeroText"),
      customerTheme: val("setCustomerTheme") || "orange",
      itemCardStyle: val("setItemCardStyle") || "image",
      itemCardTheme: collectItemCardTheme(),
      themeCustom: {
        primary: val("setThemePrimary") || "#38BDF8",
        secondary: val("setThemeSecondary") || "#0EA5E9",
        light: val("setThemeLight") || "#E0F7FF",
        background: val("setThemeBackground") || "#F8FCFF",
        text: val("setThemeText") || "#0F172A",
        accent: val("setThemeAccent") || "#7DD3FC",
        hover: val("setThemeHover") || "#0284C7"
      },
      announcementEnabled: checked("setAnnouncementEnabled"),
      announcementTitle: val("setAnnouncementTitle"),
      announcementText: val("setAnnouncementText"),
      announcementImageUrl,
      isOpen: checked("setOpen"),
      popularEnabled: checked("setPopularEnabled"),
      openTime: val("setOpenTime"),
      closeTime: val("setCloseTime"),
      whatsappEnabled: checked("setWhatsappEnabled"),
      whatsappStatusEnabled: checked("setWhatsappStatusEnabled"),
      whatsappAcceptedMessage: val("setWaAccepted"),
      whatsappReadyMessage: val("setWaReady"),
      whatsappDriverMessage: val("setWaDriver"),
      whatsappCompletedMessage: val("setWaCompleted"),
      whatsappCanceledMessage: val("setWaCanceled"),
      deliveryEnabled: checked("setDeliveryEnabled"),
      workingHours: val("setHours"),
      minimumOrder: num("setMinimum"),
      closedMessage: val("setClosed"),
      restaurantLat: Number(val("setLat") || 0),
      restaurantLng: Number(val("setLng") || 0),
      restaurantArea: val("setArea"),
      deliveryRadiusKm: num("setRadius"),
      deliveryRouteEnabled: checked("setRouteEnabled"),
      deliveryFeeType: "route",
      deliveryFee: num("setFee"),
      deliveryFeePerKm: num("setExtraKmFee"),
      deliveryFirstKmFee: num("setFirstKmFee"),
      deliveryExtraKmFee: num("setExtraKmFee"),
      deliveryRounding: val("setRounding"),
      mapProvider: val("setMapProvider"),
      mapApiKey: val("setMapApiKey"),
      ordersLimit: num("setOrdersLimit"),
      newOrderHighlightMinutes: num("setNewOrderMinutes"),
      ordersDefaultSort: val("setOrdersDefaultSort"),
      showDoneOrders: checked("setShowDoneOrders"),
      showCanceledOrders: checked("setShowCanceledOrders"),
      highlightNewOrders: checked("setHighlightNewOrders"),
      manualStatusChange: checked("setManualStatusChange"),
      autoPrintOnNew: checked("setAutoPrintOnNew"),
      autoPrintOnAccept: checked("setAutoPrintOnAccept"),
      currency: val("setCurrency") || K.currency
    }, { merge: true });
    state.settings = {
      ...state.settings,
      restaurantName: val("setName"),
      logoUrl: val("setLogo"),
      phones: [val("setPhone1"), val("setPhone2")].filter(Boolean),
      whatsappNumber: val("setWhatsapp"),
      address: val("setAddress"),
      customerHeroText: val("setCustomerHeroText"),
      customerTheme: val("setCustomerTheme") || "orange",
      itemCardStyle: val("setItemCardStyle") || "image",
      itemCardTheme: collectItemCardTheme(),
      themeCustom: {
        primary: val("setThemePrimary") || "#38BDF8",
        secondary: val("setThemeSecondary") || "#0EA5E9",
        light: val("setThemeLight") || "#E0F7FF",
        background: val("setThemeBackground") || "#F8FCFF",
        text: val("setThemeText") || "#0F172A",
        accent: val("setThemeAccent") || "#7DD3FC",
        hover: val("setThemeHover") || "#0284C7"
      },
      announcementEnabled: checked("setAnnouncementEnabled"),
      announcementTitle: val("setAnnouncementTitle"),
      announcementText: val("setAnnouncementText"),
      announcementImageUrl,
      isOpen: checked("setOpen"),
      popularEnabled: checked("setPopularEnabled"),
      openTime: val("setOpenTime"),
      closeTime: val("setCloseTime"),
      whatsappEnabled: checked("setWhatsappEnabled"),
      whatsappStatusEnabled: checked("setWhatsappStatusEnabled"),
      whatsappAcceptedMessage: val("setWaAccepted"),
      whatsappReadyMessage: val("setWaReady"),
      whatsappDriverMessage: val("setWaDriver"),
      whatsappCompletedMessage: val("setWaCompleted"),
      whatsappCanceledMessage: val("setWaCanceled"),
      deliveryEnabled: checked("setDeliveryEnabled"),
      workingHours: val("setHours"),
      minimumOrder: num("setMinimum"),
      closedMessage: val("setClosed"),
      restaurantLat: Number(val("setLat") || 0),
      restaurantLng: Number(val("setLng") || 0),
      restaurantArea: val("setArea"),
      deliveryRadiusKm: num("setRadius"),
      deliveryRouteEnabled: checked("setRouteEnabled"),
      deliveryFeeType: "route",
      deliveryFee: num("setFee"),
      deliveryFeePerKm: num("setExtraKmFee"),
      deliveryFirstKmFee: num("setFirstKmFee"),
      deliveryExtraKmFee: num("setExtraKmFee"),
      deliveryRounding: val("setRounding"),
      mapProvider: val("setMapProvider"),
      mapApiKey: val("setMapApiKey"),
      ordersLimit: num("setOrdersLimit"),
      newOrderHighlightMinutes: num("setNewOrderMinutes"),
      ordersDefaultSort: val("setOrdersDefaultSort"),
      showDoneOrders: checked("setShowDoneOrders"),
      showCanceledOrders: checked("setShowCanceledOrders"),
      highlightNewOrders: checked("setHighlightNewOrders"),
      manualStatusChange: checked("setManualStatusChange"),
      autoPrintOnNew: checked("setAutoPrintOnNew"),
      autoPrintOnAccept: checked("setAutoPrintOnAccept"),
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
  async function clearMenuData() {
    const collections = ["categories", "items", "item_options", "offers", "addons"];
    for (const collectionName of collections) {
      const snap = await db.collection(collectionName).get();
      const batch = db.batch();
      snap.docs.forEach(doc => batch.delete(doc.ref));
      if (snap.docs.length) await batch.commit();
    }
    state.categories = [];
    state.items = [];
    state.addons = [];
    state.editing = null;
    state.settings = { ...state.settings, menuCleared: true };
    localStorage.setItem("kd_cached_categories", JSON.stringify([]));
    localStorage.setItem("kd_cached_items", JSON.stringify([]));
    localStorage.setItem("kd_cached_settings", JSON.stringify(state.settings));
    await db.collection("settings").doc("main").set({ menuCleared: true }, { merge: true });
    publishMenuSync();
    render();
    toast("تم حذف المنيو القديم. يمكنك الآن إضافة الفئات والأصناف من لوحة التحكم.");
  }
  async function deleteCategoryById(categoryId) {
    try {
      const category = state.categories.find(c => c.id === categoryId);
      if (!category) throw new Error("الفئة غير موجودة.");
      clearMenuCache();
      const relatedItems = state.items.filter(item => item.categoryId === categoryId);
      const batch = db.batch();
      batch.set(db.collection("categories").doc(categoryId), { deleted: true, active: false, hidden: true, deletedAtMs: Date.now() }, { merge: true });
      relatedItems.forEach(item => {
        batch.set(db.collection("items").doc(item.id), { deleted: true, active: false, visible: false, available: false, deletedAtMs: Date.now() }, { merge: true });
        (item.options || []).forEach(option => {
          batch.set(db.collection("item_options").doc(`${item.id}_${option.id}`), { deleted: true, deletedAtMs: Date.now() }, { merge: true });
        });
        batch.set(db.collection("offers").doc(item.id), { deleted: true, active: false, deletedAtMs: Date.now() }, { merge: true });
      });
      await batch.commit();
      state.categories = state.categories.filter(c => c.id !== categoryId);
      state.items = state.items.filter(item => item.categoryId !== categoryId);
      publishMenuSync();
      toast("تم حذف الفئة والأصناف التابعة لها.");
    } catch (error) {
      console.error("Delete category error:", error);
      toast(`فشل حذف الفئة: ${error.message}`, "error-notice");
    }
  }
  async function deleteItemById(itemId) {
    try {
      const item = state.items.find(i => i.id === itemId);
      if (!item) throw new Error("الصنف غير موجود.");
      clearMenuCache();
      const batch = db.batch();
      batch.set(db.collection("items").doc(itemId), { deleted: true, active: false, visible: false, available: false, deletedAtMs: Date.now() }, { merge: true });
      (item.options || []).forEach(option => {
        batch.set(db.collection("item_options").doc(`${itemId}_${option.id}`), { deleted: true, deletedAtMs: Date.now() }, { merge: true });
      });
      batch.set(db.collection("offers").doc(itemId), { deleted: true, active: false, deletedAtMs: Date.now() }, { merge: true });
      await batch.commit();
      state.items = state.items.filter(i => i.id !== itemId);
      publishMenuSync();
      toast("تم حذف الصنف بنجاح.");
    } catch (error) {
      console.error("Delete item error:", error);
      toast(`فشل حذف الصنف: ${error.message}`, "error-notice");
    }
  }
  async function deleteAddonById(addonId) {
    try {
      clearMenuCache();
      await db.collection("addons").doc(addonId).set({ deleted: true, visible: false, available: false, deletedAtMs: Date.now() }, { merge: true });
      state.addons = state.addons.filter(addon => addon.id !== addonId);
      publishMenuSync();
      toast("تم حذف الإضافة بنجاح.");
    } catch (error) {
      console.error("Delete addon error:", error);
      toast(`فشل حذف الإضافة: ${error.message}`, "error-notice");
    }
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
  function openOrderDetails(orderId) {
    state.selectedOrderId = orderId;
    state.orderDetailsFull = false;
    state.dismissedOrderPopups.add(orderId);
    saveDismissedPopups();
    render();
  }
  async function updateOrderStatus(orderId, status, extra = {}) {
    const now = Date.now();
    const order = state.orders.find(o => o.id === orderId) || {};
    const history = (order.statusHistory || []).concat({ status, atMs: now, by: state.user?.email || "admin", reason: extra.cancelReason || extra.rejectReason || "" });
    const timestamps = {};
    if (status === "قيد المراجعة") timestamps.reviewedAtMs = now;
    if (status === "مقبول") timestamps.acceptedAtMs = now;
    if (status === "قيد التحضير") timestamps.preparingAtMs = now;
    if (status === "جاهز") timestamps.readyAtMs = now;
    if (status === "مع السائق") timestamps.driverAtMs = now;
    if (status === "تم التسليم" || status === "مكتمل") timestamps.completedAtMs = now;
    if (status === "ملغي" || status === "مرفوض") timestamps.canceledAtMs = now;
    const whatsappLog = whatsappStatusPatch(order, status, now);
    await db.collection("orders").doc(orderId).set({ status, source: order.source || "صفحة الزبون", updatedAtMs: now, statusHistory: history, ...timestamps, ...whatsappLog.patch, ...extra }, { merge: true });
    await db.collection("public_order_status").doc(orderId).set({
      status,
      driverName: extra.driverName || order.driverName || order.captainName || "",
      driverPhone: extra.driverPhone || order.driverPhone || order.captainPhone || "",
      updatedAtMs: Date.now()
    }, { merge: true });
    db.collection("public_customer_orders").doc(orderId).set({ status, updatedAtMs: Date.now() }, { merge: true }).catch(() => {});
    state.dismissedOrderPopups.delete(orderId);
    saveDismissedPopups();
    if (!pendingNewOrders().filter(order => order.id !== orderId).length) stopOrderAlarm();
    state.orders = state.orders.map(order => order.id === orderId ? { ...order, status, statusHistory: history, ...timestamps, ...whatsappLog.patch, ...extra } : order);
    if (whatsappLog.url) window.open(whatsappLog.url, "_blank");
    render();
  }

  function whatsappStatusMessage(status) {
    const messages = {
      "مقبول": state.settings.whatsappAcceptedMessage,
      "قيد التحضير": state.settings.whatsappAcceptedMessage,
      "جاهز": state.settings.whatsappReadyMessage,
      "مع السائق": state.settings.whatsappDriverMessage,
      "تم التسليم": state.settings.whatsappCompletedMessage,
      "مكتمل": state.settings.whatsappCompletedMessage,
      "ملغي": state.settings.whatsappCanceledMessage,
      "مرفوض": state.settings.whatsappCanceledMessage
    };
    return messages[status] || "";
  }

  function whatsappStatusPatch(order, status, atMs) {
    if (state.settings.whatsappStatusEnabled === false) return { patch: {}, url: "" };
    const phone = whatsappPhone(order.customer?.phone);
    const message = whatsappStatusMessage(status);
    const sent = order.whatsappStatusSent || {};
    if (!phone || !message || sent[status]) return { patch: {}, url: "" };
    const text = `${message}\nرقم الطلب: #${String(order.id || "").slice(0, 8)}\nكباب الديرة`;
    return {
      patch: { whatsappStatusSent: { ...sent, [status]: atMs } },
      url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    };
  }
  async function acceptOrder(orderId) {
    await updateOrderStatus(orderId, "مقبول");
    state.selectedOrderId = orderId;
    state.orderDetailsFull = true;
    render();
    toast("تم قبول الطلب.");
  }
  async function rejectOrder(orderId) {
    const reason = window.prompt("سبب رفض الطلب؟") || "";
    await updateOrderStatus(orderId, "مرفوض", { rejectReason: reason });
    toast("تم رفض الطلب.", "error-notice");
  }
  async function assignDriver(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    const current = [order.driverName || order.captainName || "", order.driverPhone || order.captainPhone || ""].filter(Boolean).join(" - ");
    const value = window.prompt("اكتب اسم الكابتن ورقمه بهذا الشكل: الاسم - الرقم", current);
    if (value == null) return;
    const [namePart, phonePart] = value.split("-").map(part => part.trim());
    const driverName = namePart || "";
    const driverPhone = phonePart || "";
    const patch = {
      driverName,
      driverPhone,
      captainName: driverName,
      captainPhone: driverPhone,
      driverAssignedAtMs: Date.now(),
      driverAssignedBy: state.user?.email || "admin"
    };
    await db.collection("orders").doc(orderId).set(patch, { merge: true });
    await db.collection("public_order_status").doc(orderId).set({ driverName, driverPhone, updatedAtMs: Date.now() }, { merge: true });
    state.orders = state.orders.map(o => o.id === orderId ? { ...o, ...patch } : o);
    toast("تم تعيين الكابتن.");
    render();
  }
  async function addInternalNote(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    const note = window.prompt("اكتب الملاحظة الداخلية:", order.internalNote || "");
    if (note == null) return;
    const entry = { note, atMs: Date.now(), by: state.user?.email || "admin" };
    const internalNotes = (order.internalNotes || []).concat(entry);
    await db.collection("orders").doc(orderId).set({ internalNote: note, internalNotes, updatedAtMs: Date.now() }, { merge: true });
    state.orders = state.orders.map(o => o.id === orderId ? { ...o, internalNote: note, internalNotes } : o);
    toast("تم حفظ الملاحظة الداخلية.");
    render();
  }
  function orderPlainText(order) {
    return `${orderWhatsAppText(order)}\nالحالة: ${order.status || "جديد"}`;
  }
  async function copyOrderData(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    await navigator.clipboard.writeText(orderPlainText(order));
    toast("تم نسخ بيانات الطلب.");
  }
  async function copyOrderPhone(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order?.customer?.phone) return toast("لا يوجد رقم هاتف لهذا الطلب.", "error-notice");
    await navigator.clipboard.writeText(order.customer.phone);
    toast("تم نسخ رقم الهاتف.");
  }
  function printKitchenOrder(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    printOrderDocument(order, "kitchen");
  }
  function printCustomerInvoice(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    printOrderDocument(order, "invoice");
  }
  function printDriverOrder(orderId) {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) return;
    printOrderDocument(order, "driver");
  }
  function printOrderDocument(order, type) {
    const prices = type === "invoice";
    const driver = type === "driver";
    const title = prices ? esc(state.settings.restaurantName || "كباب الديرة") : driver ? "نسخة الموصل" : "طلب مطبخ";
    const location = customerLocationUrl(order);
    const area = document.createElement("div");
    area.id = "printArea";
    area.className = "thermal-print";
    area.innerHTML = `<h1>${title}</h1>
      <h2>#${esc(order.id.slice(0, 8))}</h2>
      <p>${orderTime(order).toLocaleString("ar-IQ")}</p>
      <p>${esc(orderTypeLabel(order.orderType))}</p>
      ${order.distanceKm ? `<p>المسافة ${Number(order.distanceKm).toFixed(2)} كم - ${Number(order.routeDurationMin || 0)} دقيقة</p>` : ""}
      ${prices || driver ? `<p>${esc(order.customer?.name || "")} - ${esc(order.customer?.phone || "")}</p><p>${esc(order.customer?.address || order.tableNumber || "")}</p>${location ? `<p>${esc(location)}</p>` : ""}` : ""}
      <hr>
      ${(order.items || []).map(item => `<div class="print-line"><span>${esc(item.name)} / ${esc(item.optionName || "")} × ${esc(item.quantity || 1)}</span>${prices ? `<strong>${K.fmt(Number(item.price || 0) * Number(item.quantity || 1))}</strong>` : ""}</div>${item.addons ? `<p>إضافات: ${esc(item.addons)}</p>` : ""}${item.notes ? `<p>ملاحظة: ${esc(item.notes)}</p>` : ""}`).join("")}
      ${prices || driver ? `<hr><p>التوصيل: ${K.fmt(order.deliveryFee)}</p><h2>الإجمالي: ${K.fmt(order.total)}</h2>${prices ? `<p>شكرًا لاختياركم كباب الديرة</p>` : ""}` : ""}
    `;
    document.body.appendChild(area);
    window.print();
    area.remove();
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
    primeAudio();
    const el = event.target.closest("[data-tab],[data-action],[data-edit-category],[data-toggle-category],[data-delete-category],[data-edit-item],[data-toggle-item],[data-delete-item],[data-edit-addon],[data-toggle-addon],[data-delete-addon],[data-archive],[data-delete-order],[data-print],[data-print-kitchen],[data-print-invoice],[data-print-driver],[data-copy-order],[data-copy-phone],[data-dismiss-order-popup],[data-show-full-details],[data-status-quick],[data-order-open],[data-accept-order],[data-reject-order],[data-export],[data-remove-option],[data-handle-captain-call],[data-order-tab],[data-assign-driver],[data-internal-note]");
    if (!el) return;
    if (el.dataset.tab) { state.tab = el.dataset.tab; state.editing = null; render(); }
    if (el.dataset.orderTab) { state.orderFilters.tab = el.dataset.orderTab; render(); }
    if (el.dataset.action === "logout") await services.auth.signOut();
    if (el.dataset.action === "enableAudio") { audioReady = true; }
    if (el.dataset.action === "enableOrderAudio") enableOrderAudio();
    if (el.dataset.action === "stopAlarm") { stopOrderAlarm(); state.alarmMuted = false; saveAlarmSettings(); }
    if (el.dataset.action === "testAlarm") testOrderAlarm();
    if (el.dataset.action === "clearOrderToast") { state.orderToast = ""; render(); }
    if (el.dataset.action === "refreshOrders") { toast("تم تحديث عرض الطلبات."); render(); }
    if (el.dataset.action === "closeOrderModal") { state.selectedOrderId = ""; state.orderDetailsFull = false; render(); }
    if (el.dataset.action === "requestNotifications" && "Notification" in window) {
      const permission = await Notification.requestPermission();
      state.alarmSettings.browserNotifications = permission === "granted";
      saveAlarmSettings();
      toast(permission === "granted" ? "تم تفعيل إشعارات المتصفح." : "لم يتم تفعيل إشعارات المتصفح.", permission === "granted" ? "success-notice" : "error-notice");
    }
    if (el.dataset.action === "newCategory") { state.editing = null; render(); }
    if (el.dataset.action === "categoryVisibilityAll" || el.dataset.action === "categoryVisibilityNone") {
      const checked = el.dataset.action === "categoryVisibilityAll";
      document.querySelectorAll(".category-visibility-input").forEach(input => { input.checked = checked; });
    }
    if (el.dataset.action === "newItem" || el.dataset.action === "newOffer") { state.editing = null; render(); }
    if (el.dataset.action === "newAddon") { state.editing = null; render(); }
    if (el.dataset.editCategory) { state.editing = { type: "category", data: state.categories.find(c => c.id === el.dataset.editCategory) }; render(); }
    if (el.dataset.toggleCategory) { const c = state.categories.find(x => x.id === el.dataset.toggleCategory); clearMenuCache(); await db.collection("categories").doc(c.id).set({ hidden: !c.hidden, active: c.hidden === true }, { merge: true }); }
    if (el.dataset.deleteCategory && confirm("حذف الفئة؟ سيتم أيضًا حذف الأصناف التابعة لها.")) await deleteCategoryById(el.dataset.deleteCategory);
    if (el.dataset.editItem) { state.editing = { type: "item", data: state.items.find(i => i.id === el.dataset.editItem) }; render(); }
    if (el.dataset.toggleItem) { const i = state.items.find(x => x.id === el.dataset.toggleItem); clearMenuCache(); await db.collection("items").doc(i.id).set({ available: i.available === false }, { merge: true }); }
    if (el.dataset.deleteItem && confirm("حذف الصنف؟")) await deleteItemById(el.dataset.deleteItem);
    if (el.dataset.editAddon) { state.editing = { type: "addon", data: state.addons.find(addon => addon.id === el.dataset.editAddon) }; render(); }
    if (el.dataset.toggleAddon) {
      const addon = state.addons.find(x => x.id === el.dataset.toggleAddon);
      clearMenuCache();
      await db.collection("addons").doc(addon.id).set({ visible: addon.visible === false }, { merge: true });
    }
    if (el.dataset.deleteAddon && confirm("حذف الإضافة؟")) await deleteAddonById(el.dataset.deleteAddon);
    if (el.dataset.action === "addOption") document.getElementById("optionsEditor").insertAdjacentHTML("beforeend", optionForm());
    if (el.dataset.removeOption !== undefined) el.closest(".option-editor")?.remove();
    if (el.dataset.orderOpen) openOrderDetails(el.dataset.orderOpen);
    if (el.dataset.showFullDetails) {
      state.selectedOrderId = el.dataset.showFullDetails;
      state.orderDetailsFull = true;
      render();
    }
    if (el.dataset.dismissOrderPopup) {
      state.dismissedOrderPopups.add(el.dataset.dismissOrderPopup);
      saveDismissedPopups();
      render();
    }
    if (el.dataset.acceptOrder) await acceptOrder(el.dataset.acceptOrder);
    if (el.dataset.rejectOrder) await rejectOrder(el.dataset.rejectOrder);
    if (el.dataset.assignDriver) await assignDriver(el.dataset.assignDriver);
    if (el.dataset.internalNote) await addInternalNote(el.dataset.internalNote);
    if (el.dataset.handleCaptainCall) {
      await db.collection("captain_calls").doc(el.dataset.handleCaptainCall).set({ handled: true, handledAtMs: Date.now(), handledBy: state.user?.email || "admin" }, { merge: true });
      toast("تمت معالجة استدعاء الكابتن.");
    }
    if (el.dataset.statusQuick) await updateOrderStatus(el.dataset.statusQuick, el.dataset.nextStatus);
    if (el.dataset.printDriver) printDriverOrder(el.dataset.printDriver);
    if (el.dataset.printKitchen) printKitchenOrder(el.dataset.printKitchen);
    if (el.dataset.printInvoice) printCustomerInvoice(el.dataset.printInvoice);
    if (el.dataset.copyOrder) await copyOrderData(el.dataset.copyOrder);
    if (el.dataset.copyPhone) await copyOrderPhone(el.dataset.copyPhone);
    if (el.dataset.archive) await db.collection("orders").doc(el.dataset.archive).set({ archived: true }, { merge: true });
    if (el.dataset.deleteOrder && confirm("حذف الطلب؟")) await db.collection("orders").doc(el.dataset.deleteOrder).delete();
    if (el.dataset.print) printCustomerInvoice(el.dataset.print);
    if (el.dataset.action === "archiveDone") {
      const batch = db.batch();
      state.orders.filter(o => o.status === "تم التسليم" || o.status === "ملغي").forEach(o => batch.set(db.collection("orders").doc(o.id), { archived: true }, { merge: true }));
      await batch.commit();
      toast("تمت الأرشفة.");
    }
    if (el.dataset.action === "seed" && confirm("رفع البيانات الأولية؟")) {
      state.categories = K.categoriesSeed;
      state.items = K.itemsSeed;
      state.addons = K.addonsSeed;
      state.settings = { ...K.settingsSeed, menuCleared: false, seedCompleted: true };
      clearMenuCache();
      publishMenuSync();
      await K.seedFirestore(true);
      toast("تم رفع البيانات الأولية.");
    }
    if (el.dataset.action === "clearMenuData" && confirm("هل أنت متأكد؟ سيتم حذف الفئات والأصناف والخيارات والعروض والإضافات فقط، ولن يتم حذف الطلبات.")) await clearMenuData();
    if (el.dataset.action === "repairVisibility") await repairVisibility();
    if (el.dataset.action === "resetItemCardTheme") resetItemCardTheme();
    if (el.dataset.action === "importItemCardTheme") importItemCardTheme();
    if (el.dataset.action === "downloadBackup") backupData();
    if (el.dataset.action === "restoreBackup") await restoreBackup();
    if (el.dataset.export) exportReport(el.dataset.export);
  });

  app.addEventListener("change", async event => {
    primeAudio();
    if (event.target.dataset.itemCardTheme) {
      if (event.target.id === "setItemCardPreset") applyItemCardPreset(event.target.value);
      else applyItemCardPreview();
    }
    if (event.target.dataset.status) {
      await updateOrderStatus(event.target.dataset.status, event.target.value);
    }
    if (event.target.dataset.alarmSetting) {
      const key = event.target.dataset.alarmSetting;
      state.alarmSettings[key] = key === "volume" ? Number(event.target.value) : event.target.value;
      saveAlarmSettings();
      if (alarmTimer) {
        stopOrderAlarm();
        startOrderAlarm();
      }
    }
    if (event.target.dataset.orderFilter) {
      const key = event.target.dataset.orderFilter;
      state.orderFilters[key] = ["lateOnly", "newOnly"].includes(key) ? event.target.checked : event.target.value;
      render();
    }
    if (event.target.dataset.filter === "from") { state.dateFrom = event.target.value; render(); }
    if (event.target.dataset.filter === "to") { state.dateTo = event.target.value; render(); }
  });

  app.addEventListener("input", event => {
    if (!event.target.dataset.itemCardTheme) return;
    syncItemCardColorPair(event.target.dataset.itemCardTheme, event.target.value);
    const preset = document.getElementById("setItemCardPreset");
    if (preset && event.target.id !== "setItemCardPreset") preset.value = "custom";
    applyItemCardPreview();
  });

  app.addEventListener("submit", async event => {
    primeAudio();
    event.preventDefault();
    const form = event.target.dataset.form;
    try {
      if (form === "category") await saveCategory();
      if (form === "item") await saveItem();
      if (form === "addon") await saveAddon();
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
    state.alarmMuted = false;
    audioReady = true;
    saveAlarmSettings();
    primeAudio();
    render();
    db.collection("categories").onSnapshot(s => applyMenuSnapshot("categories", s), () => { state.categories = []; publishMenuSync(); render(); });
    db.collection("items").onSnapshot(s => applyMenuSnapshot("items", s), () => { state.items = []; publishMenuSync(); render(); });
    db.collection("settings").doc("main").onSnapshot(d => {
      state.settings = { ...K.settingsSeed, ...(d.exists ? d.data() : {}) };
      publishMenuSync();
      render();
    }, () => { state.settings = { ...K.settingsSeed, seedCompleted: true }; publishMenuSync(); render(); });
    db.collection("addons").onSnapshot(s => {
      state.addons = visibleDocs(s);
      render();
    }, () => {
      state.addons = [];
      render();
    });
    db.collection("customers").onSnapshot(s => { state.customers = docData(s); });
    db.collection("captain_calls").orderBy("createdAtMs", "desc").limit(30).onSnapshot(s => {
      const previousIds = new Set(state.captainCalls.map(call => call.id));
      state.captainCalls = docData(s);
      const fresh = state.captainCalls.find(call => !call.handled && !previousIds.has(call.id) && Date.now() - Number(call.createdAtMs || 0) < 10 * 60 * 1000);
      if (fresh) {
        state.orderToast = `الزبون طلب التواصل مع الكابتن للطلب رقم #${fresh.orderShortId || String(fresh.orderId || "").slice(0, 8)}`;
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("استدعاء كابتن", { body: state.orderToast, tag: `captain-${fresh.id}` });
        }
      }
      render();
    }, error => console.warn("Captain calls snapshot failed", error));
    db.collection("orders").orderBy("createdAtMs", "desc").limit(200).onSnapshot(s => {
      const orders = docData(s);
      const newOrders = orders.filter(isNewOrder);
      const justArrived = lastNewOrderIds.size ? newOrders.filter(o => !lastNewOrderIds.has(o.id)) : [];
      lastNewOrderIds = new Set(newOrders.map(o => o.id));
      state.orders = orders;
      checkPendingOrders(justArrived);
    });
  });
})();
