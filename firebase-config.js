// 1) أنشئ مشروع Firebase.
// 2) فعّل Authentication بالبريد وكلمة المرور.
// 3) فعّل Firestore و Storage.
// 4) انسخ إعدادات Web app هنا بدل القيم الفارغة.
window.firebaseConfig = {
  apiKey: "AIzaSyCj44Yk1Lxb8M3M1TpOCNuSHG8qyX05C44",
  authDomain: "kabab-aldeera-menu.firebaseapp.com",
  projectId: "kabab-aldeera-menu",
  storageBucket: "kabab-aldeera-menu.firebasestorage.app",
  messagingSenderId: "980760476258",
  appId: "1:980760476258:web:4fbdae05ea0d0ba4326f3b"
};

window.KABAB = (() => {
  const hasFirebaseConfig = () =>
    Boolean(window.firebaseConfig && window.firebaseConfig.apiKey && window.firebaseConfig.projectId);

  const firebaseReady = () => {
    if (!hasFirebaseConfig() || !window.firebase) return null;
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    return {
      app: firebase.app(),
      auth: firebase.auth(),
      db: firebase.firestore(),
      storage: firebase.storage()
    };
  };

  const currency = "د.ع";
  const orderStatuses = [
    "جديد",
    "مقبول",
    "قيد التحضير",
    "جاهز",
    "مع السائق",
    "تم التسليم",
    "مرفوض",
    "ملغي"
  ];

  const settingsSeed = {
    restaurantName: "كباب الديرة",
    logoUrl: "",
    phones: ["07735311855", "07838468817"],
    whatsappNumber: "9647838468817",
    address: "الحرية - شارع الدور",
    isOpen: true,
    workingHours: "يوميًا من 12 ظهرًا حتى 12 ليلًا",
    minimumOrder: 0,
    closedMessage: "المطعم مغلق حاليًا. نعتذر منكم ونعود قريبًا.",
    deliveryEnabled: true,
    deliveryFeeType: "fixed",
    deliveryFee: 1000,
    deliveryFeePerKm: 500,
    deliveryRadiusKm: 7,
    restaurantLat: 33.355,
    restaurantLng: 44.336,
    currency,
    whatsappEnabled: false,
    menuCleared: false
  };

  const categoriesSeed = [
    { id: "offers", name: "عروض الديرة", details: "عروض خاصة ومميزة", icon: "badge-percent", order: 1, active: true, hidden: false, isOffers: true },
    { id: "nafarat", name: "قسم النفرات", details: "مشويات طازجة يوميًا", icon: "flame", order: 2, active: true, hidden: false, isOffers: false },
    { id: "weight", name: "قسم كباب الوزن", details: "لحم غنم عراقي أصيل", icon: "package", order: 3, active: true, hidden: false, isOffers: false },
    { id: "sandwiches", name: "قسم الساندويش", details: "وجبات سريعة وخفيفة", icon: "utensils", order: 4, active: true, hidden: false, isOffers: false },
    { id: "drinks", name: "المشروبات الباردة", details: "عصائر ومشروبات غازية", icon: "coffee", order: 5, active: true, hidden: false, isOffers: false },
    { id: "extras", name: "إضافات أخرى", details: "مقبلات وصمون حار", icon: "plus", order: 6, active: true, hidden: false, isOffers: false }
  ];

  const itemsSeed = [
    { id: "offer1", categoryId: "offers", name: "عرض الديرة الخاص", description: "2 نفر كباب لحم، 1 نفر تكه لحم، 1 نفر تكه دجاج", imageUrl: "", order: 1, visible: true, available: true, isOffer: true, oldPrice: 40000, offerStart: "", offerEnd: "", options: [{ id: "offer1_main", name: "عرض الديرة الخاص", price: 35000, cost: 0, available: true }] },
    { id: "n1", categoryId: "nafarat", name: "كباب لحم", description: "", imageUrl: "", order: 1, visible: true, available: true, options: [{ id: "o1_1", name: "شيش كباب لحم", price: 2500, cost: 0, available: true }, { id: "o1_2", name: "نص نفر كباب لحم", price: 5000, cost: 0, available: true }, { id: "o1_3", name: "نفر كباب لحم", price: 10000, cost: 0, available: true }] },
    { id: "n2", categoryId: "nafarat", name: "تكه لحم", description: "", imageUrl: "", order: 2, visible: true, available: true, options: [{ id: "o2_1", name: "شيش تكه لحم", price: 3000, cost: 0, available: true }, { id: "o2_2", name: "نص نفر تكه لحم", price: 6000, cost: 0, available: true }, { id: "o2_3", name: "نفر تكه لحم", price: 10000, cost: 0, available: true }] },
    { id: "n3", categoryId: "nafarat", name: "معلاك", description: "", imageUrl: "", order: 3, visible: true, available: true, options: [{ id: "o3_1", name: "شيش معلاك", price: 3000, cost: 0, available: true }, { id: "o3_2", name: "نص نفر معلاك", price: 6000, cost: 0, available: true }, { id: "o3_3", name: "نفر معلاك", price: 12000, cost: 0, available: true }] },
    { id: "n4", categoryId: "nafarat", name: "تكه دجاج", description: "", imageUrl: "", order: 4, visible: true, available: true, options: [{ id: "o4_1", name: "شيش تكه دجاج", price: 2000, cost: 0, available: true }, { id: "o4_2", name: "نص تكه دجاج", price: 4000, cost: 0, available: true }, { id: "o4_3", name: "نفر تكه دجاج", price: 8000, cost: 0, available: true }] },
    { id: "n5", categoryId: "nafarat", name: "كباب دجاج", description: "", imageUrl: "", order: 5, visible: true, available: true, options: [{ id: "o5_1", name: "شيش كباب دجاج", price: 2000, cost: 0, available: true }, { id: "o5_2", name: "نص نفر كباب دجاج", price: 4000, cost: 0, available: true }, { id: "o5_3", name: "نفر كباب دجاج", price: 8000, cost: 0, available: true }] },
    { id: "w1", categoryId: "weight", name: "كباب لحم بالوزن", description: "", imageUrl: "", order: 1, visible: true, available: true, options: [{ id: "ow1_1", name: "1 كيلو كباب لحم", price: 24000, cost: 0, available: true }, { id: "ow1_4", name: "3/4 كيلو كباب لحم", price: 18000, cost: 0, available: true }, { id: "ow1_2", name: "نصف كيلو كباب لحم", price: 12000, cost: 0, available: true }, { id: "ow1_3", name: "نصف كيلو كباب مشكل", price: 10000, cost: 0, available: true }] },
    { id: "w2", categoryId: "weight", name: "كباب دجاج بالوزن", description: "", imageUrl: "", order: 2, visible: true, available: true, options: [{ id: "ow2_1", name: "1 كيلو كباب دجاج", price: 14000, cost: 0, available: true }, { id: "ow2_3", name: "3/4 كيلو كباب دجاج", price: 10500, cost: 0, available: true }, { id: "ow2_2", name: "نصف كيلو كباب دجاج", price: 7000, cost: 0, available: true }] },
    { id: "s1", categoryId: "sandwiches", name: "لفة كباب لحم", description: "", imageUrl: "", order: 1, visible: true, available: true, options: [{ id: "os1_1", name: "عادي", price: 2500, cost: 0, available: true }, { id: "os1_2", name: "دبل", price: 5000, cost: 0, available: true }] },
    { id: "s2", categoryId: "sandwiches", name: "لفة تكه لحم", description: "", imageUrl: "", order: 2, visible: true, available: true, options: [{ id: "os2_1", name: "عادي", price: 2500, cost: 0, available: true }, { id: "os2_2", name: "دبل", price: 5000, cost: 0, available: true }] },
    { id: "s3", categoryId: "sandwiches", name: "لفة معلاك", description: "", imageUrl: "", order: 3, visible: true, available: true, options: [{ id: "os3_1", name: "عادي", price: 2500, cost: 0, available: true }, { id: "os3_2", name: "دبل", price: 5000, cost: 0, available: true }] },
    { id: "s4", categoryId: "sandwiches", name: "لفة تكه دجاج", description: "", imageUrl: "", order: 4, visible: true, available: true, options: [{ id: "os4_1", name: "عادي", price: 2000, cost: 0, available: true }, { id: "os4_2", name: "دبل", price: 4000, cost: 0, available: true }] },
    { id: "s5", categoryId: "sandwiches", name: "لفة كباب دجاج", description: "", imageUrl: "", order: 5, visible: true, available: true, options: [{ id: "os5_1", name: "عادي", price: 1500, cost: 0, available: true }, { id: "os5_2", name: "دبل", price: 3000, cost: 0, available: true }] },
    { id: "d1", categoryId: "drinks", name: "كولا", description: "", imageUrl: "", order: 1, visible: true, available: true, options: [{ id: "od1", name: "عادي", price: 500, cost: 0, available: true }] },
    { id: "d2", categoryId: "drinks", name: "سبرايت", description: "", imageUrl: "", order: 2, visible: true, available: true, options: [{ id: "od2", name: "عادي", price: 500, cost: 0, available: true }] },
    { id: "d3", categoryId: "drinks", name: "فانتا", description: "", imageUrl: "", order: 3, visible: true, available: true, options: [{ id: "od3", name: "عادي", price: 500, cost: 0, available: true }] },
    { id: "d4", categoryId: "drinks", name: "لبن", description: "", imageUrl: "", order: 4, visible: true, available: true, options: [{ id: "od4", name: "عادي", price: 500, cost: 0, available: true }] },
    { id: "d5", categoryId: "drinks", name: "ماء", description: "", imageUrl: "", order: 5, visible: true, available: true, options: [{ id: "od5", name: "عادي", price: 500, cost: 0, available: true }] },
    { id: "e1", categoryId: "extras", name: "صمون عدد 6", description: "", imageUrl: "", order: 1, visible: true, available: true, options: [{ id: "oe1", name: "عادي", price: 1000, cost: 0, available: true }] },
    { id: "e2", categoryId: "extras", name: "بيبسي كبير", description: "", imageUrl: "", order: 2, visible: true, available: true, options: [{ id: "oe2", name: "عادي", price: 1500, cost: 0, available: true }] },
    { id: "e3", categoryId: "extras", name: "صحن مقبلات", description: "", imageUrl: "", order: 3, visible: true, available: true, options: [{ id: "oe3", name: "عادي", price: 1000, cost: 0, available: true }] }
  ];

  const addonsSeed = [
    { id: "addon_bread", name: "صمون إضافي", price: 1000, cost: 0, available: true, visible: true, order: 1 },
    { id: "addon_pickles", name: "صحن مقبلات", price: 1000, cost: 0, available: true, visible: true, order: 2 },
    { id: "addon_spicy", name: "صوص حار", price: 500, cost: 0, available: true, visible: true, order: 3 }
  ];
  const customersSeed = [];

  const fmt = value => `${Number(value || 0).toLocaleString("ar-IQ")} ${currency}`;
  const sortByOrder = list => [...list].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const id = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const percentOff = (oldPrice, newPrice) => {
    if (!oldPrice || !newPrice || oldPrice <= newPrice) return 0;
    return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
  };

  const localSync = (() => {
    const key = "kabab_menu_sync_payload";
    const channelName = "kabab_menu_sync";
    const channel = "BroadcastChannel" in window ? new BroadcastChannel(channelName) : null;

    const publish = payload => {
      const fullPayload = { ...payload, syncedAt: Date.now() };
      try { localStorage.setItem(key, JSON.stringify(fullPayload)); } catch (error) {}
      if (channel) channel.postMessage(fullPayload);
      return fullPayload;
    };

    const read = () => {
      try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (error) { return null; }
    };

    const subscribe = handler => {
      const onMessage = event => handler(event.data);
      const onStorage = event => {
        if (event.key === key && event.newValue) {
          try { handler(JSON.parse(event.newValue)); } catch (error) {}
        }
      };
      if (channel) channel.addEventListener("message", onMessage);
      window.addEventListener("storage", onStorage);
      return () => {
        if (channel) channel.removeEventListener("message", onMessage);
        window.removeEventListener("storage", onStorage);
      };
    };

    return { publish, read, subscribe };
  })();
  const distanceKm = (lat1, lon1, lat2, lon2) => {
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  async function uploadImage(file, folder = "menu") {
    const services = firebaseReady();
    if (!services || !file) return "";
    const ref = services.storage.ref(`${folder}/${Date.now()}-${file.name}`);
    const snap = await ref.put(file);
    return snap.ref.getDownloadURL();
  }

  async function seedFirestore() {
    const services = firebaseReady();
    if (!services) throw new Error("أضف إعدادات Firebase أولًا.");
    const batch = services.db.batch();
    batch.set(services.db.collection("settings").doc("main"), settingsSeed, { merge: true });
    categoriesSeed.forEach(category => batch.set(services.db.collection("categories").doc(category.id), category, { merge: true }));
    itemsSeed.forEach(item => {
      batch.set(services.db.collection("items").doc(item.id), item, { merge: true });
      (item.options || []).forEach(option => {
        batch.set(services.db.collection("item_options").doc(`${item.id}_${option.id}`), {
          ...option,
          itemId: item.id
        }, { merge: true });
      });
      if (item.isOffer) {
        batch.set(services.db.collection("offers").doc(item.id), {
          itemId: item.id,
          name: item.name,
          oldPrice: item.oldPrice || 0,
          newPrice: (item.options || [])[0]?.price || 0,
          active: item.available !== false && item.visible !== false,
          offerStart: item.offerStart || "",
          offerEnd: item.offerEnd || ""
        }, { merge: true });
      }
    });
    addonsSeed.forEach(addon => batch.set(services.db.collection("addons").doc(addon.id), addon, { merge: true }));
    customersSeed.forEach(customer => batch.set(services.db.collection("customers").doc(customer.id), customer, { merge: true }));
    await batch.commit();
  }

  return {
    hasFirebaseConfig,
    firebaseReady,
    currency,
    orderStatuses,
    settingsSeed,
    categoriesSeed,
    itemsSeed,
    addonsSeed,
    fmt,
    sortByOrder,
    id,
    percentOff,
    distanceKm,
    uploadImage,
    seedFirestore,
    localSync
  };
})();
