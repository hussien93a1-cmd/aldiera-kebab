# بناء تطبيق Android APK

أفضل مسار لهذا المشروع هو Capacitor لأنه يفتح صفحة الزبون المنشورة على GitHub Pages داخل تطبيق Android.

## المتطلبات

- Node.js
- Android Studio
- Android SDK
- Java JDK مناسب لإصدار Android Studio

## الأوامر

```bash
npm install
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap sync android
npx cap open android
```

من Android Studio:

1. انتظر Gradle Sync.
2. افتح Build.
3. اختر Build Bundle(s) / APK(s).
4. اختر Build APK(s).
5. بعد انتهاء البناء اضغط locate لفتح ملف APK.

## الصلاحيات المطلوبة

أضفها في `android/app/src/main/AndroidManifest.xml` إذا لم يضفها Capacitor تلقائيًا:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

التطبيق يستخدم الرابط:

```txt
https://hussien93a1-cmd.github.io/aldiera-kebab/
```

ويبقى متصلًا بنفس Firebase المستخدم في لوحة التحكم.
