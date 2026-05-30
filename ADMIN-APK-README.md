# تطبيق لوحة التحكم APK - كباب الديرة

تم إنشاء تطبيق Android للوحة التحكم باسم:

- Kabab-AlDeera-Admin.apk

## ماذا يعمل الآن؟

- يفتح صفحة تسجيل دخول الإدارة مباشرة:
  https://hussien93a1-cmd.github.io/aldiera-kebab/login.html
- بعد تسجيل الدخول تظهر لوحة التحكم والطلبات.
- عند بقاء التطبيق مفتوحًا أو في الواجهة تعمل تنبيهات الطلبات الموجودة في لوحة التحكم.
- تم تجهيز المشروع بصلاحيات Android للتنبيهات والاهتزاز والاستيقاظ:
  INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS, WAKE_LOCK, VIBRATE
- أضيفت إضافات Capacitor:
  @capacitor/push-notifications
  @capacitor/local-notifications

## مهم بخصوص الرنين والتطبيق مغلق

تشغيل نغمة عند وصول طلب والتطبيق مغلق بالكامل لا يمكن ضمانه من صفحة WebView وحدها، لأن Firestore onSnapshot يعمل فقط أثناء تشغيل الصفحة.

لجعل الهاتف يرن حتى عندما التطبيق مغلق نحتاج خطوة إضافية:

1. إضافة تطبيق Android داخل Firebase بنفس package name:
   com.kabab.aldeera.admin
2. تنزيل ملف google-services.json من Firebase.
3. وضعه داخل:
   admin-apk/android/app/google-services.json
4. تفعيل Firebase Cloud Messaging.
5. إنشاء Cloud Function ترسل Push Notification عند إنشاء طلب جديد في orders.
6. داخل التطبيق يتم استقبال Push Notification وتشغيل صوت التنبيه.

بدون هذه الخطوة، التطبيق يستقبل الطلبات والتنبيه الصوتي عندما يكون مفتوحًا، أما وهو مغلق بالكامل فيحتاج Push Notification أصلية.

## البناء مجددًا

من داخل مجلد admin-apk:

```powershell
npm install
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

الملف الناتج يكون في:

admin-apk/android/app/build/outputs/apk/debug/app-debug.apk
