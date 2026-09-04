import { showToast, formatCurrency, formatNumber } from './utils.js';
import { t } from '../i18n/i18n.js';

/**
 * Generate QR code in a container
 */
export function generateQR(element, data, options = {}) {
    const defaultOptions = {
        width: 200,
        height: 200,
        colorDark: '#1a1a2e',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H,
    };
    
    const config = { ...defaultOptions, ...options };
    
    try {
        return new QRCode(element, {
            text: typeof data === 'string' ? data : JSON.stringify(data),
            width: config.width,
            height: config.height,
            colorDark: config.colorDark,
            colorLight: config.colorLight,
            correctLevel: config.correctLevel,
        });
    } catch (err) {
        console.error('QR generation failed:', err);
        showToast('❌ ' + t('common.error'), 'error');
        return null;
    }
}

/**
 * Render QR preview in card
 */
export function renderQRPreview(container, data) {
    if (!container) return;
    
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 20px;">
            <div id="qrPreviewCanvas" style="background: white; padding: 12px; border-radius: 8px; box-shadow: var(--shadow);"></div>
            <div style="text-align: center;">
                <p style="font-weight: 600;">${data.sku || 'SKU'}</p>
                <p style="font-size: 12px; color: var(--text-muted);">${data.carat || ''} | ${data.weight || 0}g</p>
            </div>
        </div>
    `;
    
    const qrContainer = document.getElementById('qrPreviewCanvas');
    if (qrContainer) {
        const qrData = {
            sku: data.sku || 'SKU-XXXX',
            carat: data.carat || '---',
            weight: data.weight || 0,
            letter: data.letterCode || '---',
            manufacturer: data.manufacturer || '---'
        };
        
        generateQR(qrContainer, qrData, { width: 150, height: 150 });
    }
}

/**
 * Print multiple labels
 */
export function printMultipleLabels(items) {
    if (!items || items.length === 0) {
        showToast(t('common.no-data'), 'warning');
        return;
    }
    
    const container = document.getElementById('printContainer');
    let html = '<div class="print-container-multi">';
    
    items.forEach(item => {
        html += buildPrintHTML(item);
    });
    
    html += '</div>';
    container.innerHTML = html;
    container.style.display = 'block';
    
    setTimeout(() => {
        const qrElements = container.querySelectorAll('.print-qr');
        qrElements.forEach((el, index) => {
            const item = items[index];
            if (item && el) {
                try {
                    new QRCode(el, {
                        text: JSON.stringify({
                            sku: item.sku,
                            carat: item.carat,
                            weight: item.weight,
                            letter: item.letterCode,
                            manufacturer: item.manufacturerCode || ''
                        }),
                        width: 150,
                        height: 150,
                        colorDark: '#1a1a2e',
                        colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.H,
                    });
                } catch (err) {
                    console.error('QR generation error:', err);
                }
            }
        });
    }, 300);
    
    setTimeout(() => {
        window.print();
        setTimeout(() => {
            container.style.display = 'none';
            container.innerHTML = '';
        }, 1000);
    }, 600);
}

/**
 * Build print HTML for a single item
 */
function buildPrintHTML(data) {
    return `
        <div class="print-label">
            <div class="print-header">
                <div class="brand-name">💎 ${t('app.name')}</div>
                <div class="brand-sub">${data.manufacturer || '---'} (${data.manufacturerCode || '---'})</div>
            </div>
            <div class="print-qr"></div>
            <div class="print-sku">${data.sku}</div>
            <div class="print-info">
                <div class="info-item">
                    <span class="info-label">${t('gold.carat')}</span>
                    <span class="info-value">${data.carat}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.weight-grams')}</span>
                    <span class="info-value">${data.weight} جم</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.pure-weight')}</span>
                    <span class="info-value gold">${data.pureWeight || '0.000'} جم</span>
                </div>
                <div class="info-item">
                    <span class="info-label">${t('gold.letter-code')}</span>
                    <span class="info-value">${data.letterCode}</span>
                </div>
            </div>
            <div class="print-price">${data.totalPrice || '0.00 EGP'}</div>
            <div class="print-footer">
                <span class="barcode-text">${data.sku}</span>
            </div>
        </div>
    `;
}