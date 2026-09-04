import { fetchData, insertData, updateData, supabase, deleteData } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, debounce,
    getActiveBranchId
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t } from '../i18n/i18n.js';
import { sanitizeHTML } from './security.js';

// ============================================
// State
// ============================================
let entities = [];
let currentEntity = null;
let transactions = [];

// ============================================
// Main Render Function
// ============================================
export async function renderSuppliers(container) {
    entities = await fetchData('entities', '*');
    
    const suppliers = entities.filter(e => e.type === 'SUPPLIER');
    const clients = entities.filter(e => e.type === 'WHOLESALE_CLIENT');
    
    const totalSuppliers = suppliers.length;
    const totalClients = clients.length;
    const totalCashBalance = entities.reduce((sum, e) => sum + e.cash_balance, 0);
    const totalGoldBalance = entities.reduce((sum, e) => sum + e.gold_gram_balance, 0);
    
    container.innerHTML = `
        <div class="page-header">
            <h2>🤝 ${t('suppliers.title')}</h2>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="window.showAddEntity('SUPPLIER')">
                    ➕ ${t('suppliers.add-supplier')}
                </button>
                <button class="btn btn-primary" onclick="window.showAddEntity('WHOLESALE_CLIENT')">
                    ➕ ${t('suppliers.add-client')}
                </button>
                <button class="btn btn-outline" onclick="window.exportEntities()">
                    📥 ${t('common.export')}
                </button>
            </div>
        </div>

        <!-- Stats -->
        <div class="entity-stats">
            <div class="entity-stat-card">
                <div class="stat-number">${totalSuppliers}</div>
                <div class="stat-label">${t('suppliers.supplier')}</div>
            </div>
            <div class="entity-stat-card">
                <div class="stat-number">${totalClients}</div>
                <div class="stat-label">${t('suppliers.client')}</div>
            </div>
            <div class="entity-stat-card">
                <div class="stat-number ${totalCashBalance >= 0 ? 'balance-positive' : 'balance-negative'}">
                    ${formatCurrency(totalCashBalance)}
                </div>
                <div class="stat-label">${t('suppliers.cash-balance')}</div>
            </div>
            <div class="entity-stat-card">
                <div class="stat-number ${totalGoldBalance >= 0 ? 'balance-positive' : 'balance-negative'}">
                    ${formatNumber(totalGoldBalance, 3)} جم
                </div>
                <div class="stat-label">${t('suppliers.gold-balance')}</div>
            </div>
        </div>

        <!-- Tabs -->
        <div style="display: flex; gap: 4px; margin-bottom: 16px; background: var(--bg-card); padding: 4px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
            <button class="tab-btn active" data-tab="suppliers" style="flex:1; padding: 10px; border: none; background: transparent; cursor: pointer; border-radius: var(--radius-sm); font-weight: 500; transition: all var(--transition);">
                ${t('suppliers.supplier')} (${suppliers.length})
            </button>
            <button class="tab-btn" data-tab="clients" style="flex:1; padding: 10px; border: none; background: transparent; cursor: pointer; border-radius: var(--radius-sm); font-weight: 500; transition: all var(--transition);">
                ${t('suppliers.client')} (${clients.length})
            </button>
        </div>

        <!-- Suppliers Table -->
        <div id="suppliersTab" class="tab-content">
            <div class="card">
                <div class="card-header">
                    <h3>${t('suppliers.supplier')}</h3>
                    <span class="text-muted">${suppliers.length} ${t('common.total')}</span>
                </div>
                <div class="card-body no-padding">
                    <div class="entity-table-wrap">
                        <table class="entity-table">
                            <thead>
                                <tr>
                                    <th>${t('form.name')}</th>
                                    <th>${t('form.phone')}</th>
                                    <th>${t('suppliers.cash-balance')}</th>
                                    <th>${t('suppliers.gold-balance')}</th>
                                    <th>${t('common.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${suppliers.map(s => renderEntityRow(s)).join('')}
                                ${suppliers.length === 0 ? `
                                    <tr>
                                        <td colspan="5" class="text-center text-muted">${t('common.no-data')}</td>
                                    </tr>
                                ` : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>

        <!-- Clients Table -->
        <div id="clientsTab" class="tab-content" style="display: none;">
            <div class="card">
                <div class="card-header">
                    <h3>${t('suppliers.client')}</h3>
                    <span class="text-muted">${clients.length} ${t('common.total')}</span>
                </div>
                <div class="card-body no-padding">
                    <div class="entity-table-wrap">
                        <table class="entity-table">
                            <thead>
                                <tr>
                                    <th>${t('form.name')}</th>
                                    <th>${t('form.phone')}</th>
                                    <th>${t('suppliers.cash-balance')}</th>
                                    <th>${t('suppliers.gold-balance')}</th>
                                    <th>${t('common.actions')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${clients.map(c => renderEntityRow(c)).join('')}
                                ${clients.length === 0 ? `
                                    <tr>
                                        <td colspan="5" class="text-center text-muted">${t('common.no-data')}</td>
                                    </tr>
                                ` : ''}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const tab = this.dataset.tab;
            document.getElementById('suppliersTab').style.display = tab === 'suppliers' ? 'block' : 'none';
            document.getElementById('clientsTab').style.display = tab === 'clients' ? 'block' : 'none';
        });
    });

    // Expose globals
    window.showAddEntity = showAddEntity;
    window.exportEntities = exportEntities;
    window.showEntityTransactions = showEntityTransactions;
    window.printStatement = printStatement;
    window.editEntity = editEntity;
    window.deleteEntity = deleteEntityItem;
}

// ============================================
// Render Entity Row
// ============================================
function renderEntityRow(entity) {
    const cashClass = entity.cash_balance >= 0 ? 'balance-positive' : 'balance-negative';
    const goldClass = entity.gold_gram_balance >= 0 ? 'balance-positive' : 'balance-negative';
    const typeClass = entity.type === 'SUPPLIER' ? 'supplier' : 'client';
    const typeLabel = entity.type === 'SUPPLIER' ? t('suppliers.supplier') : t('suppliers.client');
    
    return `
        <tr data-id="${entity.id}">
            <td>
                <span class="entity-name">${sanitizeHTML(entity.name)}</span>
                <span class="entity-type ${typeClass}">${typeLabel}</span>
            </td>
            <td>${sanitizeHTML(entity.phone || '-')}</td>
            <td class="balance-amount ${cashClass}">${formatCurrency(entity.cash_balance)}</td>
            <td class="balance-amount ${goldClass}">${formatNumber(entity.gold_gram_balance, 3)} جم</td>
            <td>
                <div class="entity-actions">
                    <button class="btn btn-primary btn-sm" onclick="window.showEntityTransactions('${entity.id}')">
                        📊 ${t('suppliers.transactions')}
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="window.printStatement('${entity.id}')">
                        🖨️ ${t('suppliers.statement')}
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="window.editEntity('${entity.id}')">
                        ✏️
                    </button>
                    <button class="btn btn-danger btn-sm" onclick="window.deleteEntity('${entity.id}')">
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    `;
}

// ============================================
// Add/Edit Entity
// ============================================
async function showAddEntity(type, data = null) {
    const isEdit = !!data;
    const title = isEdit ? 'تعديل' : 'إضافة';
    const typeLabel = type === 'SUPPLIER' ? t('suppliers.supplier') : t('suppliers.client');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title} ${typeLabel}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <form id="entityForm">
                <input type="hidden" name="id" value="${data?.id || ''}" />
                <input type="hidden" name="type" value="${type}" />
                
                <div class="form-group">
                    <label>${t('form.name')} *</label>
                    <input type="text" name="name" required value="${sanitizeHTML(data?.name || '')}" />
                </div>
                <div class="form-group">
                    <label>${t('form.phone')}</label>
                    <input type="tel" name="phone" value="${sanitizeHTML(data?.phone || '')}" />
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>${t('suppliers.cash-balance')}</label>
                        <input type="number" name="cash_balance" step="0.01" 
                               value="${data?.cash_balance || 0}" />
                        <small class="text-muted">${t('common.positive') || 'موجب = مدين، سالب = دائن'}</small>
                    </div>
                    <div class="form-group">
                        <label>${t('suppliers.gold-balance')}</label>
                        <input type="number" name="gold_gram_balance" step="0.001" 
                               value="${data?.gold_gram_balance || 0}" />
                        <small class="text-muted">${t('common.positive') || 'موجب = مدين، سالب = دائن'}</small>
                    </div>
                </div>
                
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">${t('common.cancel')}</button>
                    <button type="submit" class="btn btn-primary">${isEdit ? t('common.edit') : t('common.add')}</button>
                </div>
            </form>
        </div>
    `;
    
    document.getElementById('modalContainer').appendChild(modal);
    
    modal.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        try {
            const payload = {
                name: data.name,
                type: data.type,
                phone: data.phone || null,
                cash_balance: parseFloat(data.cash_balance) || 0,
                gold_gram_balance: parseFloat(data.gold_gram_balance) || 0,
            };
            
            if (isEdit) {
                await updateData('entities', payload, { id: data.id });
                showToast('✅ ' + t('common.success'), 'success');
            } else {
                await insertData('entities', payload);
                showToast('✅ ' + t('common.success'), 'success');
            }
            
            modal.remove();
            renderSuppliers(document.getElementById('pageContent'));
        } catch (err) {
            showToast(err.message || '❌ ' + t('common.error'), 'error');
        }
    });
}

async function editEntity(id) {
    const entity = entities.find(e => e.id === id);
    if (!entity) {
        showToast(t('common.no-data'), 'error');
        return;
    }
    showAddEntity(entity.type, entity);
}

async function deleteEntityItem(id) {
    if (!confirm(t('modal.confirm-delete'))) return;
    
    try {
        await deleteData('entities', { id });
        showToast('✅ ' + t('common.success'), 'success');
        renderSuppliers(document.getElementById('pageContent'));
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

// ============================================
// Entity Transactions Modal
// ============================================
async function showEntityTransactions(entityId) {
    const entity = entities.find(e => e.id === entityId);
    if (!entity) {
        showToast(t('common.no-data'), 'error');
        return;
    }
    
    currentEntity = entity;
    
    transactions = await fetchData('entity_ledger', '*', { entity_id: entityId }, { column: 'created_at', ascending: false });
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay dual-balance-modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px;">
            <div class="modal-header">
                <h3>📊 ${t('suppliers.transactions')} ${sanitizeHTML(entity.name)}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            
            <!-- Balance Display -->
            <div class="balance-display">
                <div class="balance-item">
                    <div class="balance-label">${t('suppliers.cash-balance')}</div>
                    <div class="balance-value cash ${entity.cash_balance >= 0 ? 'balance-positive' : 'balance-negative'}">
                        ${formatCurrency(entity.cash_balance)}
                    </div>
                </div>
                <div class="balance-item">
                    <div class="balance-label">${t('suppliers.gold-balance')}</div>
                    <div class="balance-value gold ${entity.gold_gram_balance >= 0 ? 'balance-positive' : 'balance-negative'}">
                        ${formatNumber(entity.gold_gram_balance, 3)} جم
                    </div>
                </div>
            </div>
            
            <!-- Transaction Form -->
            <div class="transaction-form">
                <h4 style="margin-bottom: 8px;">${t('common.add')}</h4>
                
                <div class="transaction-type-selector">
                    <button class="btn btn-outline active" data-tx-type="receive_gold" style="flex:1;">
                        📦 ${t('suppliers.receive-gold')}
                    </button>
                    <button class="btn btn-outline" data-tx-type="pay_cash" style="flex:1;">
                        💰 ${t('suppliers.pay-cash')}
                    </button>
                    <button class="btn btn-outline" data-tx-type="return_gold" style="flex:1;">
                        🔄 ${t('suppliers.return-gold')}
                    </button>
                </div>
                
                <form id="transactionForm">
                    <input type="hidden" name="entity_id" value="${entity.id}" />
                    <input type="hidden" name="transaction_type" value="receive_gold" />
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>${t('common.amount')}</label>
                            <input type="number" id="txAmount" name="amount" step="0.001" required placeholder="0.000" />
                        </div>
                        <div class="form-group">
                            <label>${t('form.description')}</label>
                            <input type="text" id="txDescription" name="description" placeholder="${t('form.description')}" />
                        </div>
                    </div>
                    
                    <div class="form-group" id="goldRateGroup">
                        <label>${t('gold.gold-rate')}</label>
                        <input type="number" id="txGoldRate" name="gold_rate" step="0.01" 
                               value="${goldRates['24K'] || 0}" />
                    </div>
                    
                    <div style="background: var(--bg-input); padding: 12px; border-radius: var(--radius-sm); margin: 8px 0;">
                        <div style="display: flex; justify-content: space-between; font-size: 14px;">
                            <span>${t('common.estimated') || 'القيمة المقدرة'}:</span>
                            <span id="estimatedValue" style="font-weight: 700; color: var(--accent-gold);">0.00 EGP</span>
                        </div>
                    </div>
                    
                    <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 8px;">
                        💾 ${t('common.save')}
                    </button>
                </form>
            </div>
            
            <!-- Transaction Log -->
            <div style="margin-top: 16px;">
                <h4 style="margin-bottom: 8px;">${t('suppliers.transactions')}</h4>
                <div class="transaction-log" id="transactionLog">
                    ${transactions.length === 0 ? `
                        <div class="text-muted" style="text-align: center; padding: 20px;">
                            ${t('common.no-data')}
                        </div>
                    ` : `
                        ${transactions.map(tx => renderTransactionItem(tx)).join('')}
                    `}
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="window.printStatement('${entity.id}')">
                    🖨️ ${t('suppliers.statement')}
                </button>
                <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                    ${t('common.close')}
                </button>
            </div>
        </div>
    `;
    
    document.getElementById('modalContainer').appendChild(modal);
    
    // Transaction type selector
    modal.querySelectorAll('.transaction-type-selector .btn').forEach(btn => {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.transaction-type-selector .btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            document.getElementById('transactionForm').querySelector('input[name="transaction_type"]').value = this.dataset.txType;
            
            const type = this.dataset.txType;
            const amountLabel = document.querySelector('#txAmount').closest('.form-group').querySelector('label');
            const goldRateGroup = document.getElementById('goldRateGroup');
            
            if (type === 'receive_gold') {
                amountLabel.textContent = 'وزن الذهب المستلم (جم)';
                goldRateGroup.style.display = 'block';
            } else if (type === 'pay_cash') {
                amountLabel.textContent = 'المبلغ المدفوع (EGP)';
                goldRateGroup.style.display = 'none';
            } else if (type === 'return_gold') {
                amountLabel.textContent = 'وزن الذهب المرتجع (جم)';
                goldRateGroup.style.display = 'block';
            }
        });
    });
    
    // Estimate value
    const amountInput = document.getElementById('txAmount');
    const rateInput = document.getElementById('txGoldRate');
    const estimateDisplay = document.getElementById('estimatedValue');
    
    function updateEstimate() {
        const amount = parseFloat(amountInput.value) || 0;
        const rate = parseFloat(rateInput.value) || 0;
        const type = document.querySelector('input[name="transaction_type"]').value;
        
        if (type === 'pay_cash') {
            estimateDisplay.textContent = formatCurrency(amount);
        } else {
            estimateDisplay.textContent = formatCurrency(amount * rate);
        }
    }
    
    amountInput.addEventListener('input', updateEstimate);
    rateInput.addEventListener('input', updateEstimate);
    
    // Form submission
    modal.querySelector('#transactionForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        await processTransaction(data, modal);
    });
    
    window._currentEntity = entity;
}

function renderTransactionItem(tx) {
    const isCredit = tx.type === 'credit';
    const sign = isCredit ? '+' : '-';
    const color = isCredit ? 'balance-positive' : 'balance-negative';
    const typeLabels = {
        'receive_gold': t('suppliers.receive-gold'),
        'pay_cash': t('suppliers.pay-cash'),
        'return_gold': t('suppliers.return-gold'),
        'adjustment': 'تسوية',
    };
    
    return `
        <div class="log-item">
            <span class="log-date">${new Date(tx.created_at).toLocaleDateString('ar-EG')}</span>
            <span class="log-desc">${typeLabels[tx.transaction_type] || tx.transaction_type} - ${sanitizeHTML(tx.description || '')}</span>
            <span class="log-cash ${tx.cash_amount !== 0 ? color : ''}">
                ${tx.cash_amount !== 0 ? formatCurrency(tx.cash_amount) : '-'}
            </span>
            <span class="log-gold ${tx.gold_amount !== 0 ? color : ''}">
                ${tx.gold_amount !== 0 ? formatNumber(tx.gold_amount, 3) + ' جم' : '-'}
            </span>
        </div>
    `;
}

// ============================================
// Process Transaction
// ============================================
async function processTransaction(data, modal) {
    const entityId = data.entity_id;
    const type = data.transaction_type;
    const amount = parseFloat(data.amount) || 0;
    const description = data.description || '';
    const goldRate = parseFloat(data.gold_rate) || goldRates['24K'] || 0;
    
    if (amount <= 0) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    try {
        let cashAmount = 0;
        let goldAmount = 0;
        let txType = type;
        
        if (type === 'receive_gold') {
            goldAmount = amount;
            cashAmount = amount * goldRate;
        } else if (type === 'pay_cash') {
            cashAmount = -amount;
            goldAmount = 0;
        } else if (type === 'return_gold') {
            goldAmount = -amount;
            cashAmount = -amount * goldRate;
        }
        
        const txData = {
            entity_id: entityId,
            transaction_type: txType,
            cash_amount: cashAmount,
            gold_amount: goldAmount,
            gold_rate: goldRate,
            description: description,
            type: cashAmount >= 0 || goldAmount >= 0 ? 'credit' : 'debit',
        };
        
        const result = await insertData('entity_ledger', txData);
        
        if (result) {
            const entity = entities.find(e => e.id === entityId);
            if (entity) {
                const newCash = entity.cash_balance + cashAmount;
                const newGold = entity.gold_gram_balance + goldAmount;
                
                await updateData('entities', {
                    cash_balance: newCash,
                    gold_gram_balance: newGold,
                }, { id: entityId });
                
                entity.cash_balance = newCash;
                entity.gold_gram_balance = newGold;
            }
            
            showToast('✅ ' + t('common.success'), 'success');
            
            if (modal) {
                modal.remove();
                showEntityTransactions(entityId);
            }
            
            renderSuppliers(document.getElementById('pageContent'));
        }
    } catch (err) {
        console.error('Transaction error:', err);
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

// ============================================
// Print Statement
// ============================================
async function printStatement(entityId) {
    const entity = entities.find(e => e.id === entityId);
    if (!entity) {
        showToast(t('common.no-data'), 'error');
        return;
    }
    
    const txs = await fetchData('entity_ledger', '*', { entity_id: entityId }, { column: 'created_at', ascending: true });
    
    const container = document.getElementById('printContainer');
    container.style.display = 'block';
    
    const now = new Date();
    const dateStr = now.toLocaleDateString('ar-EG');
    const typeLabel = entity.type === 'SUPPLIER' ? t('suppliers.supplier') : t('suppliers.client');
    
    let runningCash = 0;
    let runningGold = 0;
    const runningRows = txs.map(tx => {
        runningCash += tx.cash_amount;
        runningGold += tx.gold_amount;
        return `
            <tr>
                <td>${new Date(tx.created_at).toLocaleDateString('ar-EG')}</td>
                <td class="text-right">${sanitizeHTML(tx.description || tx.transaction_type)}</td>
                <td>${tx.cash_amount !== 0 ? formatCurrency(tx.cash_amount) : '-'}</td>
                <td>${tx.gold_amount !== 0 ? formatNumber(tx.gold_amount, 3) + ' جم' : '-'}</td>
                <td>${formatCurrency(runningCash)}</td>
                <td>${formatNumber(runningGold, 3)} جم</td>
            </tr>
        `;
    }).join('');
    
    container.innerHTML = `
        <div class="statement-print">
            <div class="statement-header">
                <h1>💎 ${t('suppliers.statement')}</h1>
                <div class="entity-info">
                    <strong>${sanitizeHTML(entity.name)}</strong>
                    ${entity.phone ? `| ${t('form.phone')}: ${sanitizeHTML(entity.phone)}` : ''}
                </div>
                <div class="entity-info" style="font-size: 9pt;">
                    ${typeLabel} 
                    | ${t('suppliers.cash-balance')}: ${formatCurrency(entity.cash_balance)} 
                    | ${t('suppliers.gold-balance')}: ${formatNumber(entity.gold_gram_balance, 3)} جم
                </div>
            </div>
            
            <div class="statement-period">
                ${t('suppliers.statement')} ${dateStr}
            </div>
            
            <div class="statement-summary">
                <div class="summary-item">
                    <span>${t('common.total')}</span>
                    <span>${formatCurrency(txs.reduce((sum, tx) => sum + tx.cash_amount, 0))}</span>
                </div>
                <div class="summary-item">
                    <span>${t('gold.weight-grams')}</span>
                    <span>${formatNumber(txs.reduce((sum, tx) => sum + tx.gold_amount, 0), 3)} جم</span>
                </div>
                <div class="summary-item">
                    <span>${t('common.total')}</span>
                    <span>${txs.length}</span>
                </div>
            </div>
            
            <table class="statement-table">
                <thead>
                    <tr>
                        <th>${t('common.date')}</th>
                        <th class="text-right">${t('form.description')}</th>
                        <th>${t('suppliers.cash-balance')}</th>
                        <th>${t('suppliers.gold-balance')}</th>
                        <th>${t('common.total')}</th>
                        <th>${t('gold.weight-grams')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${runningRows || `
                        <tr>
                            <td colspan="6" style="text-align: center;">${t('common.no-data')}</td>
                        </tr>
                    `}
                </tbody>
            </table>
            
            <div class="balance-summary">
                <div>
                    <div>${t('suppliers.cash-balance')}</div>
                    <div style="color: ${entity.cash_balance >= 0 ? '#22c55e' : '#ef4444'};">
                        ${formatCurrency(entity.cash_balance)}
                    </div>
                </div>
                <div>
                    <div>${t('suppliers.gold-balance')}</div>
                    <div style="color: ${entity.gold_gram_balance >= 0 ? '#22c55e' : '#ef4444'};">
                        ${formatNumber(entity.gold_gram_balance, 3)} جم
                    </div>
                </div>
                <div>
                    <div>${t('common.total')}</div>
                    <div style="color: var(--accent-gold);">
                        ${formatCurrency(entity.cash_balance + (entity.gold_gram_balance * (goldRates['24K'] || 0)))}
                    </div>
                </div>
            </div>
            
            <div class="statement-footer">
                <div>${t('common.auto')}</div>
                <div style="font-size: 7pt; margin-top: 2px;">
                    ${new Date().toLocaleString('ar-EG')} | ${entity.id}
                </div>
            </div>
        </div>
    `;
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            container.style.display = 'none';
            container.innerHTML = '';
        }, 1000);
    }, 300);
}

// ============================================
// Export Entities
// ============================================
function exportEntities() {
    const data = entities.map(e => ({
        'الاسم': e.name,
        'النوع': e.type === 'SUPPLIER' ? 'مورد' : 'عميل',
        'الهاتف': e.phone || '',
        'الرصيد النقدي (EGP)': e.cash_balance,
        'رصيد الذهب (جم)': e.gold_gram_balance,
    }));
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'الموردين والعملاء');
    XLSX.writeFile(wb, 'entities_export.xlsx');
    showToast('✅ ' + t('common.success'), 'success');
}

// ============================================
// Expose Globals
// ============================================
window.renderSuppliers = renderSuppliers;
window.showAddEntity = showAddEntity;
window.showEntityTransactions = showEntityTransactions;
window.printStatement = printStatement;
window.editEntity = editEntity;
window.deleteEntity = deleteEntityItem;
window.exportEntities = exportEntities;