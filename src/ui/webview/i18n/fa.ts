export const fa: Record<string, string> = {
    // Brand & HUD
    'brand.title': 'HERMES',
    'brand.subtitle': 'LOCAL AGENT',
    'status.connected': 'Local CLI',
    'status.disconnected': 'آفلاین / بدون اتصال',
    'status.connecting': 'در حال اتصال...',

    // Tabs
    'tab.chat': 'چت',
    'tab.sessions': 'تاریخچه',
    'tab.skills': 'مهارت‌ها',
    'tab.models': 'مدل‌ها و تنظیمات',

    // Disconnected Banner
    'banner.title': 'اتصال محلی با هرمس برقرار نیست',
    'banner.desc': 'برای شروع کار ایجنت، دستور راه‌اندازی را اجرا کنید یا روی دکمه زیر کلیک نمایید.',
    'banner.action': 'اجرای راه‌اندازی (hermes setup)',

    // Mission Hub / Hero Dial
    'hero.badge': 'ایجنت خودمختار نوس ریسرچ',
    'hero.title': 'هرمس آماده انجام مأموریت است',
    'hero.subtitle': 'یک گفتگو را آغاز کنید یا از مأموریت‌های پیشنهادی زیر استفاده نمایید:',

    // Mission Cards
    'mission.code.title': 'بررسی و دیباگ کد',
    'mission.code.desc': 'فایل‌های باز پروژه را بررسی کن و خطاهای احتمالی را برطرف نما.',
    'mission.refactor.title': 'بازنویسی تمیز (Refactor)',
    'mission.refactor.desc': 'کدهای این پروژه را مطابق Clean Architecture و ماژولار بازنویسی کن.',
    'mission.skills.title': 'مرور مهارت‌های ذخیره شده',
    'mission.skills.desc': 'فهرست مهارت‌ها و ابزارهای یادگرفته شده روی دیسک را بررسی کن.',
    'mission.terminal.title': 'اجرای دستورات ترمینال',
    'mission.terminal.desc': 'دستورات بیلد، تست و پکیج را در ترمینال امن اجرا کن.',

    // Chat Composer
    'composer.placeholder': 'دستوری بنویسید یا برای ابزارها / را وارد کنید... (Enter)',
    'composer.timer': 'در حال پاسخ...',
    'composer.hint': 'Enter ↵',
    'composer.send': 'ارسال پیام',
    'composer.stop': 'توقف فرآیند (Stop)',
    'composer.selectModel': 'انتخاب مدل',

    // Command Palette
    'palette.title': 'دستورات سریع',
    'palette.close': 'بستن ESC',
    'cmd.new.desc': 'شروع گفتگوی تازه با حافظه پاک',
    'cmd.model.desc': 'تغییر اپراتور هوش مصنوعی یا مدل انتخابی',
    'cmd.skills.desc': 'مشاهده مهارت‌های بارگذاری شده از دیسک',
    'cmd.approve.desc': 'فعال/غیرفعال کردن تأیید خودکار ابزارها',
    'cmd.reconnect.desc': 'اتصال مجدد ارتباط با کلاینت محلی',

    // Live Tools
    'tools.timeline': 'مراحل اجرای ابزارها و فرآیندها',
    'tools.running': 'در حال اجرا...',
    'tools.done': 'انجام شد',
    'tools.error': 'خطا در اجرا',
    'tools.thinking': 'تفکر و تحلیل هرمس (Reasoning)',

    // Sessions Panel
    'sessions.title': 'تاریخچه گفتگوها',
    'sessions.new': 'گفتگوی جدید',
    'sessions.refresh': 'به‌روزرسانی',
    'sessions.filter.active': 'فعال',
    'sessions.filter.archived': 'آرشیو شده',
    'sessions.filter.all': 'همه گفتگوها',
    'sessions.search': 'جستجو در گفتگوها بر اساس عنوان یا مدل...',
    'sessions.empty': 'هیچ گفتگویی یافت نشد.',
    'sessions.resume': 'ادامه گفتگو',
    'sessions.archive': 'آرشیو',
    'sessions.unarchive': 'خروج از آرشیو',
    'sessions.delete': 'حذف',
    'sessions.emptyArchived': 'هیچ گفتگوی آرشیو شده‌ای یافت نشد.',
    'sessions.newStarted': 'گفتگوی جدید آغاز شد',
    'sessions.refreshed': 'فهرست گفتگوها به‌روزرسانی شد',
    'sessions.messagesCount': 'پیام',
    'sessions.view': 'مشاهده',

    // Time Ago
    'time.justNow': 'چند لحظه پیش',
    'time.minsAgo': 'دقیقه پیش',
    'time.hoursAgo': 'ساعت پیش',
    'time.daysAgo': 'روز پیش',

    // Skills Panel
    'skills.title': 'مهارت‌های هرمس',
    'skills.refresh': 'به‌روزرسانی دیسک',
    'skills.refreshed': 'مهارت‌ها از حافظه SSD بازخوانی شدند',
    'skills.desc': 'مهارت‌ها مستقیماً و برحسب تقاضا از حافظه SSD بارگذاری می‌شوند (مصرف رم صفر).',
    'skills.search': 'جستجوی مهارت بر اساس نام، دسته یا کارایی...',
    'skills.empty': 'هیچ مهارتی با این عبارت پیدا نشد.',
    'skills.learned': 'یادگرفته‌شده توسط ایجنت',
    'skills.builtin': 'مهارت پیش‌فرض',
    'skills.useInChat': 'استفاده در چت',
    'skills.openFile': 'باز کردن SKILL.md',

    // Settings & Recovery
    'settings.title': 'سیستم و تنظیمات هرمس (Settings & Recovery)',
    'settings.desc': 'مدیریت اتصال کلاینت محلی، تأیید خودکار ابزارها، مسیرهای اجرایی محیط و زبان افزونه.',
    'settings.reconnecting': 'در حال اتصال به Hermes ACP...',
    'settings.reconnected': 'اتصال با هرمس با موفقیت برقرار شد',

    // Models Panel
    'models.title': 'تنظیمات مدل‌ها و اپراتورهای هوش مصنوعی',
    'models.desc': 'پیکربندی اپراتورهای LLM، کلیدهای دسترسی و مدل‌های پیش‌فرض به‌صورت بصری و بدون نیاز به ترمینال.',
    'models.activeTag': 'مدل فعال کنونی',
    'models.operatorLabel': 'اپراتور / پرووایدر:',
    'models.apiKeyLabel': 'کلید دسترسی (API Key):',
    'models.apiKeySaved': 'ذخیره امن روی دیسک محلی (%LOCALAPPDATA%\\hermes\\.env)',
    'models.modelLabel': 'انتخاب مدل هوش مصنوعی:',
    'models.customCheck': 'ورود دستی شناسه مدل سفارشی',
    'models.applyBtn': 'اعمال تغییرات و شروع چت جدید',
    'models.reconnectBtn': 'اتصال مجدد به ایجنت (Reconnect)',
    'models.terminalSetupBtn': 'اجرای "hermes setup" در ترمینال',
    'models.autoApprove': 'تأیید خودکار دسترسی ابزارها (Auto-Approve)',
    'models.autoApproveDesc': 'اجرای مستقیم دستورات و ویرایش فایل‌ها بدون نیاز به تأیید دستی برای هر مرحله.',
    'models.langLabel': 'زبان رابط کاربری (Language):',
    'models.langFa': 'فارسی (RTL)',
    'models.langEn': 'English (LTR)',

    // Modals & Confirmations
    'modal.confirmTitle': 'تأیید عملیات',
    'modal.cancel': 'انصراف',
    'modal.confirm': 'تأیید',
    'modal.deleteSession': 'آیا مطمئن هستید که می‌خواهید این گفتگو را برای همیشه حذف کنید؟ پیام‌ها و تاریخچه قابل بازیابی نخواهند بود.',
    'modal.archiveSession': 'آیا می‌خواهید این گفتگو را آرشیو کنید؟',

    // Footer Bar
    'footer.agent': 'HERMES / v1.0.0',
    'footer.tagline': 'محلی. مستقل. تحت کنترل شما.'
};
