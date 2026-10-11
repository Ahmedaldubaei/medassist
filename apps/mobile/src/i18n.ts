/**
 * Arabic-first i18n. Every UI string lives here — no hardcoded AR/EN text in screens.
 * `t(lang, key)` with full key parity enforced by tests.
 */

export type Lang = 'ar' | 'en';

const ar = {
  'app.name': 'مساعد التخدير الذكي',
  'app.tagline': 'عينك الثانية في المعرفة السريرية',

  'auth.welcome': 'مرحبًا بك',
  'auth.welcomeBack': 'مرحبًا بعودتك',
  'auth.subtitle': 'سجّل الدخول للمتابعة',
  'auth.createAccount': 'إنشاء حساب جديد',
  'auth.createSubtitle': 'انضم كطبيب أو طالب طب',
  'auth.email': 'البريد الإلكتروني',
  'auth.emailPlaceholder': 'name@hospital.com',
  'auth.password': 'كلمة المرور',
  'auth.passwordPlaceholder': '8 أحرف على الأقل',
  'auth.name': 'الاسم الكامل',
  'auth.namePlaceholder': 'د. أحمد محمد',
  'auth.loginButton': 'تسجيل الدخول',
  'auth.registerButton': 'إنشاء الحساب',
  'auth.noAccount': 'ليس لديك حساب؟',
  'auth.haveAccount': 'لديك حساب بالفعل؟',
  'auth.signUpLink': 'أنشئ واحدًا',
  'auth.signInLink': 'سجّل الدخول',
  'auth.errEmail': 'أدخل بريدًا إلكترونيًا صحيحًا',
  'auth.errPassword': 'كلمة المرور 8 أحرف على الأقل',
  'auth.errName': 'أدخل الاسم',
  'auth.errLogin': 'بيانات الدخول غير صحيحة',
  'auth.errRegister': 'تعذر إنشاء الحساب، حاول مجددًا',
  'auth.errEmailInUse': 'هذا البريد مسجل بالفعل',

  'chat.title': 'المحادثات',
  'chat.new': 'محادثة جديدة',
  'chat.empty': 'لا توجد محادثات بعد',
  'chat.emptyHint': 'ابدأ محادثة جديدة لطرح سؤالك الأول',
  'chat.typeMessage': 'اكتب سؤالك الطبي…',
  'chat.send': 'إرسال',
  'chat.typing': 'يكتب…',
  'chat.error': 'تعذر إرسال الرسالة، حاول مجددًا',
  'chat.newConversation': 'محادثة جديدة',

  'msg.documented': 'معرفة موثقة',
  'msg.inference': 'استنتاج النموذج',
  'msg.sources': 'المصادر',
  'msg.confidence': 'الثقة',
  'msg.confidenceHigh': 'عالية',
  'msg.confidenceMedium': 'متوسطة',
  'msg.confidenceLow': 'منخفضة',
  'msg.openSource': 'فتح المصدر',
  'msg.license': 'الترخيص',
  'msg.guidelineYear': 'سنة الإرشاد',
  'msg.emergencyTitle': 'تنبيه طارئ',
  'msg.agentAnesthesiology': 'وكيل التخدير',
  'msg.agentKnowledge': 'وكيل المعرفة',
  'msg.agentAssistant': 'المساعد العام',

  'settings.title': 'الإعدادات',
  'settings.language': 'اللغة',
  'settings.arabic': 'العربية',
  'settings.english': 'English',
  'settings.account': 'الحساب',
  'settings.role': 'الدور',
  'settings.logout': 'تسجيل الخروج',
  'settings.logoutConfirm': 'هل تريد تسجيل الخروج؟',
  'settings.version': 'الإصدار',
  'settings.langRestart': 'سيُعاد تشغيل التطبيق لتطبيق اللغة',

  'role.ADMIN': 'مدير',
  'role.CLINICIAN': 'طبيب',
  'role.STUDENT': 'طالب',
  'role.VIEWER': 'مشاهد',

  'common.cancel': 'إلغاء',
  'common.retry': 'إعادة المحاولة',
  'common.loading': 'جارٍ التحميل…',
  'common.confirm': 'تأكيد',
  'common.back': 'رجوع',
} as const;

const en: Record<keyof typeof ar, string> = {
  'app.name': 'Smart Anesthesia Assistant',
  'app.tagline': 'Your second pair of eyes in clinical knowledge',

  'auth.welcome': 'Welcome',
  'auth.welcomeBack': 'Welcome back',
  'auth.subtitle': 'Sign in to continue',
  'auth.createAccount': 'Create a new account',
  'auth.createSubtitle': 'Join as a clinician or medical student',
  'auth.email': 'Email',
  'auth.emailPlaceholder': 'name@hospital.com',
  'auth.password': 'Password',
  'auth.passwordPlaceholder': 'At least 8 characters',
  'auth.name': 'Full name',
  'auth.namePlaceholder': 'Dr. Ahmed Mohammed',
  'auth.loginButton': 'Sign in',
  'auth.registerButton': 'Create account',
  'auth.noAccount': "Don't have an account?",
  'auth.haveAccount': 'Already have an account?',
  'auth.signUpLink': 'Create one',
  'auth.signInLink': 'Sign in',
  'auth.errEmail': 'Enter a valid email address',
  'auth.errPassword': 'Password must be at least 8 characters',
  'auth.errName': 'Enter your name',
  'auth.errLogin': 'Invalid credentials',
  'auth.errRegister': 'Could not create the account, try again',
  'auth.errEmailInUse': 'This email is already registered',

  'chat.title': 'Conversations',
  'chat.new': 'New chat',
  'chat.empty': 'No conversations yet',
  'chat.emptyHint': 'Start a new chat to ask your first question',
  'chat.typeMessage': 'Type your medical question…',
  'chat.send': 'Send',
  'chat.typing': 'Typing…',
  'chat.error': 'Could not send the message, try again',
  'chat.newConversation': 'New conversation',

  'msg.documented': 'Documented knowledge',
  'msg.inference': 'Model inference',
  'msg.sources': 'Sources',
  'msg.confidence': 'Confidence',
  'msg.confidenceHigh': 'High',
  'msg.confidenceMedium': 'Medium',
  'msg.confidenceLow': 'Low',
  'msg.openSource': 'Open source',
  'msg.license': 'License',
  'msg.guidelineYear': 'Guideline year',
  'msg.emergencyTitle': 'Emergency alert',
  'msg.agentAnesthesiology': 'Anesthesiology Agent',
  'msg.agentKnowledge': 'Knowledge Agent',
  'msg.agentAssistant': 'General Assistant',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.arabic': 'العربية',
  'settings.english': 'English',
  'settings.account': 'Account',
  'settings.role': 'Role',
  'settings.logout': 'Sign out',
  'settings.logoutConfirm': 'Do you want to sign out?',
  'settings.version': 'Version',
  'settings.langRestart': 'The app will restart to apply the language',

  'role.ADMIN': 'Admin',
  'role.CLINICIAN': 'Clinician',
  'role.STUDENT': 'Student',
  'role.VIEWER': 'Viewer',

  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.confirm': 'Confirm',
  'common.back': 'Back',
};

export type I18nKey = keyof typeof ar;

const dictionaries: Record<Lang, Record<I18nKey, string>> = { ar, en };

export function t(lang: Lang, key: I18nKey): string {
  return dictionaries[lang][key];
}

/** All keys (used by tests to enforce AR/EN parity). */
export function allKeys(): I18nKey[] {
  return Object.keys(ar) as I18nKey[];
}

export function isRTL(lang: Lang): boolean {
  return lang === 'ar';
}
