# P5 — منظومة التقييم: ملاحظات المنهجية والقرارات

## المنهجية

### 1. تقييم MedXpertQA (`src/eval/medxpertqa.ts`, `npm run eval:medxpertqa`)
- **المصدر:** مستودع TsinghuaC3I/MedXpertQA (ترخيص MIT — مسموح)، ملف
  `eval/data/medxpertqa/input/medxpertqa_text_input.jsonl` (2,450 سؤال اختيار من متعدد،
  منسوخ إلى `apps/api/eval-data/`).
- **بنية السؤال:** `id`, `question` (يتضمن نص الخيارات)، `options[]`، `label` (قائمة
  بحرف واحد مثل `["E"]`)، `medical_task`، `body_system`. **لا يوجد حقل تخصص صريح**
  في ملفات الإدخال — أسئلة التخدير حُدّدت بمطابقة كلمات مفتاحية (قوية: anesthesi،
  intubat، propofol، sevoflurane، dantrolene، malignant hyperthermia...؛ ضعيفة:
  airway، sedation، opioid، ASA...).
- **العينة:** أول 60 سؤال تخدير (القوية أولًا بترتيب الملف) + 40 سؤالًا عامًا
  بعينة عشوائية حتمية (seed 20261011) من الباقي. الإجمالي 100 استدعاء LLM.
- **التنفيذ:** عبر `runChat()` الحقيقي مباشرة (نفس الـ pipeline الذي يخدم
  `POST /api/v1/chat`: preCheck → router → agent → postCheck → حفظ).
- **استخراج الإجابة:** يُلحق بالسؤال تعليم تقييم: إنهاء الرد بسطر `Answer: X`.
  الاستخراج بـ regex (سطر مخصص أولًا، ثم أي موضع — يؤخذ **آخر** تطابق).
  هذا لا يغيّر سلوك المنتج: التعليمة جزء من مدخلات الـ harness فقط.
- **الأسئلة المصعّدة:** أي سؤال تُصعّده بوابة السلامة (vignette سريرية بلغة
  طارئة) يُستبعد من الدقة ويُحصى separately — سلوك الـ pipeline الحقيقي.
- **التنظيف:** كل محادثات مستخدم التقييم (`eval@medassist.local`) تُحذف بعد
  التشغيل (CASCADE).
- **الميزانية:** 100 استدعاء Groq حي (gpt-oss-120b) + 10 لاختبار الحقن = ~110.

### 2. اختبارات السلامة العدائية (`src/eval/redteam.ts`, `npm run eval:redteam`)
- **الطوارئ (30):** عبر `preCheck()` مباشرة (حتمي، 0 استدعاءات LLM).
  **المتطلب: 0% فشل.**
- **الجرعات (10):** عبر `postCheck()` بمقاطع اصطناعية. المتطلب: التجريد أو الحجب.
- **حقن البرومبت (10):** عبر `runChat()` الحقيقي (10 استدعاءات). تقييم آلي
  بقواعد آلية (forbidden/required regex) + مراجعة يدوية للمخرجات.
- **البنيوية:** تغطية إخلاء المسؤولية + صلاحية الاستشهادات على نتائج MedXpertQA.

### 3. قرارات تصميمية أثناء P5
- **إصلاح حرج:** كشف الطوارئ كان يفوّت 14/30 عبارة (فئات مفقودة: صدمة،
  فقدان وعي، طوارئ مجرى الهواء، فرط حرارة خبيث، تسمم مخدر موضعي...).
  أُعيد تصميم القوائم بنظام **طبقتين**: صياغات حادة حتمية (دائمًا تُصعّد) +
  أسماء حالات (MH، صدمة، انسداد مجرى الهواء...) تُصعّد فقط مع **علامة حدّة**
  (المريض/اشتباه/طارئ/الآن...) — لأنها أيضًا مواضيع معرفية شائعة لطبيب
  التخدير ("dantrolene dose malignant hyperthermia" يجب أن يذهب لوكيل
  التخدير لا لمسار الطوارئ). هذا التصميم يحقق العقدين معًا: 0% فشل في
  العبارات الطارئة + عدم التصعيد على الأسئلة المعرفية (عقد اختبارات
  `agents-router.test.ts` القائم).
- **قيد معروف (يُوثّق لا يُخفى):** الـ vignettes السريرية الامتحانية
  (25% من العينة) تُصعّدها البوابة لأن لغتها طارئة — سلوك fail-closed
  مقصود، لكنه يعني أن مناقشة الحالات قد تُصعّد أحيانًا. مقترح مستقبلي:
  وضع "مناقشة حالة" أو كشف الـ vignette.

## النتائج
(تُملأ بعد اكتمال التشغيل — انظر P5-EVAL-REPORT.md)

## إعادة توصيل طبقة LLM (2026-10-11 — قرار المستخدم)

**القرار:** إيقاف Groq نهائيًا من السلسلة بسبب الـ throttling المتكرر (429s في P5).
مفاتيح جديدة مخصصة لهذا التطبيق فقط — ممنوع نسخ أي مفتاح من مشروع ربط أو غيره.

### السلم الجديد
`GeminiProvider` (أساسي) ← `CerebrasProvider` (احتياطي) — عبر `FallbackLlmProvider`
في `apps/api/src/llm/fallback.ts`.

### التغييرات
- **حُذف** `src/llm/groq.ts` نهائيًا (لا كود ميت). أُزيل `GROQ_API_KEY` و`GROQ_MODEL`
  من `config.ts`.
- **`src/llm/gemini.ts`** أُعيدت كتابته على الـ OpenAI-compatible endpoint:
  `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
  (bearer header)، الموديل الافتراضي `gemini-2.5-flash` (تجاوز: `GEMINI_MODEL`).
- **`src/llm/cerebras.ts`** جديد: `https://api.cerebras.ai/v1/chat/completions`
  (bearer header)، الموديل الافتراضي `gpt-oss-120b` (تجاوز: `CEREBRAS_MODEL`).
- **`src/llm/fallback.ts`** جديد: سقوط عند 429 أو 5xx أو خطأ شبكة أو مفتاح
  مفقود ← المزود التالي؛ 4xx الأخرى (400/401/403) تفشل فورًا بخطأ واضح.
  يُسجَّل اسم المزود الخادم فقط (`[llm] served by X`) — أبدًا المفتاح.
- **`src/llm/index.ts`**: `LLM_PROVIDER` أصبح `auto|gemini|cerebras|mock`
  (الافتراضي `auto` = السلم). عند غياب كل المفاتيح: تحذير واضح عند الإقلاع
  يذكر `GEMINI_API_KEY` و`CEREBRAS_API_KEY` — بلا crash.
- **`src/routes/chat.ts`**: غياب التكوين ← `503 {code: LLM_NOT_CONFIGURED, ...}`
  برسالة مفيدة (لا crash loop).
- **`src/llm/types.ts`**: أُضيف `LlmNotConfiguredError` و`configured: boolean`
  لواجهة `LlmProvider`.

### المتغيرات (`.env` / `.env.example`)
`LLM_PROVIDER=auto` · `GEMINI_API_KEY=` · `GEMINI_MODEL=gemini-2.5-flash` ·
`CEREBRAS_API_KEY=` · `CEREBRAS_MODEL=gpt-oss-120b`.
قيم `GROQ_API_KEY` و`HF_TOKEN` حُذفت من `.env` (أسطر فارغة مع تعليق) —
**المفاتيح الجديدة لم تُنشأ بعد؛ ينشئها المستخدم (AI Studio + Cerebras)
ويضعها في `.env` فقط، ولا تُنسخ من أي مشروع آخر.**

### الاختبارات
`tests/llm-fallback.test.ts` (11 اختبارًا): سقوط 429 ← Cerebras يخدم،
تخطي المزود بلا مفتاح، فشل فوري على 400، خطأ تجميعي واضح عند فشل الكل،
`LlmNotConfiguredError` يذكر أسماء المتغيرات. كلها عبر Mock — بلا استدعاءات حية.
