import { fetchData, insertData, updateData, supabase } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, debounce,
    getActiveBranchId
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t } from '../i18n/i18n.js';

// ============================================
// State
// ============================================
let activeTier = 'shift';
let shiftData = null;
let pendingSales = [];
let expenses = [];
let currentShiftId = null;

// ============================================
// Main Render Function
// ============================================
export async function renderAccounting(container) {
    const branchId = getActiveBranchId();
    await checkShiftStatus(branchId);
    
    container.innerHTML = `
        <div class="page-header">
            <h2>💰 ${t('accounting.title')}</h2>
            <div class="page-actions">
                <span class="text-muted" id="shiftStatusDisplay">
                    ${currentShiftId ? '🟢 ' + t('accounting.shift-open') : '🔴 ' + t('common.no-data')}
                </span>
            </div>
        </div>

        <!-- Tier Navigation -->
        <nav class="tier-nav" id="tierNav">
            <button class="tier-btn active" data-tier="shift">
                🏪 ${t('accounting.tier1')}
                <span class="tier-badge">${t('common.daily') || 'يومي'}</span>
            </button>
            <button class="tier-btn" data-tier="expenses">
                📋 ${t('accounting.tier2')}
                <span class="tier-badge">${t('common.management') || 'إدارة'}</span>
            </button>
            <button class="tier-btn" data-tier="ledger">
                📊 ${t('accounting.tier3')}
                <span class="tier-badge">${t('common.total')}</span>
            </button>
        </nav>

        <!-- Tier 1: Shift Management -->
        <div id="shiftPanel" class="tier-panel active">
            ${renderShiftPanel()}
        </div>

        <!-- Tier 2: Expenses & Approvals -->
        <div id="expensesPanel" class="tier-panel">
            ${renderExpensesPanel()}
        </div>

        <!-- Tier 3: Master Ledger -->
        <div id="ledgerPanel" class="tier-panel">
            ${renderLedgerPanel()}
        </div>
    `;

    // Setup tier navigation
    document.querySelectorAll('.tier-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const tier = this.dataset.tier;
            document.querySelectorAll('.tier-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`${tier}Panel`).classList.add('active');
            activeTier = tier;
        });
    });

    setupShiftActions();
    setupExpenseActions();
    setupApprovalActions();
    
    setInterval(() => {
        if (activeTier === 'shift') refreshShiftData();
        if (activeTier === 'expenses') refreshExpensesData();
        if (activeTier === 'ledger') refreshLedgerData();
    }, 30000);
}

// ============================================
// Tier 1: Shift Management
// ============================================
async function checkShiftStatus(branchId) {
    if (!branchId) {
        currentShiftId = null;
        return;
    }
    
    try {
        const { data, error } = await supabase
            .from('shifts')
            .select('*')
            .eq('branch_id', branchId)
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .limit(1);
        
        if (error) throw error;
        
        currentShiftId = data && data.length > 0 ? data[0].id : null;
        shiftData = data && data.length > 0 ? data[0] : null;
    } catch (err) {
        console.error('Shift check error:', err);
        currentShiftId = null;
    }
}

function renderShiftPanel() {
    const isOpen = !!currentShiftId;
    const shift = shiftData || {};
    
    return `
        <div class="shift-header">
            <div class="shift-status">
                <span>${t('accounting.shift-open')}:</span>
                <span class="status-badge ${isOpen ? 'open' : 'closed'}">
                    ${isOpen ? '🟢 ' + t('accounting.shift-open') : '🔴 ' + t('common.close')}
                </span>
                ${isOpen ? `<span style="font-size: 13px; color: var(--text-muted);">
                    ${t('common.from') || 'من'}: ${new Date(shift.created_at).toLocaleString('ar-EG')}
                </span>` : ''}
            </div>
            <div>
                ${!isOpen ? `
                    <button class="btn btn-success" id="openShiftBtn">
                        🟢 ${t('accounting.shift-open')}
                    </button>
                ` : `
                    <button class="btn btn-danger" id="closeShiftBtn">
                        🔴 ${t('accounting.shift-close')}
                    </button>
                `}
            </div>
        </div>

        ${isOpen ? `
            <div class="shift-stats" id="shiftStats">
                <div class="shift-stat-card">
                    <div class="stat-value" id="shiftSales">${formatCurrency(0)}</div>
                    <div class="stat-label">${t('common.total')}</div>
                </div>
                <div class="shift-stat-card">
                    <div class="stat-value" id="shiftWeight">${formatNumber(0, 3)} جم</div>
                    <div class="stat-label">${t('gold.weight-grams')}</div>
                </div>
                <div class="shift-stat-card">
                    <div class="stat-value" id="shiftTransactions">0</div>
                    <div class="stat-label">${t('common.total')}</div>
                </div>
                <div class="shift-stat-card">
                    <div class="stat-value gold" id="shiftWorkmanship">${formatCurrency(0)}</div>
                    <div class="stat-label">${t('gold.workmanship')}</div>
                </div>
            </div>

            <!-- Shift Sales Table -->
            <div class="card">
                <div class="card-header">
                    <h3>${t('common.total')}</h3>
                    <span class="text-muted" id="shiftTransactionCount">0 ${t('common.total')}</span>
                </div>
                <div class="card-body no-padding">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>${t('common.invoice') || 'الفاتورة'}</th>
                                    <th>${t('form.salesperson')}</th>
                                    <th>${t('common.amount')}</th>
                                    <th>${t('gold.weight-grams')}</th>
                                    <th>${t('gold.workmanship')}</th>
                                    <th>${t('common.date')}</th>
                                </tr>
                            </thead>
                            <tbody id="shiftTransactionsBody">
                                <tr>
                                    <td colspan="6" class="text-center text-muted">${t('common.no-data')}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        ` : `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                <p style="font-size: 48px; margin-bottom: 12px;">🏪</p>
                <p style="font-size: 18px;">${t('common.no-data')}</p>
                <p>${t('accounting.shift-open')}</p>
            </div>
        `}
    `;
}

function setupShiftActions() {
    const openBtn = document.getElementById('openShiftBtn');
    const closeBtn = document.getElementById('closeShiftBtn');
    
    if (openBtn) {
        openBtn.addEventListener('click', openShift);
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeShift);
    }
}

async function openShift() {
    const branchId = getActiveBranchId();
    if (!branchId) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    try {
        const { data, error } = await supabase
            .from('shifts')
            .select('id')
            .eq('branch_id', branchId)
            .eq('status', 'open')
            .limit(1);
        
        if (error) throw error;
        
        if (data && data.length > 0) {
            showToast(t('common.exists') || 'يوجد وردية مفتوحة', 'warning');
            return;
        }
        
        const shiftData = {
            branch_id: branchId,
            status: 'open',
            opened_by: 'system',
            opened_at: new Date().toISOString(),
            initial_cash: 0,
            initial_gold: 0,
        };
        
        const { data: newShift, error: insertError } = await supabase
            .from('shifts')
            .insert(shiftData)
            .select();
        
        if (insertError) throw insertError;
        
        currentShiftId = newShift[0].id;
        shiftData = newShift[0];
        
        showToast('✅ ' + t('accounting.shift-open'), 'success');
        renderAccounting(document.getElementById('pageContent'));
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

async function closeShift() {
    if (!currentShiftId) {
        showToast(t('common.no-data'), 'warning');
        return;
    }
    
    if (!confirm(t('modal.confirm-close') || 'هل أنت متأكد من إغلاق الوردية؟')) return;
    
    try {
        const { data: sales, error: salesError } = await supabase
            .from('sales')
            .select('*')
            .eq('shift_id', currentShiftId)
            .eq('status', 'APPROVED');
        
        if (salesError) throw salesError;
        
        const totalSales = sales.reduce((sum, s) => sum + s.total_cash, 0);
        const totalWeight = sales.reduce((sum, s) => sum + s.total_grams, 0);
        const totalWorkmanship = sales.reduce((sum, s) => sum + s.workmanship_total, 0);
        
        const { error: updateError } = await supabase
            .from('shifts')
            .update({
                status: 'closed',
                closed_at: new Date().toISOString(),
                total_sales: totalSales,
                total_weight: totalWeight,
                total_workmanship: totalWorkmanship,
                transaction_count: sales.length,
            })
            .eq('id', currentShiftId);
        
        if (updateError) throw updateError;
        
        showToast(`✅ ${t('accounting.shift-close')} - ${formatCurrency(totalSales)}`, 'success');
        currentShiftId = null;
        shiftData = null;
        
        renderAccounting(document.getElementById('pageContent'));
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

async function refreshShiftData() {
    if (!currentShiftId) return;
    
    try {
        const { data: sales, error } = await supabase
            .from('sales')
            .select('*')
            .eq('shift_id', currentShiftId)
            .eq('status', 'APPROVED');
        
        if (error) throw error;
        
        const totalSales = sales.reduce((sum, s) => sum + s.total_cash, 0);
        const totalWeight = sales.reduce((sum, s) => sum + s.total_grams, 0);
        const totalWorkmanship = sales.reduce((sum, s) => sum + s.workmanship_total || 0, 0);
        
        document.getElementById('shiftSales').textContent = formatCurrency(totalSales);
        document.getElementById('shiftWeight').textContent = formatNumber(totalWeight, 3) + ' جم';
        document.getElementById('shiftTransactions').textContent = sales.length;
        document.getElementById('shiftWorkmanship').textContent = formatCurrency(totalWorkmanship);
        document.getElementById('shiftTransactionCount').textContent = sales.length + ' ' + t('common.total');
        
        const tbody = document.getElementById('shiftTransactionsBody');
        if (tbody) {
            if (sales.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center text-muted">${t('common.no-data')}</td>
                    </tr>
                `;
            } else {
                tbody.innerHTML = sales.slice(0, 50).map(s => `
                    <tr>
                        <td><strong>${s.invoice_number}</strong></td>
                        <td>${s.salesperson_name}</td>
                        <td>${formatCurrency(s.total_cash)}</td>
                        <td>${formatNumber(s.total_grams, 3)} جم</td>
                        <td>${formatCurrency(s.workmanship_total || 0)}</td>
                        <td>${new Date(s.created_at).toLocaleString('ar-EG')}</td>
                    </tr>
                `).join('');
            }
        }
    } catch (err) {
        console.error('Refresh shift error:', err);
    }
}

// ============================================
// Tier 2: Expenses & POS Approvals
// ============================================
function renderExpensesPanel() {
    return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">
            <!-- Expenses Section -->
            <div>
                <h3 style="margin-bottom: 12px;">📋 ${t('accounting.expenses')}</h3>
                <div class="expense-form">
                    <form id="expenseForm">
                        <div class="form-row">
                            <div class="form-group">
                                <label>${t('form.description')}</label>
                                <input type="text" name="description" required placeholder="${t('form.description')}" />
                            </div>
                            <div class="form-group">
                                <label>${t('common.amount')}</label>
                                <input type="number" name="amount" step="0.01" required placeholder="0.00" />
                            </div>
                            <div class="form-group">
                                <label>${t('form.category')}</label>
                                <select name="category" required>
                                    <option value="">${t('common.select')}</option>
                                    <option value="rent">${t('common.rent') || 'إيجار'}</option>
                                    <option value="utilities">${t('common.utilities') || 'مرافق'}</option>
                                    <option value="maintenance">${t('common.maintenance') || 'صيانة'}</option>
                                    <option value="salaries">${t('common.salaries') || 'رواتب'}</option>
                                    <option value="marketing">${t('common.marketing') || 'تسويق'}</option>
                                    <option value="other">${t('common.other') || 'أخرى'}</option>
                                </select>
                            </div>
                            <button type="submit" class="btn btn-primary" style="align-self: end;">
                                ➕ ${t('common.add')}
                            </button>
                        </div>
                    </form>
                </div>

                <!-- Expenses List -->
                <div class="card">
                    <div class="card-header">
                        <h3>${t('accounting.expenses')}</h3>
                        <span class="text-muted" id="expenseCount">0 ${t('common.total')}</span>
                    </div>
                    <div class="card-body no-padding">
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>${t('common.date')}</th>
                                        <th>${t('form.description')}</th>
                                        <th>${t('form.category')}</th>
                                        <th>${t('common.amount')}</th>
                                    </tr>
                                </thead>
                                <tbody id="expensesBody">
                                    <tr>
                                        <td colspan="4" class="text-center text-muted">${t('common.no-data')}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <!-- POS Approvals Section -->
            <div>
                <h3 style="margin-bottom: 12px;">✅ ${t('pos.pending-approval')}</h3>
                <div id="approvalsContainer">
                    <div class="card">
                        <div class="card-header">
                            <h3>${t('pos.pending-approval')}</h3>
                            <span class="text-muted" id="pendingCount">0</span>
                        </div>
                        <div class="card-body" id="approvalsList">
                            <div class="text-center text-muted" style="padding: 20px;">
                                ${t('common.no-data')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupExpenseActions() {
    const form = document.getElementById('expenseForm');
    if (form) {
        form.addEventListener('submit', handleExpenseSubmit);
    }
    
    loadExpenses();
    loadPendingApprovals();
}

async function handleExpenseSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
    
    const branchId = getActiveBranchId();
    if (!branchId) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    try {
        const expenseData = {
            branch_id: branchId,
            description: data.description,
            amount: parseFloat(data.amount),
            category: data.category,
            recorded_by: 'system',
        };
        
        const { data: result, error } = await supabase
            .from('branch_expenses')
            .insert(expenseData)
            .select();
        
        if (error) throw error;
        
        showToast('✅ ' + t('common.success'), 'success');
        e.target.reset();
        loadExpenses();
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

async function loadExpenses() {
    const branchId = getActiveBranchId();
    if (!branchId) return;
    
    try {
        const { data, error } = await supabase
            .from('branch_expenses')
            .select('*')
            .eq('branch_id', branchId)
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (error) throw error;
        
        expenses = data || [];
        
        const tbody = document.getElementById('expensesBody');
        const count = document.getElementById('expenseCount');
        
        if (count) count.textContent = expenses.length + ' ' + t('common.total');
        
        if (tbody) {
            if (expenses.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" class="text-center text-muted">${t('common.no-data')}</td>
                    </tr>
                `;
            } else {
                const categoryLabels = {
                    rent: 'إيجار',
                    utilities: 'مرافق',
                    maintenance: 'صيانة',
                    salaries: 'رواتب',
                    marketing: 'تسويق',
                    other: 'أخرى',
                };
                
                tbody.innerHTML = expenses.map(e => `
                    <tr>
                        <td>${new Date(e.created_at).toLocaleDateString('ar-EG')}</td>
                        <td>${e.description}</td>
                        <td>${categoryLabels[e.category] || e.category}</td>
                        <td style="color: var(--danger);">${formatCurrency(e.amount)}</td>
                    </tr>
                `).join('');
            }
        }
    } catch (err) {
        console.error('Load expenses error:', err);
    }
}

async function loadPendingApprovals() {
    const branchId = getActiveBranchId();
    
    try {
        let query = supabase
            .from('sales')
            .select('*, branch_id(name)')
            .eq('status', 'PENDING_APPROVAL');
        
        if (branchId) {
            query = query.eq('branch_id', branchId);
        }
        
        const { data, error } = await query
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        pendingSales = data || [];
        
        const container = document.getElementById('approvalsList');
        const count = document.getElementById('pendingCount');
        
        if (count) count.textContent = pendingSales.length;
        
        if (container) {
            if (pendingSales.length === 0) {
                container.innerHTML = `
                    <div class="text-center text-muted" style="padding: 20px;">
                        ✅ ${t('common.no-data')}
                    </div>
                `;
            } else {
                container.innerHTML = pendingSales.map(s => `
                    <div class="approval-item">
                        <div class="approval-info">
                            <span class="invoice-number">${s.invoice_number}</span>
                            <span class="invoice-details">
                                ${s.salesperson_name} | ${formatCurrency(s.total_cash)} | 
                                ${formatNumber(s.total_grams, 3)} جم
                            </span>
                        </div>
                        <div class="approval-actions">
                            <button class="btn btn-success btn-sm" onclick="window.approveSale('${s.id}')">
                                ✅ ${t('pos.approved')}
                            </button>
                            <button class="btn btn-danger btn-sm" onclick="window.rejectSale('${s.id}')">
                                ❌ ${t('pos.rejected')}
                            </button>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (err) {
        console.error('Load pending approvals error:', err);
    }
}

function setupApprovalActions() {
    window.approveSale = async function(saleId) {
        try {
            const { error } = await supabase
                .from('sales')
                .update({ status: 'APPROVED' })
                .eq('id', saleId);
            
            if (error) throw error;
            
            showToast('✅ ' + t('pos.approved'), 'success');
            loadPendingApprovals();
            refreshShiftData();
        } catch (err) {
            showToast(err.message || '❌ ' + t('common.error'), 'error');
        }
    };
    
    window.rejectSale = async function(saleId) {
        if (!confirm(t('modal.confirm-reject') || 'هل أنت متأكد من رفض هذه الفاتورة؟')) return;
        
        try {
            const { data: items, error: itemsError } = await supabase
                .from('sale_items')
                .select('inventory_id')
                .eq('sale_id', saleId);
            
            if (itemsError) throw itemsError;
            
            for (const item of items) {
                await supabase
                    .from('inventory')
                    .update({ status: 'IN_STOCK' })
                    .eq('id', item.inventory_id);
            }
            
            const { error } = await supabase
                .from('sales')
                .update({ status: 'REJECTED' })
                .eq('id', saleId);
            
            if (error) throw error;
            
            showToast('❌ ' + t('pos.rejected'), 'success');
            loadPendingApprovals();
        } catch (err) {
            showToast(err.message || '❌ ' + t('common.error'), 'error');
        }
    };
}

async function refreshExpensesData() {
    await loadExpenses();
    await loadPendingApprovals();
}

// ============================================
// Tier 3: Master Ledger
// ============================================
function renderLedgerPanel() {
    return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;">
            <!-- Income Statement -->
            <div>
                <h3 style="margin-bottom: 12px;">📊 ${t('accounting.income-statement')}</h3>
                <div class="income-statement" id="incomeStatement">
                    <div class="section">
                        <div class="section-title">📈 ${t('report.gross-sales')}</div>
                        <div class="row">
                            <span class="label">${t('report.gross-sales')}</span>
                            <span class="value" id="isGrossSales">${formatCurrency(0)}</span>
                        </div>
                        <div class="row">
                            <span class="label">${t('report.workmanship-total')}</span>
                            <span class="value" id="isWorkmanship">${formatCurrency(0)}</span>
                        </div>
                    </div>
                    
                    <div class="section">
                        <div class="section-title">📉 ${t('report.total-expenses')}</div>
                        <div class="row">
                            <span class="label">${t('report.total-expenses')}</span>
                            <span class="value" id="isExpenses">${formatCurrency(0)}</span>
                        </div>
                    </div>
                    
                    <div class="section">
                        <div class="row total">
                            <span class="label">${t('accounting.net-profit')}</span>
                            <span class="value" id="isNetProfit">${formatCurrency(0)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Vault Valuation -->
            <div>
                <h3 style="margin-bottom: 12px;">🏦 ${t('accounting.vault-valuation')}</h3>
                <div class="vault-valuation">
                    <div class="vault-stats">
                        <div class="vault-stat">
                            <div class="vault-value" id="vaultGoldWeight">0.000 جم</div>
                            <div class="vault-label">${t('gold.pure-weight')}</div>
                        </div>
                        <div class="vault-stat">
                            <div class="vault-value" id="vaultGoldValue">${formatCurrency(0)}</div>
                            <div class="vault-label">${t('gold.market-value')}</div>
                        </div>
                        <div class="vault-stat">
                            <div class="vault-value" id="vaultItemCount">0</div>
                            <div class="vault-label">${t('common.total')}</div>
                        </div>
                        <div class="vault-stat">
                            <div class="vault-value gold" id="vaultGoldRate">${formatCurrency(goldRates['24K'] || 0)}</div>
                            <div class="vault-label">${t('gold.gold-rate')}</div>
                        </div>
                    </div>
                    
                    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                        <button class="btn btn-primary btn-sm" onclick="window.refreshVaultValuation()">
                            🔄 ${t('common.refresh')}
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="window.exportFinancialReport()">
                            📥 ${t('common.export')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function refreshLedgerData() {
    await updateIncomeStatement();
    await updateVaultValuation();
}

async function updateIncomeStatement() {
    const branchId = getActiveBranchId();
    
    try {
        let salesQuery = supabase
            .from('sales')
            .select('total_cash, total_grams, workmanship_total')
            .eq('status', 'APPROVED');
        
        if (branchId) {
            salesQuery = salesQuery.eq('branch_id', branchId);
        }
        
        const { data: sales, error: salesError } = await salesQuery;
        if (salesError) throw salesError;
        
        let expensesQuery = supabase
            .from('branch_expenses')
            .select('amount');
        
        if (branchId) {
            expensesQuery = expensesQuery.eq('branch_id', branchId);
        }
        
        const { data: expensesData, error: expensesError } = await expensesQuery;
        if (expensesError) throw expensesError;
        
        const grossSales = sales.reduce((sum, s) => sum + s.total_cash, 0);
        const workmanship = sales.reduce((sum, s) => sum + (s.workmanship_total || 0), 0);
        const totalExpenses = expensesData.reduce((sum, e) => sum + e.amount, 0);
        const netProfit = grossSales - totalExpenses;
        
        document.getElementById('isGrossSales').textContent = formatCurrency(grossSales);
        document.getElementById('isWorkmanship').textContent = formatCurrency(workmanship);
        document.getElementById('isExpenses').textContent = formatCurrency(totalExpenses);
        
        const profitEl = document.getElementById('isNetProfit');
        profitEl.textContent = formatCurrency(netProfit);
        profitEl.style.color = netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
        
    } catch (err) {
        console.error('Income statement error:', err);
    }
}

async function updateVaultValuation() {
    const branchId = getActiveBranchId();
    const goldRate = goldRates['24K'] || 0;
    
    try {
        let query = supabase
            .from('inventory')
            .select('id, pure_gold_weight')
            .eq('status', 'IN_STOCK');
        
        if (branchId) {
            query = query.eq('branch_id', branchId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        const totalGoldWeight = data.reduce((sum, item) => sum + item.pure_gold_weight, 0);
        const totalValue = totalGoldWeight * goldRate;
        
        document.getElementById('vaultGoldWeight').textContent = formatNumber(totalGoldWeight, 3) + ' جم';
        document.getElementById('vaultGoldValue').textContent = formatCurrency(totalValue);
        document.getElementById('vaultItemCount').textContent = data.length;
        document.getElementById('vaultGoldRate').textContent = formatCurrency(goldRate);
        
    } catch (err) {
        console.error('Vault valuation error:', err);
    }
}

// Expose for global use
window.refreshVaultValuation = updateVaultValuation;

// ============================================
// Export Financial Report
// ============================================
window.exportFinancialReport = async function() {
    try {
        const branchId = getActiveBranchId();
        
        const [sales, expenses, inventory] = await Promise.all([
            fetchData('sales', '*', { status: 'APPROVED' }),
            fetchData('branch_expenses', '*'),
            fetchData('inventory', 'pure_gold_weight, carat, sku', { status: 'IN_STOCK' }),
        ]);
        
        const goldRate = goldRates['24K'] || 0;
        const totalGoldWeight = inventory.reduce((sum, i) => sum + i.pure_gold_weight, 0);
        const vaultValue = totalGoldWeight * goldRate;
        
        const grossSales = sales.reduce((sum, s) => sum + s.total_cash, 0);
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
        const netProfit = grossSales - totalExpenses;
        
        const reportData = {
            'التقرير المالي': '',
            'تاريخ التقرير': new Date().toLocaleDateString('ar-EG'),
            '': '',
            'قائمة الدخل': '',
            'إجمالي المبيعات': grossSales,
            'إجمالي المصروفات': totalExpenses,
            'صافي الربح': netProfit,
            '': '',
            'تقييم الخزينة': '',
            'وزن الذهب الصافي (24K)': totalGoldWeight,
            'سعر الجرام': goldRate,
            'القيمة السوقية': vaultValue,
            'عدد القطع': inventory.length,
        };
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet([reportData]);
        XLSX.utils.book_append_sheet(wb, ws, 'التقرير المالي');
        XLSX.writeFile(wb, `financial_report_${new Date().toISOString().slice(0,10)}.xlsx`);
        
        showToast('✅ ' + t('common.success'), 'success');
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
};

// ============================================
// Expose Globals
// ============================================
window.renderAccounting = renderAccounting;
window.approveSale = window.approveSale;
window.rejectSale = window.rejectSale;
window.exportFinancialReport = window.exportFinancialReport;
window.refreshVaultValuation = updateVaultValuation;