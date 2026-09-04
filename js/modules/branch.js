import { supabase } from '../lib/supabase.js';
import { setActiveBranchId, getActiveBranchId, getActiveBranchName } from '../config.js';
import { showToast } from './utils.js';
import { t } from '../i18n/i18n.js';

/**
 * Load all branches from Supabase
 */
export async function loadBranches() {
    try {
        const { data, error } = await supabase
            .from('branches')
            .select('*')
            .order('name');
        
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('Failed to load branches:', err);
        showToast(t('common.error'), 'error');
        return [];
    }
}

/**
 * Populate branch selector dropdown
 */
export function populateBranchSelector(branches, selectorId = 'branchSelector') {
    const selector = document.getElementById(selectorId);
    if (!selector) return;
    
    // Preserve current selection if available
    const currentBranchId = getActiveBranchId();
    
    selector.innerHTML = '';
    
    if (branches.length === 0) {
        selector.innerHTML = `<option value="">${t('branch.no-branches')}</option>`;
        return;
    }
    
    // Add default option
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = `-- ${t('branch.select')} --`;
    selector.appendChild(defaultOption);
    
    // Add branch options
    branches.forEach(branch => {
        const option = document.createElement('option');
        option.value = branch.id;
        option.textContent = branch.name + (branch.is_main_warehouse ? ` ★` : '');
        selector.appendChild(option);
    });
    
    // Set selected value
    if (currentBranchId) {
        selector.value = currentBranchId;
    } else {
        // Auto-select first branch or main warehouse
        const mainBranch = branches.find(b => b.is_main_warehouse);
        if (mainBranch) {
            selector.value = mainBranch.id;
        } else if (branches.length > 0) {
            selector.value = branches[0].id;
        }
    }
    
    // Trigger change event if selection is valid
    if (selector.value) {
        const selectedBranch = branches.find(b => b.id === selector.value);
        if (selectedBranch) {
            setActiveBranchId(selectedBranch.id, selectedBranch.name);
        }
        selector.dispatchEvent(new Event('change'));
    }
}

/**
 * Initialize branch selector with realtime updates
 */
export async function initBranchSelector(selectorId = 'branchSelector') {
    const selector = document.getElementById(selectorId);
    if (!selector) return;
    
    // Load branches
    const branches = await loadBranches();
    populateBranchSelector(branches, selectorId);
    
    // Handle branch change
    selector.addEventListener('change', (e) => {
        const branchId = e.target.value;
        const branch = branches.find(b => b.id === branchId);
        
        if (branch) {
            setActiveBranchId(branch.id, branch.name);
            showToast(`${t('common.success')}: ${branch.name}`, 'success');
            
            // Reload current page data
            const currentPage = document.querySelector('.nav-link.active')?.dataset?.page || 'dashboard';
            if (currentPage && window.loadPage) {
                window.loadPage(currentPage);
            }
        } else {
            setActiveBranchId(null, '');
        }
    });
    
    // Setup realtime subscription for branches
    const channel = supabase
        .channel('public:branches')
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'branches',
            },
            async () => {
                // Reload branches when changes occur
                const newBranches = await loadBranches();
                const currentValue = selector.value;
                populateBranchSelector(newBranches, selectorId);
                if (currentValue && newBranches.find(b => b.id === currentValue)) {
                    selector.value = currentValue;
                }
                showToast(t('common.refresh'), 'info');
            }
        )
        .subscribe();
    
    return channel;
}

/**
 * Get current branch filter for queries
 */
export function getBranchFilter() {
    const branchId = getActiveBranchId();
    return branchId ? { branch_id: branchId } : {};
}

/**
 * Check if branch is selected
 */
export function isBranchSelected() {
    return !!getActiveBranchId();
}

/**
 * Get branch name
 */
export function getCurrentBranchName() {
    return getActiveBranchName() || t('common.no-data');
}