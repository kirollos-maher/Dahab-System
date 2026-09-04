import { CARATS, goldRates } from '../config.js';
import { t, getCurrentLanguage } from '../i18n/i18n.js';

/**
 * Calculate gold price for a carat
 */
export function calculateGoldPrice(carat, weightInGrams) {
    const ratio = CARATS[carat]?.ratio || 0;
    const baseRate = goldRates['24K'] || 0;
    return weightInGrams * ratio * baseRate;
}

/**
 * Calculate pure gold weight
 */
export function calculatePureGoldWeight(weightGrams, carat) {
    const ratio = CARATS[carat]?.ratio || 0;
    return weightGrams * ratio;
}

/**
 * Generate SKU
 */
export function generateSKU(manufacturerCode, carat, letterCode, sequence) {
    const paddedSeq = String(sequence).padStart(4, '0');
    return `${manufacturerCode}${carat}${letterCode}${paddedSeq}`;
}

/**
 * Generate invoice number
 */
export function generateInvoiceNumber() {
    const now = new Date();
    const prefix = 'INV';
    const year = now.getFullYear().toString().slice(2);
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const random = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `${prefix}-${year}${month}${day}-${random}`;
}

/**
 * Format currency (EGP)
 */
export function formatCurrency(amount) {
    if (amount === undefined || amount === null || isNaN(amount)) {
        return '0.00 EGP';
    }
    const locale = getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US';
    return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EGP',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount);
}

/**
 * Format number
 */
export function formatNumber(num, decimals = 2) {
    if (num === undefined || num === null || isNaN(num)) {
        return '0.00';
    }
    const locale = getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US';
    return new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    }).format(num);
}

/**
 * Show toast notification
 */
export function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer') || createToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(20px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, duration);
}

function createToastContainer() {
    const container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
    return container;
}

/**
 * Debounce utility
 */
export function debounce(fn, delay = 300) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Generate UUID (simple version)
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Format date
 */
export function formatDate(date) {
    const locale = getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US';
    return new Date(date).toLocaleDateString(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Get active branch ID from config
 */
export function getActiveBranchId() {
    // This will be replaced with actual import from config
    return localStorage.getItem('activeBranchId') || null;
}