import { fetchData, insertData, supabase } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, generateSKU,
    calculatePureGoldWeight, debounce
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { renderQRPreview } from './qrPrint.js';
import { t } from '../i18n/i18n.js';
import { sanitizeHTML, validateCarat, validateWeight, validateSKU } from './security.js';

let manufacturers = [];
let currentInventoryCount = 0;

/**
 * Render Data Entry Page
 */
export async function renderDataEntry(container) {
    // Fetch manufacturers
    manufacturers = await fetchData('manufacturers', '*');
    
    // Get current inventory count for SKU generation
    const inventory = await fetchData('inventory', 'sku', null, { column: 'created_at', ascending: false });
    currentInventoryCount = inventory.length;
    
    container.innerHTML = `
        <div class="page-header">
            <h2>✏️ ${t('nav.data-entry')}</h2>
            <div class="page-actions">
                <button class="btn btn-outline" onclick="window.clearForm()">
                    🗑️ ${t('common.clear') || 'مسح'}
                </button>
                <button class="btn btn-outline" onclick="window.previewLabel()">
                    👁️ ${t('common.preview') || 'معاينة'}
                </button>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;">
            <!-- Form Section -->
            <div class="card">
                <div class="card-header">
                    <h3>${t('inventory.add-item')}</h3>
                    <span class="text-muted" id="formStatus">${t('common.ready') || 'جاهز'}</span>
                </div>
                <div class="card-body">
                    <form id="dataEntryForm" novalidate>
                        <!-- Manufacturer -->
                        <div class="form-group">
                            <label for="manufacturerSelect">${t('gold.manufacturer')} *</label>
                            <select id="manufacturerSelect" name="manufacturer_id" required>
                                <option value="">-- ${t('common.select') || 'اختر'} --</option>
                                ${manufacturers.map(m => `
                                    <option value="${m.id}" data-code="${m.code}" data-matrix='${JSON.stringify(m.workmanship_matrix)}'>
                                        ${sanitizeHTML(m.name)} (${m.code})
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <!-- Carat -->
                        <div class="form-group">
                            <label for="caratSelect">${t('gold.carat')} *</label>
                            <select id="caratSelect" name="carat" required>
                                <option value="">-- ${t('common.select') || 'اختر'} --</option>
                                ${Object.keys(CARATS).map(c => `
                                    <option value="${c}" data-ratio="${CARATS[c].ratio}">
                                        ${c} (${(CARATS[c].ratio * 100).toFixed(1)}%)
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <!-- Letter Code -->
                        <div class="form-group">
                            <label for="letterCode">${t('gold.letter-code')} *</label>
                            <input type="text" id="letterCode" name="letter_code" 
                                   maxlength="2" required 
                                   placeholder="${t('common.example') || 'مثال'}: A, B, C, AA, AB"
                                   style="text-transform: uppercase;" />
                            <small class="text-muted">${t('gold.workmanship')}</small>
                        </div>

                        <!-- Weight -->
                        <div class="form-group">
                            <label for="weightGrams">${t('gold.weight-grams')} *</label>
                            <input type="number" id="weightGrams" name="weight_grams" 
                                   step="0.001" min="0.001" required 
                                   placeholder="0.000" />
                            <small class="text-muted">${t('common.precision') || 'دقة 3 أرقام عشرية'}</small>
                        </div>

                        <!-- Workmanship (Auto-filled) -->
                        <div class="form-group">
                            <label for="workmanship">${t('gold.workmanship')} (${t('unit.gram')}) *</label>
                            <input type="number" id="workmanship" name="workmanship_per_gram" 
                                   step="0.01" min="0" required 
                                   placeholder="${t('common.auto') || 'تتعبأ تلقائياً'}" readonly />
                            <small class="text-muted">${t('common.auto')}</small>
                        </div>

                        <!-- Auto-calculated fields -->
                        <div style="background: var(--bg-input); padding: 16px; border-radius: var(--radius-sm); margin: 12px 0;">
                            <h4 style="margin-bottom: 8px; color: var(--accent-gold);">📊 ${t('common.calculations') || 'الحسابات التلقائية'}</h4>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <div>
                                    <label style="font-size: 12px; color: var(--text-muted);">${t('gold.pure-weight')} (24K)</label>
                                    <div id="pureWeightDisplay" style="font-size: 18px; font-weight: 700; color: var(--accent-gold);">
                                        0.000 جم
                                    </div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: var(--text-muted);">${t('gold.gold-value') || 'قيمة الذهب'}</label>
                                    <div id="goldValueDisplay" style="font-size: 18px; font-weight: 700; color: var(--text-primary);">
                                        0.00 EGP
                                    </div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: var(--text-muted);">${t('gold.workmanship')}</label>
                                    <div id="workmanshipTotalDisplay" style="font-size: 18px; font-weight: 700; color: var(--text-primary);">
                                        0.00 EGP
                                    </div>
                                </div>
                                <div>
                                    <label style="font-size: 12px; color: var(--text-muted);">${t('common.total')}</label>
                                    <div id="totalPriceDisplay" style="font-size: 20px; font-weight: 700; color: var(--accent-gold);">
                                        0.00 EGP
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- SKU Auto-generated -->
                        <div class="form-group">
                            <label for="skuDisplay">${t('gold.sku')}</label>
                            <div id="skuDisplay" style="font-family: monospace; font-size: 18px; font-weight: 700; color: var(--accent-gold); padding: 8px; background: var(--bg-input); border-radius: var(--radius-sm); border: 2px dashed var(--border-color);">
                                ---
                            </div>
                            <small class="text-muted">${t('common.auto')}</small>
                        </div>

                        <!-- Submit -->
                        <div class="form-group" style="margin-top: 20px;">
                            <button type="submit" class="btn btn-primary" style="width: 100%; padding: 14px; font-size: 16px;">
                                💾 ${t('common.save')}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- Preview Section -->
            <div>
                <div class="card">
                    <div class="card-header">
                        <h3>🏷️ ${t('common.preview')}</h3>
                        <div class="page-actions">
                            <button class="btn btn-primary btn-sm" onclick="window.printLabel()">
                                🖨️ ${t('common.print')}
                            </button>
                        </div>
                    </div>
                    <div class="card-body" id="previewContainer">
                        <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                            <p style="font-size: 48px; margin-bottom: 12px;">🏷️</p>
                            <p>${t('common.preview')}</p>
                            <p style="font-size: 12px;">${t('common.auto')}</p>
                        </div>
                    </div>
                </div>

                <!-- Quick Actions -->
                <div class="card" style="margin-top: 16px;">
                    <div class="card-header">
                        <h3>⚡ ${t('common.actions')}</h3>
                    </div>
                    <div class="card-body" style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button class="btn btn-outline btn-sm" onclick="window.fillSampleData()">
                            📝 ${t('common.sample') || 'عينة'}
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="window.clearForm()">
                            🗑️ ${t('common.clear')}
                        </button>
                        <button class="btn btn-success btn-sm" onclick="window.saveAndPrint()">
                            💾 ${t('common.save')} + 🖨️
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Setup form handlers
    setupFormHandlers();

    // Expose global functions
    window.clearForm = clearForm;
    window.previewLabel = previewLabel;
    window.printLabel = printLabel;
    window.fillSampleData = fillSampleData;
    window.saveAndPrint = saveAndPrint;
}

// ============================================
// Form Setup
// ============================================
function setupFormHandlers() {
    const form = document.getElementById('dataEntryForm');
    const manufacturerSelect = document.getElementById('manufacturerSelect');
    const caratSelect = document.getElementById('caratSelect');
    const letterCode = document.getElementById('letterCode');
    const weightGrams = document.getElementById('weightGrams');
    const workmanshipInput = document.getElementById('workmanship');

    const calculateDebounced = debounce(calculateAll, 200);

    manufacturerSelect.addEventListener('change', calculateDebounced);
    caratSelect.addEventListener('change', calculateDebounced);
    letterCode.addEventListener('input', calculateDebounced);
    weightGrams.addEventListener('input', calculateDebounced);

    letterCode.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
    });

    form.addEventListener('submit', handleFormSubmit);
}

// ============================================
// Calculations
// ============================================
function calculateAll() {
    const manufacturerId = document.getElementById('manufacturerSelect').value;
    const carat = document.getElementById('caratSelect').value;
    const letterCode = document.getElementById('letterCode').value.toUpperCase().trim();
    const weight = parseFloat(document.getElementById('weightGrams').value) || 0;

    const manufacturer = manufacturers.find(m => m.id === manufacturerId);
    const matrix = manufacturer?.workmanship_matrix || {};

    let workmanshipPerGram = 0;
    if (letterCode && matrix[letterCode] !== undefined) {
        workmanshipPerGram = parseFloat(matrix[letterCode]) || 0;
    } else if (letterCode && letterCode.length > 1) {
        const firstLetter = letterCode.charAt(0);
        if (matrix[firstLetter] !== undefined) {
            workmanshipPerGram = parseFloat(matrix[firstLetter]) || 0;
        }
    }
    document.getElementById('workmanship').value = workmanshipPerGram.toFixed(2);

    const ratio = CARATS[carat]?.ratio || 0;
    const pureWeight = weight * ratio;
    document.getElementById('pureWeightDisplay').textContent = formatNumber(pureWeight, 3) + ' جم';

    const goldRate = goldRates['24K'] || 0;
    const goldValue = pureWeight * goldRate;
    document.getElementById('goldValueDisplay').textContent = formatCurrency(goldValue);

    const totalWorkmanship = weight * workmanshipPerGram;
    document.getElementById('workmanshipTotalDisplay').textContent = formatCurrency(totalWorkmanship);

    const totalPrice = goldValue + totalWorkmanship;
    document.getElementById('totalPriceDisplay').textContent = formatCurrency(totalPrice);

    if (manufacturerId && carat && letterCode && weight > 0) {
        const mfgCode = manufacturer?.code || 'XX';
        const seq = currentInventoryCount + 1;
        const sku = generateSKU(mfgCode, carat, letterCode, seq);
        document.getElementById('skuDisplay').textContent = sku;
        document.getElementById('skuDisplay').style.color = 'var(--accent-gold)';
    } else {
        document.getElementById('skuDisplay').textContent = '---';
        document.getElementById('skuDisplay').style.color = 'var(--text-muted)';
    }

    previewLabel();

    const status = document.getElementById('formStatus');
    if (manufacturerId && carat && letterCode && weight > 0) {
        status.textContent = '✅ ' + t('common.ready');
        status.style.color = 'var(--success)';
    } else {
        status.textContent = '⚠️ ' + t('common.required');
        status.style.color = 'var(--warning)';
    }
}

// ============================================
// Form Submit
// ============================================
async function handleFormSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    if (!data.manufacturer_id || !data.carat || !data.letter_code || !data.weight_grams) {
        showToast(t('common.required'), 'warning');
        return;
    }

    const weight = parseFloat(data.weight_grams);
    if (isNaN(weight) || weight <= 0) {
        showToast('الوزن يجب أن يكون أكبر من 0', 'warning');
        return;
    }

    try {
        const ratio = CARATS[data.carat]?.ratio || 0;
        const pureWeight = weight * ratio;
        const workmanship = parseFloat(data.workmanship_per_gram) || 0;
        
        const manufacturer = manufacturers.find(m => m.id === data.manufacturer_id);
        const mfgCode = manufacturer?.code || 'XX';
        const seq = currentInventoryCount + 1;
        const sku = generateSKU(mfgCode, data.carat, data.letter_code.toUpperCase(), seq);

        const payload = {
            sku: sku,
            manufacturer_id: data.manufacturer_id,
            carat: data.carat,
            letter_code: data.letter_code.toUpperCase(),
            weight_grams: weight,
            workmanship_per_gram: workmanship,
            pure_gold_weight: pureWeight,
            status: 'IN_STOCK',
        };

        const result = await insertData('inventory', payload);
        
        if (result && result.length > 0) {
            currentInventoryCount++;
            showToast(`✅ ${t('common.success')}: ${sku}`, 'success');
            clearForm();
            document.getElementById('skuDisplay').textContent = '---';
            
            window.dispatchEvent(new CustomEvent('inventoryUpdated', { 
                detail: { item: result[0] } 
            }));
        }
    } catch (err) {
        console.error('Submit error:', err);
        showToast(err.message || t('common.error'), 'error');
    }
}

// ============================================
// Clear Form
// ============================================
function clearForm() {
    document.getElementById('manufacturerSelect').value = '';
    document.getElementById('caratSelect').value = '';
    document.getElementById('letterCode').value = '';
    document.getElementById('weightGrams').value = '';
    document.getElementById('workmanship').value = '';
    
    document.getElementById('pureWeightDisplay').textContent = '0.000 جم';
    document.getElementById('goldValueDisplay').textContent = '0.00 EGP';
    document.getElementById('workmanshipTotalDisplay').textContent = '0.00 EGP';
    document.getElementById('totalPriceDisplay').textContent = '0.00 EGP';
    document.getElementById('skuDisplay').textContent = '---';
    document.getElementById('skuDisplay').style.color = 'var(--text-muted)';
    document.getElementById('formStatus').textContent = t('common.ready');
    document.getElementById('formStatus').style.color = 'var(--text-muted)';
    
    const previewContainer = document.getElementById('previewContainer');
    if (previewContainer) {
        previewContainer.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <p style="font-size: 48px; margin-bottom: 12px;">🏷️</p>
                <p>${t('common.preview')}</p>
            </div>
        `;
    }
}

// ============================================
// Preview Label
// ============================================
function previewLabel() {
    const container = document.getElementById('previewContainer');
    if (!container) return;

    const manufacturerId = document.getElementById('manufacturerSelect').value;
    const carat = document.getElementById('caratSelect').value;
    const letterCode = document.getElementById('letterCode').value.toUpperCase().trim();
    const weight = parseFloat(document.getElementById('weightGrams').value) || 0;
    const workmanship = parseFloat(document.getElementById('workmanship').value) || 0;
    const sku = document.getElementById('skuDisplay').textContent;
    const totalPrice = document.getElementById('totalPriceDisplay').textContent;

    const manufacturer = manufacturers.find(m => m.id === manufacturerId);
    const ratio = CARATS[carat]?.ratio || 0;
    const pureWeight = weight * ratio;
    const goldRate = goldRates['24K'] || 0;

    const previewData = {
        sku: sku !== '---' ? sku : 'SKU-XXXX',
        manufacturer: manufacturer?.name || '---',
        carat: carat || '---',
        letterCode: letterCode || '---',
        weight: weight,
        pureWeight: pureWeight,
        workmanship: workmanship,
        totalPrice: totalPrice || '0.00 EGP',
        goldRate: goldRate,
    };

    container.innerHTML = `
        <div class="preview-label-mock">
            <div class="mock-header">
                <div class="mock-brand">💎 ${t('app.name')}</div>
                <div style="font-size: 8px; color: #999;">${manufacturer?.name || '---'}</div>
            </div>
            <div class="mock-qr" id="previewQRContainer">
                <div style="width: 80px; height: 80px; background: #f0f0f0; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 11px;">
                    ${t('common.loading')}
                </div>
            </div>
            <div class="mock-info">
                <div class="mock-item">
                    <span>${t('gold.carat')}</span>
                    <span><strong>${carat || '---'}</strong></span>
                </div>
                <div class="mock-item">
                    <span>${t('gold.weight-grams')}</span>
                    <span><strong>${weight > 0 ? formatNumber(weight, 3) : '0.000'} جم</strong></span>
                </div>
                <div class="mock-item">
                    <span>${t('gold.pure-weight')}</span>
                    <span><strong style="color: #b8922f;">${pureWeight > 0 ? formatNumber(pureWeight, 3) : '0.000'} جم</strong></span>
                </div>
                <div class="mock-item">
                    <span>${t('gold.letter-code')}</span>
                    <span><strong>${letterCode || '---'}</strong></span>
                </div>
            </div>
            <div class="mock-sku">${sku !== '---' ? sku : 'SKU-XXXX'}</div>
            <div class="mock-price">${totalPrice || '0.00 EGP'}</div>
            <div class="mock-footer">
                <span class="barcode-text">${sku !== '---' ? sku : 'SKU-XXXX'}</span>
            </div>
        </div>
    `;

    if (sku !== '---') {
        setTimeout(() => {
            const qrContainer = document.getElementById('previewQRContainer');
            if (qrContainer) {
                try {
                    qrContainer.innerHTML = '';
                    const qr = new QRCode(qrContainer, {
                        text: JSON.stringify({
                            sku: sku,
                            carat: carat,
                            weight: weight,
                            letter: letterCode,
                            manufacturer: manufacturer?.code || ''
                        }),
                        width: 80,
                        height: 80,
                        colorDark: '#1a1a2e',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.H,
                    });
                } catch (err) {
                    console.error('QR generation error:', err);
                    qrContainer.innerHTML = `
                        <div style="width: 80px; height: 80px; background: #fee; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 11px;">
                            ⚠️ ${t('common.error')}
                        </div>
                    `;
                }
            }
        }, 100);
    }
}

// ============================================
// Print Label
// ============================================
function printLabel() {
    const sku = document.getElementById('skuDisplay').textContent;
    if (sku === '---' || sku === 'SKU-XXXX') {
        showToast(t('common.required'), 'warning');
        return;
    }

    const manufacturerId = document.getElementById('manufacturerSelect').value;
    const carat = document.getElementById('caratSelect').value;
    const letterCode = document.getElementById('letterCode').value.toUpperCase().trim();
    const weight = parseFloat(document.getElementById('weightGrams').value) || 0;
    const workmanship = parseFloat(document.getElementById('workmanship').value) || 0;
    const totalPrice = document.getElementById('totalPriceDisplay').textContent;
    const pureWeight = document.getElementById('pureWeightDisplay').textContent;

    const manufacturer = manufacturers.find(m => m.id === manufacturerId);

    const printHTML = buildPrintHTML({
        sku: sku,
        manufacturer: manufacturer?.name || '---',
        manufacturerCode: manufacturer?.code || '---',
        carat: carat,
        letterCode: letterCode,
        weight: weight,
        pureWeight: pureWeight,
        workmanship: workmanship,
        totalPrice: totalPrice,
    });

    const printContainer = document.getElementById('printContainer');
    printContainer.innerHTML = printHTML;
    printContainer.style.display = 'block';

    setTimeout(() => {
        const qrElement = document.getElementById('printQRCode');
        if (qrElement) {
            try {
                new QRCode(qrElement, {
                    text: JSON.stringify({
                        sku: sku,
                        carat: carat,
                        weight: weight,
                        letter: letterCode,
                        manufacturer: manufacturer?.code || ''
                    }),
                    width: 180,
                    height: 180,
                    colorDark: '#1a1a2e',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H,
                });
            } catch (err) {
                console.error('Print QR generation error:', err);
            }
        }
    }, 200);

    setTimeout(() => {
        window.print();
        setTimeout(() => {
            printContainer.style.display = 'none';
            printContainer.innerHTML = '';
        }, 1000);
    }, 500);
}

function buildPrintHTML(data) {
    return `
        <div class="print-label">
            <div class="print-header">
                <div class="brand-name">💎 ${t('app.name')}</div>
                <div class="brand-sub">${data.manufacturer} (${data.manufacturerCode})</div>
            </div>
            <div class="print-qr" id="printQRCode"></div>
            <div class="print-sku">${data.sku}</div>
            <div class="print-info">
                <div class="info-item">
                    <span class="info-label">${t('gold.carat')}</span>
                    <span class="info-value">${data.carat}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.weight-grams')}</span>
                    <span class="info-value">${formatNumber(data.weight, 3)} جم</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.pure-weight')}</span>
                    <span class="info-value gold">${data.pureWeight}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.letter-code')}</span>
                    <span class="info-value">${data.letterCode}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.workmanship')}</span>
                    <span class="info-value">${formatCurrency(data.workmanship)}/${t('unit.gram')}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('common.total')}</span>
                    <span class="info-value gold">${data.totalPrice}</span>
                </div>
            </div>
            <div class="print-footer">
                <span class="barcode-text">${data.sku}</span>
            </div>
        </div>
    `;
}

// ============================================
// Fill Sample Data
// ============================================
function fillSampleData() {
    const sampleManufacturer = manufacturers[0];
    if (!sampleManufacturer) {
        showToast(t('common.no-data'), 'warning');
        return;
    }

    document.getElementById('manufacturerSelect').value = sampleManufacturer.id;
    
    const matrix = sampleManufacturer.workmanship_matrix || {};
    const letters = Object.keys(matrix);
    const sampleLetter = letters.length > 0 ? letters[0] : 'A';
    
    document.getElementById('letterCode').value = sampleLetter;
    document.getElementById('caratSelect').value = '21K';
    document.getElementById('weightGrams').value = (5 + Math.random() * 15).toFixed(3);
    
    calculateAll();
    showToast(t('common.sample'), 'success');
}

// ============================================
// Save and Print
// ============================================
async function saveAndPrint() {
    const form = document.getElementById('dataEntryForm');
    const submitEvent = new Event('submit', { cancelable: true });
    form.dispatchEvent(submitEvent);
    
    setTimeout(() => {
        const sku = document.getElementById('skuDisplay').textContent;
        if (sku !== '---') {
            printLabel();
        }
    }, 800);
}

// ============================================
// Expose Globals
// ============================================
window.clearForm = clearForm;
window.previewLabel = previewLabel;
window.printLabel = printLabel;
window.fillSampleData = fillSampleData;
window.saveAndPrint = saveAndPrint;