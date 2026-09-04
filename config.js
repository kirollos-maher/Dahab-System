/**
 * Supabase Configuration
 * Replace with your actual Supabase credentials
 */
export const SUPABASE_CONFIG = {
    url: 'https://xowrtwvsphfotxlirema.supabase.co',
    anonKey: 'sb_publishable_EdoY07-60rV86xYaaBVRyg_4moKSFc-',
};

/**
 * Gold Carat Configuration
 */
export const CARATS = {
    '24K': { ratio: 1.000, label: '24K' },
    '22K': { ratio: 0.917, label: '22K' },
    '21K': { ratio: 0.875, label: '21K' },
    '18K': { ratio: 0.750, label: '18K' },
    '14K': { ratio: 0.583, label: '14K' },
};

/**
 * Gold Rate Cache
 */
export let goldRates = {
    '24K': 0,
    '21K': 0,
    '18K': 0,
    lastUpdate: null,
};

export function updateGoldRates(rates) {
    goldRates = { ...rates, lastUpdate: new Date() };
}

/**
 * Branch State
 */
let activeBranchId = null;
let activeBranchName = '';

export function getActiveBranchId() {
    return activeBranchId;
}

export function setActiveBranchId(id, name = '') {
    activeBranchId = id;
    activeBranchName = name;
    // Dispatch custom event
    window.dispatchEvent(new CustomEvent('branchChanged', { 
        detail: { branchId: id, branchName: name } 
    }));
}

export function getActiveBranchName() {
    return activeBranchName;
}