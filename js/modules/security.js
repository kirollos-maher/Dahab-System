/**
 * Security Utilities
 * Input Sanitization, Rate Limiting, XSS Protection
 */

// ============================================
// XSS Protection: Sanitize user input for HTML rendering
// ============================================
export function sanitizeHTML(str) {
    if (!str) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        "/": '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    return String(str).replace(/[&<>"'`=\/]/g, function(s) {
        return map[s];
    });
}

// ============================================
// SQL Injection Prevention (for dynamic queries)
// ============================================
export function sanitizeSQL(input) {
    const sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'EXEC', 'UNION', 'JOIN'];
    let sanitized = String(input);
    sqlKeywords.forEach(keyword => {
        const regex = new RegExp(keyword, 'gi');
        sanitized = sanitized.replace(regex, '');
    });
    return sanitized;
}

// ============================================
// Rate Limiting for Login Attempts
// ============================================
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;

export function checkLoginRateLimit(email) {
    const key = `login_attempts_${email}`;
    const attempts = JSON.parse(localStorage.getItem(key) || '[]');
    const now = Date.now();
    
    const recent = attempts.filter(t => now - t < 3600000);
    
    if (recent.length >= MAX_LOGIN_ATTEMPTS) {
        const oldest = recent[0];
        const timeLeft = LOCKOUT_DURATION - (now - oldest);
        if (timeLeft > 0) {
            return {
                blocked: true,
                timeLeft: Math.ceil(timeLeft / 60000)
            };
        } else {
            localStorage.removeItem(key);
            return { blocked: false };
        }
    }
    return { blocked: false };
}

export function recordLoginAttempt(email, success) {
    const key = `login_attempts_${email}`;
    const attempts = JSON.parse(localStorage.getItem(key) || '[]');
    const now = Date.now();
    attempts.push(now);
    localStorage.setItem(key, JSON.stringify(attempts.filter(t => now - t < 3600000)));
    
    if (success) {
        localStorage.removeItem(key);
    }
}

// ============================================
// CSRF Protection (using tokens)
// ============================================
export function generateCSRFToken() {
    const token = btoa(String(Date.now()) + Math.random().toString(36));
    sessionStorage.setItem('csrf_token', token);
    return token;
}

export function validateCSRFToken(token) {
    const stored = sessionStorage.getItem('csrf_token');
    return token && stored && token === stored;
}

// ============================================
// Secure Session Management
// ============================================
export function setSecureSession(key, value) {
    try {
        sessionStorage.setItem(key, btoa(JSON.stringify(value)));
    } catch (e) {
        console.error('Session storage error:', e);
    }
}

export function getSecureSession(key) {
    try {
        const data = sessionStorage.getItem(key);
        if (data) {
            return JSON.parse(atob(data));
        }
        return null;
    } catch (e) {
        return null;
    }
}

// ============================================
// Input Validation Helpers
// ============================================
export function validateSKU(sku) {
    return /^[A-Z0-9]{4,20}$/.test(sku);
}

export function validateCarat(carat) {
    return ['14K', '18K', '21K', '22K', '24K'].includes(carat);
}

export function validateWeight(weight) {
    return !isNaN(weight) && weight > 0 && weight < 10000;
}

export function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePhone(phone) {
    return /^[0-9+\-() ]{7,15}$/.test(phone);
}

export function validateAmount(amount) {
    return !isNaN(amount) && amount >= 0 && amount < 1e9;
}

// ============================================
// Secure API Calls with Token
// ============================================
export async function secureApiCall(url, options = {}) {
    const token = generateCSRFToken();
    const headers = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        ...options.headers,
    };
    
    const response = await fetch(url, {
        ...options,
        headers,
    });
    
    return response;
}

// ============================================
// Prevent Console Logging in Production
// ============================================
export function secureConsole() {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.log = function() {};
        console.warn = function() {};
        console.info = function() {};
    }
}