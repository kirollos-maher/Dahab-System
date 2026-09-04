import { fetchData, insertData, updateData, supabase, deleteData } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, debounce,
    getActiveBranchId, generateInvoiceNumber
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t } from '../i18n/i18n.js';
import { sanitizeHTML } from './security.js';

// ============================================
// State
// ============================================
let returnsState = {
    activeTab: 'sales-return',
    scannedItems: [],
    buybackItems: [],
    supplierReturns: [],
};

// ============================================
// Main Render Function
// ============================================
export async function renderReturns(container) {
    container.innerHTML = `
        <div class="page-header">
            <h2>↩️ ${t('returns.title')}</h2>
            <div class="page-actions">
                <span class="text-muted" id="returnsStatus">${t('common.ready')}</span>
            </div>
        </div>

        <!-- Navigation -->
        <nav class="returns-nav" id="returnsNav">
            <button class="returns-btn active" data-panel="sales-return">
                🔄 ${t('returns.sales-return')}
            </button>
            <button class="returns-btn" data-panel="buyback">
                💰 ${t('returns.buyback')}
            </button>
            <button class="returns-btn" data-panel="supplier-return">
                📦 ${t('returns.supplier-return')}
            </button>
        </nav>

        <!-- Panel 1: Sales Return -->
        <div id="sales-return-panel" class="returns-panel active">
            ${renderSalesReturnPanel()}
        </div>

        <!-- Panel 2: Buyback -->
        <div id="buyback-panel" class="returns-panel">
            ${renderBuybackPanel()}
        </div>

        <!-- Panel 3: Supplier Return -->
        <div id="supplier-return-panel" class="returns-panel">
            ${renderSupplierReturnPanel()}
        </div>
    `;

    document.querySelectorAll('.returns-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.returns-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const panel = this.dataset.panel;
            document.querySelectorAll('.returns-panel').forEach(p => p.classList.remove('active'));
            document.getElementById(`${panel}-panel`).classList.add('active');
            returnsState.activeTab = panel;
        });
    });

    setupSalesReturnHandlers();
    setupBuybackHandlers();
    setupSupplierReturnHandlers();

    // Expose functions globally with correct names
    window.scanSalesReturn = scanSalesReturn;
    window.processSalesReturn = processSalesReturn;
    window.calculateBuyback = calculateBuyback;
    window.processBuyback = processBuyback;
    window.addBuybackToPOS = addBuybackToPOS;
    window.scanSupplierReturn = scanSupplierReturn;
    window.processSupplierReturn = processSupplierReturn;
    window.removeSalesReturnItem = removeSalesReturnItem;
    window.clearSalesReturn = clearSalesReturn;
    window.removeSupplierReturnItem = removeSupplierReturnItem;
    window.clearSupplierReturn = clearSupplierReturn;
}

// ============================================
// Panel 1: Sales Return
// ============================================
function renderSalesReturnPanel() {
    return `
        <div class="card">
            <div class="card-header">
                <h3>🔄 ${t('returns.sales-return')}</h3>
                <span class="text-muted">${t('pos.scan-sku')}</span>
            </div>
            <div class="card-body">
                <div class="return-scanner">
                    <input type="text" id="salesReturnInput" placeholder="${t('pos.scan-sku')}" />
                    <button class="btn btn-primary" onclick="window.scanSalesReturn()">
                        🔍 ${t('common.search')}
                    </button>
                    <button class="btn btn-outline" onclick="document.getElementById('salesReturnInput').value = '';">
                        🗑️ ${t('common.clear')}
                    </button>
                </div>
                
                <div id="salesReturnItems">
                    <div class="text-center text-muted" style="padding: 20px;">
                        📭 ${t('pos.scan-sku')}
                    </div>
                </div>
                
                <div style="margin-top: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <span style="font-weight: 600;">${t('common.total')}: </span>
                        <span id="salesReturnTotal" style="font-size: 18px; font-weight: 700; color: var(--danger);">0.00 EGP</span>
                    </div>
                    <div>
                        <button class="btn btn-danger" id="processSalesReturnBtn" disabled>
                            ✅ ${t('returns.process-return')}
                        </button>
                        <button class="btn btn-outline" onclick="window.clearSalesReturn()">
                            🗑️ ${t('common.clear')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupSalesReturnHandlers() {
    const input = document.getElementById('salesReturnInput');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                scanSalesReturn();
            }
        });
    }
}

async function scanSalesReturn() {
    const input = document.getElementById('salesReturnInput');
    if (!input) return;
    
    const sku = input.value.trim();
    if (!sku) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    input.value = '';
    input.focus();
    
    try {
        const branchId = getActiveBranchId();
        let query = supabase
            .from('inventory')
            .select('*, manufacturer_id(name, code)')
            .eq('sku', sku)
            .eq('status', 'SOLD');
        
        if (branchId) {
            query = query.eq('branch_id', branchId);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            showToast(`❌ ${sku} ${t('common.no-data')}`, 'error');
            return;
        }
        
        const item = data[0];
        
        if (returnsState.scannedItems.find(i => i.id === item.id)) {
            showToast(`⚠️ ${sku} ${t('common.exists') || 'موجود'}`, 'warning');
            return;
        }
        
        const pureWeight = item.pure_gold_weight || 
            (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
        const price = pureWeight * (goldRates['24K'] || 0) + (item.weight_grams * item.workmanship_per_gram);
        
        returnsState.scannedItems.push({
            ...item,
            returnPrice: price,
            pureWeight: pureWeight,
        });
        
        renderSalesReturnItems();
        showToast(`✅ ${sku} ${t('common.add')}`, 'success');
        
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    }
}

function renderSalesReturnItems() {
    const container = document.getElementById('salesReturnItems');
    if (!container) return;
    
    if (returnsState.scannedItems.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted" style="padding: 20px;">
                📭 ${t('pos.scan-sku')}
            </div>
        `;
        document.getElementById('processSalesReturnBtn').disabled = true;
        document.getElementById('salesReturnTotal').textContent = '0.00 EGP';
        return;
    }
    
    let total = 0;
    
    container.innerHTML = returnsState.scannedItems.map(item => {
        total += item.returnPrice;
        return `
            <div class="return-item">
                <div class="item-info">
                    <div class="sku">${item.sku}</div>
                    <div class="details">
                        ${item.carat} | ${item.letter_code} | 
                        ${formatNumber(item.weight_grams, 3)} جم | 
                        ${item.manufacturer_id?.name || t('common.no-data')}
                    </div>
                </div>
                <div class="item-actions">
                    <span style="font-weight: 600; color: var(--danger);">
                        ${formatCurrency(item.returnPrice)}
                    </span>
                    <button class="btn btn-danger btn-sm" onclick="window.removeSalesReturnItem('${item.id}')">
                        ✕
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('salesReturnTotal').textContent = formatCurrency(total);
    document.getElementById('processSalesReturnBtn').disabled = false;
}

function removeSalesReturnItem(id) {
    returnsState.scannedItems = returnsState.scannedItems.filter(i => i.id !== id);
    renderSalesReturnItems();
    if (returnsState.scannedItems.length === 0) {
        document.getElementById('processSalesReturnBtn').disabled = true;
    }
    showToast('🗑️ ' + t('common.delete'), 'info');
}

function clearSalesReturn() {
    if (returnsState.scannedItems.length === 0) return;
    if (!confirm(t('modal.confirm-delete'))) return;
    returnsState.scannedItems = [];
    renderSalesReturnItems();
    document.getElementById('processSalesReturnBtn').disabled = true;
    showToast('🗑️ ' + t('common.clear'), 'info');
}

async function processSalesReturn() {
    if (returnsState.scannedItems.length === 0) {
        showToast(t('common.no-data'), 'warning');
        return;
    }
    
    if (!confirm(`${t('returns.process-return')} ${returnsState.scannedItems.length}?`)) return;
    
    const btn = document.getElementById('processSalesReturnBtn');
    btn.disabled = true;
    btn.textContent = '⏳ ' + t('common.loading');
    
    try {
        const branchId = getActiveBranchId();
        let returned = 0;
        let failed = 0;
        
        for (const item of returnsState.scannedItems) {
            try {
                const { error: updateError } = await supabase
                    .from('inventory')
                    .update({ 
                        status: 'IN_STOCK',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', item.id);
                
                if (updateError) throw updateError;
                
                await supabase
                    .from('sales_returns')
                    .insert({
                        inventory_id: item.id,
                        sku: item.sku,
                        return_price: item.returnPrice,
                        branch_id: branchId,
                        reason: 'Customer return',
                        returned_by: 'system',
                    });
                
                returned++;
            } catch (err) {
                failed++;
                console.error('Return error for', item.sku, err);
            }
        }
        
        returnsState.scannedItems = [];
        renderSalesReturnItems();
        document.getElementById('processSalesReturnBtn').disabled = true;
        
        showToast(`✅ ${t('returns.process-return')} ${returned}${failed > 0 ? `, ${t('common.error')} ${failed}` : ''}`, 'success');
        
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ ' + t('returns.process-return');
    }
}

// ============================================
// Panel 2: Gold Buyback / Trade-In
// ============================================
function renderBuybackPanel() {
    return `
        <div class="card">
            <div class="card-header">
                <h3>💰 ${t('returns.buyback')}</h3>
                <span class="text-muted">${t('gold.gold-rate')}: ${formatCurrency(goldRates['24K'] || 0)}/${t('unit.gram')}</span>
            </div>
            <div class="card-body">
                <form class="buyback-form" id="buybackForm">
                    <div class="form-row">
                        <div class="form-group">
                            <label>${t('gold.carat')} *</label>
                            <select id="buybackCarat" required>
                                <option value="">${t('common.select')}</option>
                                ${Object.keys(CARATS).map(c => `
                                    <option value="${c}" data-ratio="${CARATS[c].ratio}">
                                        ${c} (${(CARATS[c].ratio * 100).toFixed(1)}%)
                                    </option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>${t('gold.weight-grams')} *</label>
                            <input type="number" id="buybackWeight" step="0.001" min="0.001" required placeholder="0.000" />
                        </div>
                        <div class="form-group">
                            <label>${t('gold.purity')}</label>
                            <input type="number" id="buybackPurity" step="0.1" min="0" max="100" placeholder="100" />
                            <small class="text-muted">${t('common.default') || 'افتراضي 100%'}</small>
                        </div>
                    </div>
                    
                    <div class="calc-result" id="buybackResult">
                        <div class="result-item">
                            <div class="result-value" id="buybackPureWeight">0.000 جم</div>
                            <div class="result-label">${t('gold.pure-weight')}</div>
                        </div>
                        <div class="result-item">
                            <div class="result-value" id="buybackGoldValue">0.00 EGP</div>
                            <div class="result-label">${t('gold.gold-value')}</div>
                        </div>
                        <div class="result-item">
                            <div class="result-value" id="buybackTotal">0.00 EGP</div>
                            <div class="result-label">${t('common.total')}</div>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap;">
                        <button type="submit" class="btn btn-success">
                            💰 ${t('returns.buyback')}
                        </button>
                        <button type="button" class="btn btn-outline" onclick="window.addBuybackToPOS()">
                            🛒 ${t('pos.cart')}
                        </button>
                        <button type="reset" class="btn btn-outline">
                            🗑️ ${t('common.clear')}
                        </button>
                    </div>
                </form>
                
                <div style="margin-top: 16px;">
                    <h4 style="margin-bottom: 8px;">${t('common.total')}</h4>
                    <div id="buybackHistory">
                        <div class="text-center text-muted" style="padding: 12px;">
                            ${t('common.no-data')}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupBuybackHandlers() {
    const form = document.getElementById('buybackForm');
    if (!form) return;
    
    const carat = document.getElementById('buybackCarat');
    const weight = document.getElementById('buybackWeight');
    const purity = document.getElementById('buybackPurity');
    
    const calculate = debounce(calculateBuyback, 200);
    
    carat.addEventListener('change', calculate);
    weight.addEventListener('input', calculate);
    purity.addEventListener('input', calculate);
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await processBuyback();
    });
}

function calculateBuyback() {
    const carat = document.getElementById('buybackCarat')?.value;
    const weight = parseFloat(document.getElementById('buybackWeight')?.value) || 0;
    const purity = parseFloat(document.getElementById('buybackPurity')?.value) || 100;
    
    const goldRate = goldRates['24K'] || 0;
    const ratio = CARATS[carat]?.ratio || 0;
    
    const pureWeight = weight * (ratio) * (purity / 100);
    const goldValue = pureWeight * goldRate;
    
    const buybackDiscount = 0.92;
    const totalPrice = goldValue * buybackDiscount;
    
    document.getElementById('buybackPureWeight').textContent = formatNumber(pureWeight, 3) + ' جم';
    document.getElementById('buybackGoldValue').textContent = formatCurrency(goldValue);
    document.getElementById('buybackTotal').textContent = formatCurrency(totalPrice);
    
    return { pureWeight, goldValue, totalPrice, weight, carat, purity };
}

async function processBuyback() {
    const carat = document.getElementById('buybackCarat')?.value;
    const weight = parseFloat(document.getElementById('buybackWeight')?.value) || 0;
    const purity = parseFloat(document.getElementById('buybackPurity')?.value) || 100;
    
    if (!carat || weight <= 0) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    const result = calculateBuyback();
    if (!result || result.totalPrice <= 0) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    if (!confirm(`${t('returns.buyback')} ${formatNumber(weight, 3)} ${carat} ${formatCurrency(result.totalPrice)}?`)) {
        return;
    }
    
    try {
        const branchId = getActiveBranchId();
        
        const buybackData = {
            branch_id: branchId,
            carat: carat,
            weight_grams: weight,
            purity_percent: purity,
            pure_weight: result.pureWeight,
            gold_rate: goldRates['24K'] || 0,
            total_price: result.totalPrice,
            status: 'PENDING',
            created_at: new Date().toISOString(),
        };
        
        const { data, error } = await supabase
            .from('buyback_transactions')
            .insert(buybackData)
            .select();
        
        if (error) throw error;
        
        showToast(`✅ ${t('returns.buyback')} ${formatCurrency(result.totalPrice)}`, 'success');
        
        loadBuybackHistory();
        
        if (confirm(`${t('pos.cart')}?`)) {
            addBuybackToPOS(result);
        }
        
        document.getElementById('buybackForm').reset();
        document.getElementById('buybackPureWeight').textContent = '0.000 جم';
        document.getElementById('buybackGoldValue').textContent = '0.00 EGP';
        document.getElementById('buybackTotal').textContent = '0.00 EGP';
        
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    }
}

function addBuybackToPOS(result) {
    if (!result) {
        result = calculateBuyback();
        if (!result || result.totalPrice <= 0) {
            showToast(t('common.required'), 'warning');
            return;
        }
    }
    
    const buybackCredit = {
        amount: result.totalPrice,
        pureWeight: result.pureWeight,
        carat: result.carat,
        weight: result.weight,
        timestamp: new Date().toISOString(),
    };
    
    localStorage.setItem('buybackCredit', JSON.stringify(buybackCredit));
    
    showToast(`✅ ${formatCurrency(result.totalPrice)}`, 'success');
    window.location.hash = 'pos-scanner';
}

async function loadBuybackHistory() {
    const container = document.getElementById('buybackHistory');
    if (!container) return;
    
    try {
        const branchId = getActiveBranchId();
        let query = supabase
            .from('buyback_transactions')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
        
        if (branchId) {
            query = query.eq('branch_id', branchId);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="text-center text-muted" style="padding: 12px;">
                    ${t('common.no-data')}
                </div>
            `;
            return;
        }
        
        container.innerHTML = data.map(item => `
            <div class="return-item">
                <div class="item-info">
                    <div class="sku">${item.carat} | ${formatNumber(item.weight_grams, 3)} جم</div>
                    <div class="details">
                        ${t('gold.purity')}: ${item.purity_percent}% | ${t('gold.pure-weight')}: ${formatNumber(item.pure_weight, 3)} جم
                        <span style="margin-right: 8px; color: var(--text-muted);">
                            ${new Date(item.created_at).toLocaleString('ar-EG')}
                        </span>
                    </div>
                </div>
                <div style="font-weight: 600; color: var(--accent-gold);">
                    ${formatCurrency(item.total_price)}
                </div>
            </div>
        `).join('');
        
    } catch (err) {
        console.error('Load buyback history error:', err);
    }
}

// ============================================
// Panel 3: Supplier Return
// ============================================
function renderSupplierReturnPanel() {
    return `
        <div class="card">
            <div class="card-header">
                <h3>📦 ${t('returns.supplier-return')}</h3>
                <span class="text-muted">${t('pos.scan-sku')}</span>
            </div>
            <div class="card-body">
                <div class="return-scanner">
                    <input type="text" id="supplierReturnInput" placeholder="${t('pos.scan-sku')}" />
                    <button class="btn btn-primary" onclick="window.scanSupplierReturn()">
                        🔍 ${t('common.search')}
                    </button>
                    <select id="supplierReturnFilter" style="padding: 8px; border: 2px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-input); color: var(--text-primary);">
                        <option value="">${t('common.all')}</option>
                    </select>
                </div>
                
                <div id="supplierReturnItems">
                    <div class="text-center text-muted" style="padding: 20px;">
                        📭 ${t('pos.scan-sku')}
                    </div>
                </div>
                
                <div style="margin-top: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div>
                        <span style="font-weight: 600;">${t('gold.pure-weight')}: </span>
                        <span id="supplierReturnWeight" style="font-size: 18px; font-weight: 700; color: var(--danger);">0.000 جم</span>
                    </div>
                    <div>
                        <button class="btn btn-danger" id="processSupplierReturnBtn" disabled>
                            ✅ ${t('returns.process-return')}
                        </button>
                        <button class="btn btn-outline" onclick="window.clearSupplierReturn()">
                            🗑️ ${t('common.clear')}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function setupSupplierReturnHandlers() {
    const input = document.getElementById('supplierReturnInput');
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                scanSupplierReturn();
            }
        });
    }
    
    loadSupplierFilter();
}

async function loadSupplierFilter() {
    try {
        const { data, error } = await supabase
            .from('entities')
            .select('id, name')
            .eq('type', 'SUPPLIER');
        
        if (error) throw error;
        
        const filter = document.getElementById('supplierReturnFilter');
        if (filter && data) {
            filter.innerHTML = `
                <option value="">${t('common.all')}</option>
                ${data.map(s => `<option value="${s.id}">${sanitizeHTML(s.name)}</option>`).join('')}
            `;
        }
    } catch (err) {
        console.error('Load suppliers error:', err);
    }
}

async function scanSupplierReturn() {
    const input = document.getElementById('supplierReturnInput');
    if (!input) return;
    
    const sku = input.value.trim();
    if (!sku) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    input.value = '';
    input.focus();
    
    try {
        const branchId = getActiveBranchId();
        let query = supabase
            .from('inventory')
            .select('*, manufacturer_id(name, code)')
            .eq('sku', sku)
            .eq('status', 'IN_STOCK');
        
        if (branchId) {
            query = query.eq('branch_id', branchId);
        }
        
        const { data, error } = await query;
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            showToast(`❌ ${sku} ${t('common.no-data')}`, 'error');
            return;
        }
        
        const item = data[0];
        
        if (returnsState.supplierReturns.find(i => i.id === item.id)) {
            showToast(`⚠️ ${sku} ${t('common.exists') || 'موجود'}`, 'warning');
            return;
        }
        
        if (!item.manufacturer_id) {
            showToast(`⚠️ ${sku} ${t('common.no-data')}`, 'warning');
            return;
        }
        
        const pureWeight = item.pure_gold_weight || 
            (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
        
        returnsState.supplierReturns.push({
            ...item,
            pureWeight: pureWeight,
        });
        
        renderSupplierReturnItems();
        showToast(`✅ ${sku} ${t('common.add')}`, 'success');
        
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    }
}

function renderSupplierReturnItems() {
    const container = document.getElementById('supplierReturnItems');
    if (!container) return;
    
    if (returnsState.supplierReturns.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted" style="padding: 20px;">
                📭 ${t('pos.scan-sku')}
            </div>
        `;
        document.getElementById('processSupplierReturnBtn').disabled = true;
        document.getElementById('supplierReturnWeight').textContent = '0.000 جم';
        return;
    }
    
    let totalWeight = 0;
    
    container.innerHTML = returnsState.supplierReturns.map(item => {
        totalWeight += item.pureWeight;
        return `
            <div class="return-item">
                <div class="item-info">
                    <div class="sku">${item.sku}</div>
                    <div class="details">
                        ${item.carat} | ${item.letter_code} | 
                        ${formatNumber(item.weight_grams, 3)} جم | 
                        ${item.manufacturer_id?.name || t('common.no-data')}
                        <span style="margin-right: 8px; color: var(--text-muted);">
                            ${t('gold.pure-weight')}: ${formatNumber(item.pureWeight, 3)} جم
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-danger btn-sm" onclick="window.removeSupplierReturnItem('${item.id}')">
                        ✕
                    </button>
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('supplierReturnWeight').textContent = formatNumber(totalWeight, 3) + ' جم';
    document.getElementById('processSupplierReturnBtn').disabled = false;
}

function removeSupplierReturnItem(id) {
    returnsState.supplierReturns = returnsState.supplierReturns.filter(i => i.id !== id);
    renderSupplierReturnItems();
    if (returnsState.supplierReturns.length === 0) {
        document.getElementById('processSupplierReturnBtn').disabled = true;
    }
    showToast('🗑️ ' + t('common.delete'), 'info');
}

function clearSupplierReturn() {
    if (returnsState.supplierReturns.length === 0) return;
    if (!confirm(t('modal.confirm-delete'))) return;
    returnsState.supplierReturns = [];
    renderSupplierReturnItems();
    document.getElementById('processSupplierReturnBtn').disabled = true;
    showToast('🗑️ ' + t('common.clear'), 'info');
}

async function processSupplierReturn() {
    if (returnsState.supplierReturns.length === 0) {
        showToast(t('common.no-data'), 'warning');
        return;
    }
    
    if (!confirm(`${t('returns.process-return')} ${returnsState.supplierReturns.length}?`)) return;
    
    const btn = document.getElementById('processSupplierReturnBtn');
    btn.disabled = true;
    btn.textContent = '⏳ ' + t('common.loading');
    
    try {
        const branchId = getActiveBranchId();
        let returned = 0;
        let failed = 0;
        
        for (const item of returnsState.supplierReturns) {
            try {
                const { data: supplier, error: supError } = await supabase
                    .from('entities')
                    .select('gold_gram_balance')
                    .eq('id', item.manufacturer_id)
                    .single();
                
                if (supError) throw supError;
                
                const { error: updateError } = await supabase
                    .from('inventory')
                    .update({ 
                        status: 'RETURNED_TO_SUPPLIER',
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', item.id);
                
                if (updateError) throw updateError;
                
                const newBalance = (supplier?.gold_gram_balance || 0) - item.pureWeight;
                
                await supabase
                    .from('entities')
                    .update({ gold_gram_balance: newBalance })
                    .eq('id', item.manufacturer_id);
                
                await supabase
                    .from('entity_ledger')
                    .insert({
                        entity_id: item.manufacturer_id,
                        transaction_type: 'return_gold',
                        gold_amount: -item.pureWeight,
                        description: `Return of ${item.sku}`,
                        type: 'debit',
                    });
                
                returned++;
            } catch (err) {
                failed++;
                console.error('Supplier return error for', item.sku, err);
            }
        }
        
        returnsState.supplierReturns = [];
        renderSupplierReturnItems();
        document.getElementById('processSupplierReturnBtn').disabled = true;
        
        showToast(`✅ ${t('returns.process-return')} ${returned}${failed > 0 ? `, ${t('common.error')} ${failed}` : ''}`, 'success');
        
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '✅ ' + t('returns.process-return');
    }
}

// ============================================
// Load buyback history on panel switch
// ============================================
document.addEventListener('click', (e) => {
    if (e.target.closest('.returns-btn') && e.target.closest('.returns-btn').dataset.panel === 'buyback') {
        setTimeout(loadBuybackHistory, 300);
    }
});

// ============================================
// Expose Globals (already done in renderReturns)
// ============================================
// All functions are already exposed in renderReturns with correct names