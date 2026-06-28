const LANG_EN = {
  tagline:
    "Gyaku（逆、<em>inversion</em>）— A lightweight DI container for TypeScript, designed around <code>await using</code>.",
  "gh-btn": "View on GitHub",
  "why-label": "Why gyaku?",
  "feat-0-title": "Fully type-safe",
  "feat-0-desc":
    "Unregistered dependencies and duplicate keys are caught at the type level",
  "feat-1-title": "No decorators",
  "feat-1-desc": "No decorators or <code>reflect-metadata</code> needed",
  "feat-2-title": "Parallel resolution",
  "feat-2-desc":
    "Services with no shared dependencies are resolved in parallel following the dependency graph",
  "feat-3-title": "Auto cleanup with <code>await using</code>",
  "feat-3-desc":
    "<code>using</code>-compatible values are disposed automatically in reverse dependency order",
  "feat-4-title": "<code>async</code> factory support",
  "feat-4-desc": "Factories can be written with or without <code>async</code>",
  "feat-5-title": "Testable by design",
  "feat-5-desc":
    "Swap out dependencies easily with <code>replaceService</code> / <code>replaceValue</code>.",
  "quickstart-label": "Quick start",
} as const;

type LangDict = Record<keyof typeof LANG_EN, string>;

const LANG_JA = {
  tagline:
    "Gyaku（逆、<em>inversion</em>）— TypeScript向けの軽量DIコンテナ。<code>await using</code>を軸に設計されています。",
  "gh-btn": "GitHubで見る",
  "why-label": "Why gyaku？",
  "feat-0-title": "完全な型安全",
  "feat-0-desc": "未登録の依存と重複キーは型レベルで検出されます",
  "feat-1-title": "デコレータ不要",
  "feat-1-desc": "デコレータ、<code>reflect-metadata</code>は使いません",
  "feat-2-title": "並列解決",
  "feat-2-desc":
    "共通の依存を持たないサービスは依存グラフに沿って並列に解決されます",
  "feat-3-title": "<code>await using</code>で自動クリーンアップ",
  "feat-3-desc": "<code>using</code>対応の値は依存の逆順で自動破棄されます",
  "feat-4-title": "<code>async</code>ファクトリ対応",
  "feat-4-desc": "ファクトリは<code>async</code>ありなしどちらでも書けます",
  "feat-5-title": "テストしやすい設計",
  "feat-5-desc":
    "<code>replaceService</code> / <code>replaceValue</code>で依存を差し替えられます。",
  "quickstart-label": "Quick start",
} as const satisfies LangDict;

const TRANSLATIONS = {
  en: LANG_EN,
  ja: LANG_JA,
};

type Lang = keyof typeof TRANSLATIONS;

const LANG_KEY = "gyaku-lang";
const saved = localStorage.getItem(LANG_KEY) as Lang | null;
const auto = navigator.language.startsWith("ja") ? "ja" : "en";
let currentLang = saved ?? auto;

function applyLang(lang: Lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang;
  const dict = TRANSLATIONS[lang];
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = (el as HTMLElement).dataset.i18n!;
    const value = dict[key as keyof LangDict];
    if (value !== undefined) el.innerHTML = value;
  });
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", (btn as HTMLElement).dataset.lang === lang);
  });
}

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () =>
    applyLang((btn as HTMLElement).dataset.lang as Lang),
  );
});

applyLang(currentLang);
