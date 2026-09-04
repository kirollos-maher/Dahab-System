import { fetchData, insertData, updateData, supabase } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, generateInvoiceNumber,
    debounce, getActiveBranchId
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t } from '../i18n/i18n.js';

// ============================================
// POS State
// ============================================
const POS_STATE = {
    cart: [],
    totalWeight: 0,
    totalWorkmanship: 0,
    totalGoldValue: 0,
    totalPrice: 0,
    isProcessing: false,
    scannerBuffer: '',
    scannerTimeout: null,
    scanCount: 0,
};

// Scanner configuration
const SCANNER_CONFIG = {
    bufferTimeout: 100,
    minLength: 4,
    maxLength: 30,
    terminator: 'Enter',
};

// ============================================
// Audio Engine (Web Audio API Beep)
// ============================================
let audioContext = null;

function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

function playBeep(frequency = 800, duration = 80, type = 'sine') {
    try {
        const ctx = initAudio();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        
        oscillator.type = type;
        oscillator.frequency.value = frequency;
        
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
        
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + duration / 1000);
        
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
    } catch (err) {
        console.warn('Audio beep failed:', err);
    }
}

function playSuccessBeep() {
    playBeep(880, 80, 'sine');
    setTimeout(() => playBeep(1100, 60, 'sine'), 100);
}

function playErrorBeep() {
    playBeep(400, 200, 'sawtooth');
}

function playScanBeep() {
    playBeep(660, 50, 'sine');
}

// ============================================
// Scanner Engine
// ============================================
let scannerListeners = [];

export function initScanner(callback) {
    document.addEventListener('keydown', handleScannerKeydown);
    scannerListeners.push(callback);
    focusScannerInput();
    console.log('🔍 Scanner engine initialized');
    return true;
}

export function destroyScanner() {
    document.removeEventListener('keydown', handleScannerKeydown);
    scannerListeners = [];
    POS_STATE.scannerBuffer = '';
    clearTimeout(POS_STATE.scannerTimeout);
    console.log('🔍 Scanner engine destroyed');
}

function handleScannerKeydown(e) {
    const activeElement = document.activeElement;
    if (activeElement && activeElement.tagName === 'INPUT' && 
        activeElement.closest('.scanner-input') === null) {
        return;
    }
    
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
    }
    
    if (e.key === 'Enter') {
        e.preventDefault();
        processScannerBuffer();
        return;
    }
    
    if (e.key === 'Escape') {
        POS_STATE.scannerBuffer = '';
        clearTimeout(POS_STATE.scannerTimeout);
        updateScannerInput('');
        return;
    }
    
    const char = e.key;
    if (/^[a-zA-Z0-9\-]$/.test(char)) {
        e.preventDefault();
        POS_STATE.scannerBuffer += char;
        updateScannerInput(POS_STATE.scannerBuffer);
        
        clearTimeout(POS_STATE.scannerTimeout);
        POS_STATE.scannerTimeout = setTimeout(() => {
            POS_STATE.scannerBuffer = '';
            updateScannerInput('');
        }, SCANNER_CONFIG.bufferTimeout * 2);
    }
}

function processScannerBuffer() {
    const sku = POS_STATE.scannerBuffer.trim();
    POS_STATE.scannerBuffer = '';
    updateScannerInput('');
    clearTimeout(POS_STATE.scannerTimeout);
    
    if (sku.length < SCANNER_CONFIG.minLength) {
        return;
    }
    
    const event = new CustomEvent('barcodeScan', {
        detail: { sku: sku }
    });
    document.dispatchEvent(event);
    
    scannerListeners.forEach(cb => {
        try {
            cb(sku);
        } catch (err) {
            console.error('Scanner callback error:', err);
        }
    });
}

function updateScannerInput(value) {
    const input = document.getElementById('scannerInput');
    if (input) {
        input.value = value;
    }
}

function focusScannerInput() {
    const input = document.getElementById('scannerInput');
    if (input && window.innerWidth > 768) {
        input.focus();
    }
}

// ============================================
// POS Render Functions
// ============================================
export async function renderPOS(container) {
    container.innerHTML = `
        <div class="page-header">
            <h2>📱 ${t('pos.title')}</h2>
            <div class="page-actions">
                <span class="text-muted" id="posScanCount">0 ${t('common.total')}</span>
                <button class="btn btn-outline btn-sm" onclick="window.clearCart()">
                    🗑️ ${t('pos.clear-cart')}
                </button>
            </div>
        </div>

        <div class="pos-container">
            <!-- Left: Scanner & Cart -->
            <div class="pos-scanner-area">
                <!-- Scanner Status Bar -->
                <div class="scanner-status">
                    <div class="status-indicator">
                        <span class="status-dot" id="scannerStatusDot"></span>
                        <span id="scannerStatusText">${t('common.ready')}</span>
                    </div>
                    <input type="text" class="scanner-input" id="scannerInput" 
                           placeholder="${t('pos.scan-sku')}" 
                           autofocus />
                    <button class="btn btn-primary btn-sm" onclick="window.manualScan()">
                        🔍 ${t('common.search')}
                    </button>
                    <div class="scanner-count">
                        <strong id="cartItemCount">0</strong> ${t('common.total')}
                    </div>
                </div>

                <!-- Cart Table -->
                <div class="pos-cart-container">
                    <div class="pos-cart-header">
                        <h3>🛒 ${t('pos.cart')}</h3>
                        <div class="cart-actions">
                            <button class="btn btn-outline btn-sm" onclick="window.clearCart()">
                                🗑️ ${t('common.clear')}
                            </button>
                        </div>
                    </div>
                    <div class="pos-cart-table-wrap">
                        <table class="pos-cart-table">
                            <thead>
                                <tr>
                                    <th>${t('gold.sku')}</th>
                                    <th>${t('gold.carat')}</th>
                                    <th>${t('gold.weight-grams')}</th>
                                    <th>${t('gold.workmanship')}</th>
                                    <th>${t('common.total')}</th>
                                    <th style="width: 40px;"></th>
                                </tr>
                            </thead>
                            <tbody id="posCartBody">
                                <tr>
                                    <td colspan="6" style="text-align: center; padding: 40px 0;">
                                        <div class="pos-cart-empty">
                                            <div class="empty-icon">📷</div>
                                            <p>${t('common.scan') || 'امسح QR'}</p>
                                            <p style="font-size: 12px; color: var(--text-muted);">
                                                ${t('pos.scan-sku')}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Right: Checkout Summary -->
            <div class="pos-checkout" id="posCheckout">
                <div class="pos-checkout-title">
                    <span>💰 ${t('pos.checkout')}</span>
                    <span class="item-count" id="checkoutItemCount">0 ${t('common.total')}</span>
                </div>
                
                <div class="checkout-row">
                    <span class="label">${t('gold.weight-grams')}</span>
                    <span class="value" id="checkoutTotalWeight">0.000 جم</span>
                </div>
                <div class="checkout-row">
                    <span class="label">${t('gold.gold-value') || 'قيمة الذهب'}</span>
                    <span class="value gold" id="checkoutGoldValue">0.00 EGP</span>
                </div>
                <div class="checkout-row">
                    <span class="label">${t('gold.workmanship')}</span>
                    <span class="value" id="checkoutWorkmanship">0.00 EGP</span>
                </div>
                
                <div class="checkout-total">
                    <span class="label">${t('common.total')}</span>
                    <span class="value" id="checkoutTotal">0.00 EGP</span>
                </div>
                
                <div class="checkout-actions">
                    <button class="btn btn-success" id="completeSaleBtn" disabled>
                        ✅ ${t('pos.complete-sale')}
                    </button>
                    <button class="btn btn-outline" onclick="window.clearCart()">
                        🗑️ ${t('pos.clear-cart')}
                    </button>
                </div>
                
                <div style="margin-top: 8px; font-size: 12px; color: var(--text-muted); text-align: center;">
                    ${t('gold.gold-rate')}: <span id="checkoutGoldRate">${formatCurrency(goldRates['24K'] || 0)}</span>/${t('unit.gram')}
                </div>
            </div>
        </div>
    `;

    setupScanner();
    window.manualScan = manualScan;
    window.clearCart = clearCart;
    
    document.getElementById('completeSaleBtn').addEventListener('click', completeSale);
    
    document.getElementById('scannerInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            manualScan();
        }
    });
    
    loadCartFromSession();
    updateCheckout();
}

// ============================================
// Scanner Setup
// ============================================
let scannerInitialized = false;

function setupScanner() {
    if (scannerInitialized) return;
    
    initScanner(handleScannedSKU);
    scannerInitialized = true;
    
    document.addEventListener('barcodeScan', (e) => {
        const { sku } = e.detail;
        handleScannedSKU(sku);
    });
    
    updateScannerStatus('ready', t('common.ready'));
}

function updateScannerStatus(state, text) {
    const dot = document.getElementById('scannerStatusDot');
    const statusText = document.getElementById('scannerStatusText');
    
    if (dot) {
        dot.className = 'status-dot';
        if (state === 'scanning') {
            dot.classList.add('scanning');
        } else if (state === 'inactive') {
            dot.classList.add('inactive');
        }
    }
    
    if (statusText) {
        statusText.textContent = text;
    }
}

// ============================================
// Cart Management
// ============================================
async function handleScannedSKU(sku) {
    if (POS_STATE.isProcessing) {
        showToast(t('common.loading'), 'warning');
        return;
    }
    
    POS_STATE.isProcessing = true;
    updateScannerStatus('scanning', t('common.search'));
    
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
            playErrorBeep();
            showToast(`❌ ${sku} ${t('common.no-data')}`, 'error');
            updateScannerStatus('ready', t('common.no-data'));
            POS_STATE.isProcessing = false;
            return;
        }
        
        const item = data[0];
        
        const existingIndex = POS_STATE.cart.findIndex(c => c.id === item.id);
        if (existingIndex !== -1) {
            playErrorBeep();
            showToast(`⚠️ ${sku} ${t('common.exists') || 'موجود'}`, 'warning');
            updateScannerStatus('ready', t('common.exists') || 'مكرر');
            POS_STATE.isProcessing = false;
            return;
        }
        
        const goldRate = goldRates['24K'] || 0;
        const pureWeight = item.pure_gold_weight || (item.weight_grams * CARATS[item.carat]?.ratio || 0);
        const goldValue = pureWeight * goldRate;
        const workmanshipTotal = item.weight_grams * item.workmanship_per_gram;
        const totalPrice = goldValue + workmanshipTotal;
        
        const cartItem = {
            id: item.id,
            sku: item.sku,
            carat: item.carat,
            weight: item.weight_grams,
            pureWeight: pureWeight,
            workmanshipPerGram: item.workmanship_per_gram,
            workmanshipTotal: workmanshipTotal,
            goldValue: goldValue,
            totalPrice: totalPrice,
            manufacturer: item.manufacturer_id?.name || t('common.no-data'),
            letterCode: item.letter_code,
        };
        
        POS_STATE.cart.push(cartItem);
        POS_STATE.scanCount++;
        
        playSuccessBeep();
        
        renderCart();
        updateCheckout();
        updateScanCount();
        
        showToast(`✅ ${sku} (${item.carat} ${formatNumber(item.weight_grams, 3)} جم)`, 'success');
        updateScannerStatus('ready', `${POS_STATE.cart.length} ${t('common.total')}`);
        
        saveCartToSession();
        
    } catch (err) {
        console.error('Scan error:', err);
        playErrorBeep();
        showToast(err.message || '❌ ' + t('common.error'), 'error');
        updateScannerStatus('ready', t('common.error'));
    } finally {
        POS_STATE.isProcessing = false;
        setTimeout(() => {
            if (POS_STATE.cart.length > 0) {
                updateScannerStatus('ready', `${POS_STATE.cart.length} ${t('common.total')}`);
            } else {
                updateScannerStatus('ready', t('common.ready'));
            }
        }, 1500);
        
        focusScannerInput();
    }
}

function renderCart() {
    const tbody = document.getElementById('posCartBody');
    if (!tbody) return;
    
    if (POS_STATE.cart.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 40px 0;">
                    <div class="pos-cart-empty">
                        <div class="empty-icon">📷</div>
                        <p>${t('common.scan') || 'امسح QR'}</p>
                        <p style="font-size: 12px; color: var(--text-muted);">
                            ${t('pos.scan-sku')}
                        </p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = POS_STATE.cart.map((item, index) => `
        <tr class="cart-item-add" style="animation-delay: ${index * 0.05}s">
            <td><span class="item-sku">${item.sku}</span></td>
            <td>${item.carat}</td>
            <td>${formatNumber(item.weight, 3)} جم</td>
            <td>${formatCurrency(item.workmanshipPerGram)}/${t('unit.gram')}</td>
            <td>${formatCurrency(item.totalPrice)}</td>
            <td>
                <button class="item-remove" onclick="window.removeFromCart('${item.id}')" 
                        title="${t('common.delete')}">✕</button>
            </td>
        </tr>
    `).join('');
    
    document.getElementById('cartItemCount').textContent = POS_STATE.cart.length;
}

function updateCheckout() {
    let totalWeight = 0;
    let totalGoldValue = 0;
    let totalWorkmanship = 0;
    let totalPrice = 0;
    
    POS_STATE.cart.forEach(item => {
        totalWeight += item.weight;
        totalGoldValue += item.goldValue;
        totalWorkmanship += item.workmanshipTotal;
        totalPrice += item.totalPrice;
    });
    
    POS_STATE.totalWeight = totalWeight;
    POS_STATE.totalGoldValue = totalGoldValue;
    POS_STATE.totalWorkmanship = totalWorkmanship;
    POS_STATE.totalPrice = totalPrice;
    
    document.getElementById('checkoutTotalWeight').textContent = formatNumber(totalWeight, 3) + ' جم';
    document.getElementById('checkoutGoldValue').textContent = formatCurrency(totalGoldValue);
    document.getElementById('checkoutWorkmanship').textContent = formatCurrency(totalWorkmanship);
    document.getElementById('checkoutTotal').textContent = formatCurrency(totalPrice);
    document.getElementById('checkoutItemCount').textContent = POS_STATE.cart.length + ' ' + t('common.total');
    document.getElementById('checkoutGoldRate').textContent = formatCurrency(goldRates['24K'] || 0);
    
    const btn = document.getElementById('completeSaleBtn');
    if (btn) {
        btn.disabled = POS_STATE.cart.length === 0;
        btn.textContent = POS_STATE.cart.length > 0 ? 
            `✅ ${t('pos.complete-sale')} (${POS_STATE.cart.length})` : 
            `✅ ${t('pos.complete-sale')}`;
    }
}

function updateScanCount() {
    const el = document.getElementById('posScanCount');
    if (el) {
        el.textContent = `${POS_STATE.scanCount} ${t('common.total')}`;
    }
}

// ============================================
// Cart Operations
// ============================================
window.removeFromCart = function(id) {
    const index = POS_STATE.cart.findIndex(item => item.id === id);
    if (index !== -1) {
        const removed = POS_STATE.cart[index];
        POS_STATE.cart.splice(index, 1);
        renderCart();
        updateCheckout();
        saveCartToSession();
        showToast(`🗑️ ${t('common.delete')} ${removed.sku}`, 'info');
        playBeep(500, 100, 'sine');
    }
};

window.clearCart = function() {
    if (POS_STATE.cart.length === 0) return;
    
    if (confirm(t('modal.confirm-delete'))) {
        POS_STATE.cart = [];
        renderCart();
        updateCheckout();
        saveCartToSession();
        showToast('🗑️ ' + t('pos.clear-cart'), 'info');
        playBeep(400, 150, 'sine');
    }
};

function manualScan() {
    const input = document.getElementById('scannerInput');
    if (!input) return;
    
    const sku = input.value.trim();
    if (!sku) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    input.value = '';
    handleScannedSKU(sku);
}

// ============================================
// Session Storage
// ============================================
function saveCartToSession() {
    try {
        sessionStorage.setItem('posCart', JSON.stringify(POS_STATE.cart));
        sessionStorage.setItem('posScanCount', String(POS_STATE.scanCount));
    } catch (err) {
        console.warn('Failed to save cart to session:', err);
    }
}

function loadCartFromSession() {
    try {
        const saved = sessionStorage.getItem('posCart');
        if (saved) {
            const cart = JSON.parse(saved);
            if (Array.isArray(cart) && cart.length > 0) {
                POS_STATE.cart = cart;
                renderCart();
                updateCheckout();
                updateScanCount();
                showToast(`🔄 ${cart.length} ${t('common.total')}`, 'info');
            }
        }
        
        const scanCount = sessionStorage.getItem('posScanCount');
        if (scanCount) {
            POS_STATE.scanCount = parseInt(scanCount) || 0;
            updateScanCount();
        }
    } catch (err) {
        console.warn('Failed to load cart from session:', err);
    }
}

// ============================================
// Checkout & Sale Completion
// ============================================
async function completeSale() {
    if (POS_STATE.cart.length === 0) {
        showToast(t('common.no-data'), 'warning');
        return;
    }
    
    showCheckoutModal();
}

function showCheckoutModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay checkout-modal';
    
    const total = POS_STATE.totalPrice;
    const weight = POS_STATE.totalWeight;
    const items = POS_STATE.cart.length;
    
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>✅ ${t('pos.complete-sale')}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            
            <div class="checkout-summary">
                <div class="summary-row">
                    <span>${t('common.total')}</span>
                    <span><strong>${items}</strong></span>
                </div>
                <div class="summary-row">
                    <span>${t('gold.weight-grams')}</span>
                    <span>${formatNumber(weight, 3)} جم</span>
                </div>
                <div class="summary-row">
                    <span>${t('gold.gold-value') || 'قيمة الذهب'}</span>
                    <span>${formatCurrency(POS_STATE.totalGoldValue)}</span>
                </div>
                <div class="summary-row">
                    <span>${t('gold.workmanship')}</span>
                    <span>${formatCurrency(POS_STATE.totalWorkmanship)}</span>
                </div>
                <div class="summary-total">
                    <span>${t('common.total')}</span>
                    <span class="value">${formatCurrency(total)}</span>
                </div>
            </div>
            
            <div class="customer-section">
                <label>${t('form.salesperson')} *</label>
                <input type="text" id="salespersonName" required placeholder="${t('form.salesperson')}" />
            </div>
            
            <div class="customer-section">
                <label>${t('form.notes')}</label>
                <input type="text" id="saleNotes" placeholder="${t('form.notes')}" />
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">
                    ${t('common.cancel')}
                </button>
                <button class="btn btn-success" id="confirmSaleBtn">
                    ✅ ${t('common.confirm')}
                </button>
            </div>
        </div>
    `;
    
    document.getElementById('modalContainer').appendChild(modal);
    
    document.getElementById('confirmSaleBtn').addEventListener('click', async () => {
        const salesperson = document.getElementById('salespersonName').value.trim();
        if (!salesperson) {
            showToast(t('common.required'), 'warning');
            return;
        }
        
        const notes = document.getElementById('saleNotes').value.trim();
        await processSale(salesperson, notes);
        modal.remove();
    });
}

async function processSale(salesperson, notes = '') {
    const btn = document.getElementById('confirmSaleBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ ' + t('common.loading');
    }
    
    try {
        const branchId = getActiveBranchId();
        if (!branchId) {
            throw new Error(t('common.required'));
        }
        
        const invoiceNumber = generateInvoiceNumber();
        
        const saleData = {
            invoice_number: invoiceNumber,
            branch_id: branchId,
            total_cash: POS_STATE.totalPrice,
            total_grams: POS_STATE.totalWeight,
            salesperson_name: salesperson,
            status: 'PENDING_APPROVAL',
            notes: notes,
        };
        
        const { data: saleResult, error: saleError } = await supabase
            .from('sales')
            .insert(saleData)
            .select();
        
        if (saleError) throw saleError;
        
        const saleId = saleResult[0].id;
        
        const saleItems = POS_STATE.cart.map(item => ({
            sale_id: saleId,
            inventory_id: item.id,
            price_sold: item.totalPrice,
            gold_rate_at_sale: goldRates['24K'] || 0,
        }));
        
        const { error: itemsError } = await supabase
            .from('sale_items')
            .insert(saleItems);
        
        if (itemsError) throw itemsError;
        
        const inventoryIds = POS_STATE.cart.map(item => item.id);
        const { error: updateError } = await supabase
            .from('inventory')
            .update({ status: 'SOLD' })
            .in('id', inventoryIds);
        
        if (updateError) throw updateError;
        
        playSuccessBeep();
        playSuccessBeep();
        
        printReceipt(saleResult[0], POS_STATE.cart);
        
        POS_STATE.cart = [];
        renderCart();
        updateCheckout();
        saveCartToSession();
        
        showToast(`✅ ${t('pos.complete-sale')} - ${invoiceNumber}`, 'success');
        
        updateScannerStatus('ready', t('common.ready'));
        
    } catch (err) {
        console.error('Sale error:', err);
        playErrorBeep();
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '✅ ' + t('common.confirm');
        }
    }
}

// ============================================
// Receipt Printing
// ============================================
function printReceipt(sale, items) {
    const container = document.getElementById('printContainer');
    container.style.display = 'block';
    
    const now = new Date();
    const dateStr = now.toLocaleDateString(getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US');
    const timeStr = now.toLocaleTimeString(getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US');
    
    let itemsHtml = items.map(item => `
        <div class="receipt-item">
            <span class="item-desc">${item.sku} (${item.carat})</span>
            <span class="item-price">${formatCurrency(item.totalPrice)}</span>
        </div>
    `).join('');
    
    container.innerHTML = `
        <div class="receipt-print">
            <div class="receipt-header">
                <div class="store-name">💎 ${t('app.name')}</div>
                <div class="store-info">${t('app.name')}</div>
                <div class="store-info">${dateStr} - ${timeStr}</div>
                <div class="store-info">${t('common.invoice') || 'الفاتورة'}: ${sale.invoice_number}</div>
                <div class="store-info">${t('form.salesperson')}: ${sale.salesperson_name}</div>
            </div>
            
            <div class="receipt-items">
                ${itemsHtml}
            </div>
            
            <div class="receipt-totals">
                <div class="total-row">
                    <span>${t('gold.weight-grams')}</span>
                    <span>${formatNumber(sale.total_grams, 3)} جم</span>
                </div>
                <div class="total-row">
                    <span>${t('common.total')}</span>
                    <span>${items.length}</span>
                </div>
                <div class="grand-total">
                    <span>${t('common.total')}</span>
                    <span>${formatCurrency(sale.total_cash)}</span>
                </div>
            </div>
            
            <div class="receipt-qr" id="receiptQR"></div>
            
            <div class="receipt-footer">
                <div>${t('common.thank-you') || 'شكراً لتسوقكم معنا'}</div>
                <div style="font-size: 6pt; margin-top: 2px;">
                    ${sale.invoice_number} | ${new Date(sale.created_at).toLocaleString(getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US')}
                </div>
            </div>
        </div>
    `;
    
    setTimeout(() => {
        const qrEl = document.getElementById('receiptQR');
        if (qrEl) {
            try {
                new QRCode(qrEl, {
                    text: JSON.stringify({
                        invoice: sale.invoice_number,
                        total: sale.total_cash,
                        items: items.length,
                        date: sale.created_at,
                    }),
                    width: 80,
                    height: 80,
                    colorDark: '#1a1a2e',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H,
                });
            } catch (err) {
                console.warn('Receipt QR generation failed:', err);
            }
        }
    }, 200);
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            container.style.display = 'none';
            container.innerHTML = '';
        }, 1000);
    }, 500);
}

// ============================================
// Cleanup
// ============================================
window.addEventListener('beforeunload', () => {
    destroyScanner();
});

// ============================================
// Expose Globals
// ============================================
window.renderPOS = renderPOS;
window.handleScannedSKU = handleScannedSKU;
window.completeSale = completeSale;
window.manualScan = manualScan;
window.clearCart = clearCart;
window.removeFromCart = window.removeFromCart;