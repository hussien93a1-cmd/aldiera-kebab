# كباب الديرة - منيو إلكتروني متزامن

هذا المشروع يحوّل المنيو من ملف واحد ببيانات ثابتة إلى نظام يعمل على GitHub Pages مع Firebase كمصدر رئيسي للبيانات.

## الملفات

- `index.html`: صفحة الزبون.
- `admin.html`: لوحة التحكم.
- `login.html`: تسجيل دخول الإدارة.
- `firebase-config.js`: إعداد Firebase والبيانات الأولية.
- `customer.js`: منطق صفحة الزبون والسلة وإرسال الطلب.
- `admin.js`: لوحة التحكم، CRUD، الطلبات، التقارير، النسخ الاحتياطي.
- `style.css`: التصميم العربي RTL.

## إعداد Firebase

1. افتح [Firebase Console](https://console.firebase.google.com/).
2. أنشئ مشروعًا جديدًا.
3. من Authentication فعّل Email/Password.
4. أضف مستخدم الإدارة من Authentication > Users.
5. فعّل Firestore Database بوضع Production.
6. فعّل Storage.
7. من Project settings > Your apps أضف Web app.
8. انسخ قيم `firebaseConfig` إلى `firebase-config.js`.
9. افتح `login.html` وسجّل دخولك.
10. من تبويب النسخ الاحتياطي اضغط: رفع البيانات الأولية إلى Firebase.

## Firestore Collections

- `categories`: الفئات وترتيبها وحالتها.
- `items`: الأصناف والخيارات والأسعار والعروض.
- `item_options`: نسخة مفهرسة من خيارات الأصناف لتسهيل التقارير والتكلفة لاحقًا.
- `offers`: نسخة مفهرسة من العروض النشطة؛ بطاقة العرض في صفحة الزبون تعتمد على الأصناف التي تحمل `isOffer`.
- `addons`: إضافات مستقبلية.
- `settings/main`: إعدادات المطعم والتوصيل.
- `orders`: الطلبات وحالاتها.
- `customers`: بيانات الزبائن عند الحاجة.

## قواعد Firestore المقترحة

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    match /categories/{doc} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /items/{doc} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /addons/{doc} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /item_options/{doc} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /offers/{doc} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /settings/{doc} {
      allow read: if true;
      allow write: if signedIn();
    }

    match /orders/{doc} {
      allow create: if true
        && request.resource.data.keys().hasAll(['customer', 'items', 'total', 'status', 'createdAtMs'])
        && request.resource.data.status == 'جديد';
      allow read, update, delete: if signedIn();
    }

    match /public_order_status/{doc} {
      allow read: if true;
      allow create: if request.resource.data.status == 'جديد';
      allow update, delete: if signedIn();
    }

    match /customers/{doc} {
      allow create: if true;
      allow read, update, delete: if signedIn();
    }
  }
}
```

## قواعد Storage المقترحة

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

## النشر على GitHub Pages

1. ارفع الملفات إلى مستودع GitHub.
2. من Settings > Pages اختر الفرع والمجلد الجذر.
3. افتح رابط GitHub Pages.
4. استخدم `login.html` للإدارة و `index.html` للزبائن.

## ملاحظات مهمة

- واتساب خيار إضافي فقط، ويمكن تفعيله من إعدادات المطعم.
- الطلب الأساسي يحفظ في Firestore داخل `orders`.
- صفحة الزبون تستخدم `onSnapshot` للفئات والأصناف والإعدادات وتتبع الطلب.
- لوحة التحكم تستخدم `onSnapshot` للطلبات وتصدر تنبيهًا صوتيًا بعد ضغط زر تفعيل التنبيه.
- في حال عدم ضبط Firebase ستظهر صفحة الزبون بالبيانات الأولية فقط، ولن يتم حفظ الطلبات.
