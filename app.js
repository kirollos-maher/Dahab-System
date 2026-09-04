/**
 * Main Application Entry Point
 * Handles routing, theme, branch isolation, and authentication
 */

import { supabase } from './lib/supabase.js';
import { getCurrentUser, signOut, onAuthChange } from './modules/auth.js';
import { initBranchSelector } from './modules/branch.js';
import { showToast } from './modules/utils.js';
import { updateGoldRates } from './config.js';
import { initI18n, setLanguage, t, getCurrentLanguage, updateAllTexts } from './i18n/i18n.js';
import { renderDataEntry } from './modules/dataEntry.js';
import { renderPOS } from './modules/posScanner.js';
import { renderSuppliers } from './modules/suppliers.js';
import { renderAccounting } from './modules/accounting.js';
import { renderInventory } from './modules/inventory.js';
import { renderAnalytics } from './modules/analytics.js';
import { renderDashboard } from './modules/dashboard.js';
import { renderReturns } from './modules/returns.js';
import { renderEmployees } from './modules/employees.js';

// Page router configuration
const pages = {
    dashboard: { title: 'nav.dashboard', render: renderDashboard },
    'data-entry': { title: 'nav.data-entry', render: renderDataEntry },
    'qr-print': { title: 'nav.qr-print', render: renderPlaceholder },
    'pos-scanner': { title: 'nav.pos-scanner', render: renderPOS },
    inventory: { title: 'nav.inventory', render: renderInventory },
    suppliers: { title: 'nav.suppliers', render: renderSuppliers },
    accounting: { title: 'nav.accounting', render: renderAccounting },
    analytics: { title: 'nav.analytics', render: renderAnalytics },
    returns: { title: 'nav.returns', render: renderReturns },
    employees: { title: 'nav.employees', render: renderEmployees },
};

// Global state
let currentPage = 'dashboard';
let currentUser = null;
let authSubscription = null;
let branchSubscription = null;

// ============================================
// Initialization
// ============================================
async function init() {
    try {
        // Initialize i18n first
        initI18n();
        
        // Setup theme
        setupTheme();
        
        // Setup navigation
        setupNavigation();
        
        // Setup sidebar toggle
        setupSidebarToggle();
        
        // Setup language switcher
        setupLanguageSwitcher();
        
        // Setup logout
        document.getElementById('logoutBtn').addEventListener('click', handleLogout);
        
        // Check authentication
        const user = await getCurrentUser().catch(() => null);
        if (!user) {
            showLoginForm();
            return;
        }
        
        currentUser = user;
        document.getElementById('userName').textContent = user.email?.split('@')[0] || t('auth.user');
        
        // Initialize branch selector
        await initBranchSelector('branchSelector');
        
        // Load gold rates
        await fetchGoldRates();
        
        // Load initial page
        loadPage('dashboard');
        
        // Setup auth listener
        authSubscription = onAuthChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                showLoginForm();
            } else if (event === 'SIGNED_IN') {
                currentUser = session?.user;
                document.getElementById('userName').textContent = currentUser?.email?.split('@')[0] || t('auth.user');
                loadPage(currentPage);
            }
        });
        
        // Listen for branch changes
        window.addEventListener('branchChanged', (e) => {
            console.log('Branch changed:', e.detail);
            loadPage(currentPage, true);
        });
        
        // Start gold rate auto-refresh
        setInterval(fetchGoldRates, 300000);
        
        // Update all translations after DOM is ready
        setTimeout(updateAllTexts, 100);
        
    } catch (err) {
        console.error('Init error:', err);
        showToast(t('toast.error'), 'error');
    }
}

// ============================================
// Theme Management
// ============================================
function setupTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcons(savedTheme);
    
    const toggle = document.getElementById('themeToggle');
    const toggleTop = document.getElementById('themeToggleTop');
    
    const handleToggle = () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcons(next);
    };
    
    toggle.addEventListener('click', handleToggle);
    toggleTop.addEventListener('click', handleToggle);
}

function updateThemeIcons(theme) {
    const icon = theme === 'dark' ? '☀️' : '🌙';
    document.querySelectorAll('.theme-icon, .theme-icon-top').forEach(el => {
        el.textContent = icon;
    });
}

// ============================================
// Navigation
// ============================================
function setupNavigation() {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            if (page) {
                loadPage(page);
                closeSidebarOnMobile();
            }
        });
    });
    
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.replace('#', '');
        if (hash && pages[hash]) {
            loadPage(hash);
        }
    });
}

function loadPage(page, skipTitleUpdate = false) {
    currentPage = page;
    
    // Update active nav
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });
    
    // Update hash
    if (window.location.hash !== `#${page}`) {
        history.pushState(null, '', `#${page}`);
    }
    
    // Update page title
    if (!skipTitleUpdate && pages[page]) {
        const titleKey = pages[page].title;
        document.title = `${t(titleKey)} | ${t('app.name')}`;
    }
    
    // Render page
    const container = document.getElementById('pageContent');
    const renderFn = pages[page]?.render || renderNotFound;
    renderFn(container);
    
    // Update translations after rendering
    setTimeout(updateAllTexts, 50);
}

// Expose for global use
window.loadPage = loadPage;

// ============================================
// Sidebar Toggle (Mobile)
// ============================================
function setupSidebarToggle() {
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('sidebar');
    
    toggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });
    
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768) {
            const isSidebar = sidebar.contains(e.target);
            const isToggle = toggle.contains(e.target);
            if (!isSidebar && !isToggle && !sidebar.classList.contains('collapsed')) {
                sidebar.classList.add('collapsed');
            }
        }
    });
}

function closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.add('collapsed');
    }
}

// ============================================
// Language Switcher
// ============================================
function setupLanguageSwitcher() {
    const buttons = document.querySelectorAll('.lang-btn');
    const savedLang = localStorage.getItem('app_language') || 'ar';
    
    buttons.forEach(btn => {
        const lang = btn.dataset.lang;
        btn.classList.toggle('active', lang === savedLang);
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const newLang = btn.dataset.lang;
            setLanguage(newLang);
            showToast(newLang === 'ar' ? t('lang.arabic') : 'Switched to English', 'success');
            
            // Reload current page to refresh content
            loadPage(currentPage, true);
        });
    });
}

// ============================================
// Gold Rates
// ============================================
async function fetchGoldRates() {
    try {
        const rates = {
            '24K': 2800 + Math.random() * 10 - 5,
            '21K': 2450 + Math.random() * 10 - 5,
            '18K': 2100 + Math.random() * 10 - 5,
        };
        
        updateGoldRates(rates);
        updateGoldTicker(rates);
    } catch (err) {
        console.error('Failed to fetch gold rates:', err);
    }
}

function updateGoldTicker(rates) {
    document.getElementById('goldRate24K').textContent = formatRate(rates['24K']);
    document.getElementById('goldRate21K').textContent = formatRate(rates['21K']);
    document.getElementById('goldRate18K').textContent = formatRate(rates['18K']);
    document.getElementById('tickerUpdateTime').textContent = new Date().toLocaleTimeString(
        getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US'
    );
}

function formatRate(rate) {
    if (!rate || isNaN(rate)) return '--';
    const locale = getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US';
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(rate) + ' ج.م';
}

// ============================================
// Authentication
// ============================================
function showLoginForm() {
    const container = document.getElementById('pageContent');
    container.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 70vh;">
            <div class="card" style="max-width: 400px; width: 100%;">
                <div class="card-body" style="padding: 32px;">
                    <h2 style="text-align: center; margin-bottom: 8px; color: var(--accent-gold);">💎 ${t('app.name')}</h2>
                    <p style="text-align: center; color: var(--text-muted); margin-bottom: 24px;">${t('auth.welcome')}</p>
                    <form id="loginForm">
                        <div class="form-group">
                            <label data-i18n="auth.email">${t('auth.email')}</label>
                            <input type="email" id="loginEmail" required placeholder="example@domain.com" />
                        </div>
                        <div class="form-group">
                            <label data-i18n="auth.password">${t('auth.password')}</label>
                            <input type="password" id="loginPassword" required placeholder="••••••••" />
                        </div>
                        <button type="submit" class="btn btn-primary" style="width: 100%;" data-i18n="auth.login">
                            ${t('auth.login')}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        try {
            const { data, error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) throw error;
            if (data.user) {
                currentUser = data.user;
                document.getElementById('userName').textContent = currentUser.email?.split('@')[0] || t('auth.user');
                showToast(t('toast.success'), 'success');
                await initBranchSelector('branchSelector');
                loadPage('dashboard');
            }
        } catch (err) {
            showToast(t('auth.login-error'), 'error');
        }
    });
}

async function handleLogout() {
    try {
        await signOut();
        showLoginForm();
        showToast(t('auth.logout'), 'success');
    } catch (err) {
        showToast(t('toast.error'), 'error');
    }
}

// ============================================
// Page Renderers
// ============================================
function renderNotFound(container) {
    container.innerHTML = `
        <div class="card">
            <div class="card-body" style="padding: 60px; text-align: center;">
                <p style="font-size: 48px; margin-bottom: 16px;">🔍</p>
                <p class="text-muted" style="font-size: 20px;">${t('common.no-data')}</p>
            </div>
        </div>
    `;
}

function renderPlaceholder(container) {
    const pageName = t(pages[currentPage]?.title || 'common.no-data');
    container.innerHTML = `
        <div class="page-header">
            <h2>${getPageIcon(currentPage)} ${pageName}</h2>
        </div>
        <div class="card">
            <div class="card-body" style="padding: 60px; text-align: center;">
                <p style="font-size: 48px; margin-bottom: 16px;">🚧</p>
                <p class="text-muted" style="font-size: 20px;">${t('common.loading')}</p>
                <p class="text-muted">${t('common.no-data')}</p>
            </div>
        </div>
    `;
}

function getPageIcon(page) {
    const icons = {
        dashboard: '📊',
        'data-entry': '✏️',
        'qr-print': '🏷️',
        'pos-scanner': '📱',
        inventory: '📦',
        suppliers: '🤝',
        accounting: '💰',
        analytics: '📈',
        returns: '↩️',
        employees: '👥',
    };
    return icons[page] || '📄';
}

// ============================================
// Start Application
// ============================================
document.addEventListener('DOMContentLoaded', init);

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    showToast(t('toast.error'), 'error');
});

// Expose for debugging
window.__APP__ = {
    supabase,
    currentPage,
    currentUser,
    loadPage,
    t,
    setLanguage,
    getCurrentLanguage,
};