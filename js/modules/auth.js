import { supabase } from '../lib/supabase.js';
import { showToast } from './utils.js';
import { t } from '../i18n/i18n.js';

/**
 * Sign in with email and password
 */
export async function signIn(email, password) {
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        
        if (error) throw error;
        
        showToast(t('toast.success'), 'success');
        return data;
    } catch (err) {
        showToast(err.message || t('auth.login-error'), 'error');
        throw err;
    }
}

/**
 * Sign out
 */
export async function signOut() {
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        showToast(t('auth.logout'), 'success');
        return true;
    } catch (err) {
        showToast(err.message || t('toast.error'), 'error');
        throw err;
    }
}

/**
 * Get current user
 */
export async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
}

/**
 * Get current session
 */
export async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
}

/**
 * Listen for auth changes
 */
export function onAuthChange(callback) {
    return supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}

/**
 * Sign up (for admin use)
 */
export async function signUp(email, password, userData = {}) {
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: userData,
            },
        });
        
        if (error) throw error;
        
        showToast(t('toast.success'), 'success');
        return data;
    } catch (err) {
        showToast(err.message || t('toast.error'), 'error');
        throw err;
    }
}