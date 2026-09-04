import { getTranslation, getAllTranslations } from './translations.js';

// ============================================
// State
// ============================================
let currentLanguage = 'ar';
let currentDirection = 'rtl';

// ============================================
// Initialization
// ============================================
export function initI18n() {
    const savedLang = localStorage.getItem('app_language') || 'ar';
    setLanguage(savedLang);
    
    window.addEventListener('languageChanged', (e) => {
        const lang = e.detail?.language || 'ar';
        setLanguage(lang);
    });
    
    console.log(`🌐 i18n initialized: ${currentLanguage} (${currentDirection})`);
}

// ============================================
// Set Language
// ============================================
export function setLanguage(lang) {
    currentLanguage = lang;
    currentDirection = lang === 'ar' ? 'rtl' : 'ltr';
    
    document.documentElement.lang = lang;
    document.documentElement.dir = currentDirection;
    
    localStorage.setItem('app_language', lang);
    
    updateAllTexts();
    
    window.dispatchEvent(new CustomEvent('languageChanged', {
        detail: { language: lang, direction: currentDirection }
    }));
    
    console.log(`🌐 Language set to: ${lang} (${currentDirection})`);
}

// ============================================
// Get Current Language
// ============================================
export function getCurrentLanguage() {
    return currentLanguage;
}

export function getCurrentDirection() {
    return currentDirection;
}

// ============================================
// Translate a Single Key
// ============================================
export function t(key, lang = null) {
    const language = lang || currentLanguage;
    return getTranslation(key, language);
}

// ============================================
// Update All UI Elements
// ============================================
export function updateAllTexts() {
    // Update elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translation = t(key);
        if (translation && translation !== key) {
            if (element.children.length > 0) {
                const walker = document.createTreeWalker(
                    element,
                    NodeFilter.SHOW_TEXT,
                    null,
                    false
                );
                let node;
                while (node = walker.nextNode()) {
                    if (node.textContent.trim()) {
                        node.textContent = translation;
                    }
                }
            } else {
                element.textContent = translation;
            }
        }
    });
    
    // Update elements with data-i18n-placeholder attribute
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        const key = element.getAttribute('data-i18n-placeholder');
        const translation = t(key);
        if (translation && translation !== key) {
            element.placeholder = translation;
        }
    });
    
    // Update elements with data-i18n-title attribute
    document.querySelectorAll('[data-i18n-title]').forEach(element => {
        const key = element.getAttribute('data-i18n-title');
        const translation = t(key);
        if (translation && translation !== key) {
            element.title = translation;
        }
    });
    
    // Update language toggle buttons
    updateLanguageButtons();
}

// ============================================
// Update Language Buttons
// ============================================
function updateLanguageButtons() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
        const lang = btn.dataset.lang;
        if (lang) {
            btn.classList.toggle('active', lang === currentLanguage);
            const label = t(lang === 'ar' ? 'lang.arabic' : 'lang.english');
            btn.textContent = lang === 'ar' ? '🇸🇦 عربي' : '🇬🇧 EN';
            btn.title = label;
        }
    });
}

// ============================================
// Translate HTML Content
// ============================================
export function translateHTML(html, lang = null) {
    const language = lang || currentLanguage;
    const container = document.createElement('div');
    container.innerHTML = html;
    
    container.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = getTranslation(key, language);
        if (translation && translation !== key) {
            if (el.children.length === 0) {
                el.textContent = translation;
            }
        }
    });
    
    container.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const translation = getTranslation(key, language);
        if (translation && translation !== key) {
            el.placeholder = translation;
        }
    });
    
    return container.innerHTML;
}

// ============================================
// Format Numbers Based on Language
// ============================================
export function formatNumberLocal(number, decimals = 2) {
    const locale = currentLanguage === 'ar' ? 'ar-EG' : 'en-US';
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(number);
}

// ============================================
// Format Currency Based on Language
// ============================================
export function formatCurrencyLocal(amount) {
    const locale = currentLanguage === 'ar' ? 'ar-EG' : 'en-US';
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EGP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}

// ============================================
// Format Date Based on Language
// ============================================
export function formatDateLocal(date, options = {}) {
    const locale = currentLanguage === 'ar' ? 'ar-EG' : 'en-US';
    const defaultOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    };
    return new Date(date).toLocaleDateString(locale, { ...defaultOptions, ...options });
}

// ============================================
// Expose Globals
// ============================================
window.t = t;
window.setLanguage = setLanguage;
window.getCurrentLanguage = getCurrentLanguage;
window.getCurrentDirection = getCurrentDirection;
window.formatNumberLocal = formatNumberLocal;
window.formatCurrencyLocal = formatCurrencyLocal;
window.formatDateLocal = formatDateLocal;
window.translateHTML = translateHTML;
window.updateAllTexts = updateAllTexts;