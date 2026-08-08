# מבנה תיקיות וקבצים

> המסמך מציג עץ מבני של הפרויקט + הסבר תמציתי על כל שכבה.

## עץ מבנה (קצר)
```
.
├── docs/                      # תיעוד הפרויקט בעברית
├── src/
│   ├── api/                   # לקוח SDK מול Base44
│   ├── components/            # קומפוננטות UI/פיצ'רים
│   │   ├── admin/              # מסכי ניהול
│   │   ├── calendar/           # לוח משמרות והחלפות
│   │   ├── dashboard/          # KPI, עזרה, סטטיסטיקות
│   │   ├── onboarding/         # מסך הצטרפות ראשוני
│   │   ├── sidebar/             # פאנל התראות/פופאפים (NotificationSidebar + messageStore)
│   │   └── ui/                 # קומפוננטות בסיסיות (shadcn/ui + Radix)
│   ├── hooks/                 # Hooks מותאמים (למשל זיהוי מובייל)
│   ├── lib/                   # לוגיקה תשתיתית: Auth Context, Query Client, Utils
│   ├── pages/                 # דפי אפליקציה (כרגע רק Home)
│   ├── App.jsx                # קומפוננטת שורש
│   ├── main.jsx                # Entry point
│   ├── App.css, index.css     # סגנונות גלובליים
│   └── pages.config.js        # מיפוי דפים ונתיב ראשי
├── index.html                 # תבנית HTML
├── package.json               # סקריפטים ותלויות
├── vite.config.js             # קונפיגורציית Vite (כולל תוסף Tailwind v4)
└── .oxlintrc.json             # קונפיגורציית Oxlint (linter)
```

> אין בפרויקט כרגע תיקיית `src/assets` או `src/utils` נפרדת, ואין קבצי `tailwind.config.js` / `postcss.config.js` / `eslint.config.js` / `jsconfig.json` / `components.json` בשורש – Tailwind מוגדר ישירות דרך תוסף Vite (`@tailwindcss/vite`), ובדיקת קוד מתבצעת עם Oxlint בלבד.

## הסברים כלליים
- **`src/api/`** – יוצר לקוח SDK (`base44`) לכל קריאה ל־Entities/Auth/Integrations.
- **`src/lib/`** – שכבת לוגיקה תשתיתית (Auth, QueryClient, מעקב ניווט, Utilities).
- **`src/components/`** – הליבה הויזואלית והעסקית של האפליקציה.
- **`src/pages/`** – דפים שמרכיבים את ה-Routes (כרגע דף אחד בלבד – Home).

> פירוט על כל קובץ נמצא במסמכי התיעוד הייעודיים בתוך `docs/`.
