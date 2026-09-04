import { fetchData, insertData, updateData, supabase, deleteData } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, debounce,
    getActiveBranchId, generateSKU
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t } from '../i18n/i18n.js';
import { sanitizeHTML, sanitizeSQL } from './security.js';

// ============================================
// State
// ============================================
const STATE = {
    items: [],
    totalCount: 0,
    currentPage: 1,
    pageSize: 25,
    filters: {
        carat: '',
        status: '',
        manufacturer: '',
        branch: '',
        search: '',
    },
    isLoading: false,
    manufacturers: [],
    branches: [],
};

// ============================================
// Main Render Function
// ============================================
export async function renderInventory(container) {
    await loadReferenceData();
    
    container.innerHTML = `
        <div class="page-header">
            <h2>📦 ${t('inventory.title')}</h2>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="window.location.hash='data-entry'">
                    ➕ ${t('inventory.add-item')}
                </button>
                <button class="btn btn-outline" onclick="window.showImportModal()">
                    📤 ${t('inventory.import-excel')}
                </button>
                <button class="btn btn-outline" onclick="window.exportInventory()">
                    📥 ${t('inventory.export-excel')}
                </button>
            </div>
        </div>

        <div class="inventory-container">
            <!-- Toolbar -->
            <div class="inventory-toolbar">
                <div class="search-wrapper">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="inventorySearch" placeholder="${t('inventory.search')}" />
                </div>
                
                <div class="filter-group">
                    <select id="filterCarat">
                        <option value="">${t('common.all')}</option>
                        ${Object.keys(CARATS).map(c => `<option value="${c}">${c}</option>`).join('')}
                    </select>
                    <select id="filterStatus">
                        <option value="">${t('common.all')}</option>
                        <option value="IN_STOCK">${t('inventory.in-stock')}</option>
                        <option value="SOLD">${t('inventory.sold')}</option>
                        <option value="IN_TRANSIT">${t('inventory.in-transit')}</option>
                        <option value="RESERVED">${t('inventory.reserved')}</option>
                        <option value="MELTED">${t('inventory.melted')}</option>
                        <option value="RETURNED_TO_SUPPLIER">${t('inventory.returned-to-supplier')}</option>
                    </select>
                    <select id="filterManufacturer">
                        <option value="">${t('common.all')}</option>
                        ${STATE.manufacturers.map(m => `<option value="${m.id}">${sanitizeHTML(m.name)}</option>`).join('')}
                    </select>
                    <select id="filterBranch">
                        <option value="">${t('common.all')}</option>
                        ${STATE.branches.map(b => `<option value="${b.id}">${sanitizeHTML(b.name)}</option>`).join('')}
                    </select>
                </div>
                
                <div class="toolbar-actions">
                    <button class="btn btn-outline btn-sm" onclick="window.resetFilters()">
                        🗑️ ${t('common.clear')}
                    </button>
                    <button class="btn btn-outline btn-sm" onclick="window.refreshInventory()">
                        🔄 ${t('common.refresh')}
                    </button>
                </div>
            </div>

            <!-- Table -->
            <div class="card">
                <div class="card-header">
                    <h3>${t('inventory.title')}</h3>
                    <span class="text-muted" id="inventoryCount">0 ${t('common.total')}</span>
                </div>
                <div class="card-body no-padding inventory-loading" id="inventoryTableWrapper">
                    <div class="table-responsive">
                        <table class="inventory-table">
                            <thead>
                                <tr>
                                    <th>${t('gold.sku')}</th>
                                    <th>${t('gold.manufacturer')}</th>
                                    <th>${t('gold.carat')}</th>
                                    <th>${t('gold.letter-code')}</th>
                                    <th>${t('gold.weight-grams')}</th>
                                    <th>${t('gold.pure-weight')}</th>
                                    <th>${t('gold.workmanship')}</th>
                                    <th>${t('common.total')}</th>
                                    <th>${t('common.status')}</th>
                                    <th>${t('gold.branch')}</th>
                                    <th>${t('common.actions')}</th>
                                </tr>
                            </thead>
                            <tbody id="inventoryTableBody">
                                <tr>
                                    <td colspan="11" class="text-center text-muted" style="padding: 40px;">
                                        <div class="loading-spinner" style="margin: 0 auto;"></div>
                                        <p style="margin-top: 12px;">${t('common.loading')}</p>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Pagination -->
            <div class="pagination-container">
                <div class="pagination-info">
                    ${t('common.show') || 'عرض'} <strong id="pageStart">0</strong> - <strong id="pageEnd">0</strong> 
                    ${t('common.of') || 'من'} <strong id="totalItems">0</strong> ${t('common.total')}
                </div>
                <div class="pagination-controls">
                    <select class="page-size-select" id="pageSizeSelect">
                        <option value="10">10</option>
                        <option value="25" selected>25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                        <option value="200">200</option>
                    </select>
                    <button class="btn btn-outline btn-sm" id="prevPage" disabled>‹</button>
                    <span id="pageInfo" style="font-size: var(--font-size-sm); min-width: 60px; text-align: center;">1 / 1</span>
                    <button class="btn btn-outline btn-sm" id="nextPage" disabled>›</button>
                </div>
            </div>
        </div>
    `;

    setupInventoryEvents();
    await loadInventory();
}

// ============================================
// Load Reference Data
// ============================================
async function loadReferenceData() {
    try {
        const [manufacturers, branches] = await Promise.all([
            fetchData('manufacturers', '*'),
            fetchData('branches', '*'),
        ]);
        
        STATE.manufacturers = manufacturers || [];
        STATE.branches = branches || [];
    } catch (err) {
        console.error('Load reference data error:', err);
    }
}

// ============================================
// Setup Events
// ============================================
function setupInventoryEvents() {
    const searchInput = document.getElementById('inventorySearch');
    const filterCarat = document.getElementById('filterCarat');
    const filterStatus = document.getElementById('filterStatus');
    const filterManufacturer = document.getElementById('filterManufacturer');
    const filterBranch = document.getElementById('filterBranch');
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    
    const debouncedLoad = debounce(loadInventory, 300);
    
    searchInput.addEventListener('input', (e) => {
        STATE.filters.search = sanitizeSQL(e.target.value.trim());
        STATE.currentPage = 1;
        debouncedLoad();
    });
    
    filterCarat.addEventListener('change', (e) => {
        STATE.filters.carat = e.target.value;
        STATE.currentPage = 1;
        loadInventory();
    });
    
    filterStatus.addEventListener('change', (e) => {
        STATE.filters.status = e.target.value;
        STATE.currentPage = 1;
        loadInventory();
    });
    
    filterManufacturer.addEventListener('change', (e) => {
        STATE.filters.manufacturer = e.target.value;
        STATE.currentPage = 1;
        loadInventory();
    });
    
    filterBranch.addEventListener('change', (e) => {
        STATE.filters.branch = e.target.value;
        STATE.currentPage = 1;
        loadInventory();
    });
    
    pageSizeSelect.addEventListener('change', (e) => {
        STATE.pageSize = parseInt(e.target.value);
        STATE.currentPage = 1;
        loadInventory();
    });
    
    document.getElementById('prevPage').addEventListener('click', () => {
        if (STATE.currentPage > 1) {
            STATE.currentPage--;
            loadInventory();
        }
    });
    
    document.getElementById('nextPage').addEventListener('click', () => {
        const totalPages = Math.ceil(STATE.totalCount / STATE.pageSize);
        if (STATE.currentPage < totalPages) {
            STATE.currentPage++;
            loadInventory();
        }
    });
    
    window.resetFilters = resetFilters;
    window.refreshInventory = loadInventory;
    window.showImportModal = showImportModal;
    window.exportInventory = exportInventory;
    window.editInventoryItem = editInventoryItem;
    window.deleteInventoryItem = deleteInventoryItem;
}

// ============================================
// Load Inventory with Server-Side Pagination
// ============================================
async function loadInventory() {
    if (STATE.isLoading) return;
    
    STATE.isLoading = true;
    showLoadingState(true);
    
    try {
        const branchId = getActiveBranchId();
        const { carat, status, manufacturer, branch, search } = STATE.filters;
        
        let query = supabase
            .from('inventory')
            .select('*, manufacturer_id(name, code), branch_id(name)', { count: 'exact' });
        
        if (branchId) {
            query = query.eq('branch_id', branchId);
        }
        
        if (carat) query = query.eq('carat', carat);
        if (status) query = query.eq('status', status);
        if (manufacturer) query = query.eq('manufacturer_id', manufacturer);
        if (branch) query = query.eq('branch_id', branch);
        
        if (search) {
            query = query.or(`sku.ilike.%${search}%,manufacturer_id.name.ilike.%${search}%`);
        }
        
        const start = (STATE.currentPage - 1) * STATE.pageSize;
        const end = start + STATE.pageSize - 1;
        
        query = query.range(start, end);
        query = query.order('created_at', { ascending: false });
        
        const { data, error, count } = await query;
        
        if (error) throw error;
        
        STATE.items = data || [];
        STATE.totalCount = count || 0;
        
        renderTable();
        updatePagination();
        
    } catch (err) {
        console.error('Load inventory error:', err);
        showToast(err.message || '❌ ' + t('common.error'), 'error');
        
        const tbody = document.getElementById('inventoryTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="11" class="text-center text-muted" style="padding: 40px;">
                        ❌ ${t('common.error')}
                    </td>
                </tr>
            `;
        }
    } finally {
        STATE.isLoading = false;
        showLoadingState(false);
    }
}

// ============================================
// Render Table
// ============================================
function renderTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;
    
    if (STATE.items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center text-muted" style="padding: 40px;">
                    📭 ${t('common.no-data')}
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = STATE.items.map(item => {
        const manufacturer = STATE.manufacturers.find(m => m.id === item.manufacturer_id);
        const branch = STATE.branches.find(b => b.id === item.branch_id);
        const pureWeight = item.pure_gold_weight || (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
        const price = pureWeight * (goldRates['24K'] || 0) + (item.weight_grams * item.workmanship_per_gram);
        
        const statusColors = {
            'IN_STOCK': 'status-in_stock',
            'SOLD': 'status-sold',
            'IN_TRANSIT': 'status-in_transit',
            'RESERVED': 'status-reserved',
            'MELTED': 'status-melted',
            'RETURNED_TO_SUPPLIER': 'status-returned_to_supplier',
        };
        
        const statusLabels = {
            'IN_STOCK': t('inventory.in-stock'),
            'SOLD': t('inventory.sold'),
            'IN_TRANSIT': t('inventory.in-transit'),
            'RESERVED': t('inventory.reserved'),
            'MELTED': t('inventory.melted'),
            'RETURNED_TO_SUPPLIER': t('inventory.returned-to-supplier'),
        };
        
        return `
            <tr>
                <td><span class="sku-cell">${sanitizeHTML(item.sku)}</span></td>
                <td>${sanitizeHTML(manufacturer?.name || t('common.no-data'))}</td>
                <td>${item.carat}</td>
                <td>${sanitizeHTML(item.letter_code)}</td>
                <td>${formatNumber(item.weight_grams, 3)}</td>
                <td>${formatNumber(pureWeight, 3)}</td>
                <td>${formatCurrency(item.workmanship_per_gram)}</td>
                <td>${formatCurrency(price)}</td>
                <td><span class="status-badge ${statusColors[item.status] || ''}">${statusLabels[item.status] || item.status}</span></td>
                <td>${sanitizeHTML(branch?.name || t('common.no-data'))}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="window.editInventoryItem('${item.id}')">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="window.deleteInventoryItem('${item.id}')">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
    
    const countEl = document.getElementById('inventoryCount');
    if (countEl) {
        countEl.textContent = `${STATE.totalCount} ${t('common.total')}`;
    }
}

// ============================================
// Pagination
// ============================================
function updatePagination() {
    const totalPages = Math.ceil(STATE.totalCount / STATE.pageSize) || 1;
    const start = (STATE.currentPage - 1) * STATE.pageSize + 1;
    const end = Math.min(STATE.currentPage * STATE.pageSize, STATE.totalCount);
    
    document.getElementById('pageStart').textContent = STATE.totalCount > 0 ? start : 0;
    document.getElementById('pageEnd').textContent = end;
    document.getElementById('totalItems').textContent = STATE.totalCount;
    document.getElementById('pageInfo').textContent = `${STATE.currentPage} / ${totalPages}`;
    
    document.getElementById('prevPage').disabled = STATE.currentPage <= 1;
    document.getElementById('nextPage').disabled = STATE.currentPage >= totalPages;
}

// ============================================
// Loading State
// ============================================
function showLoadingState(isLoading) {
    const wrapper = document.getElementById('inventoryTableWrapper');
    if (!wrapper) return;
    
    if (isLoading) {
        wrapper.classList.add('inventory-loading');
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.id = 'loadingOverlay';
        overlay.innerHTML = `<div class="loading-spinner"></div>`;
        wrapper.appendChild(overlay);
    } else {
        wrapper.classList.remove('inventory-loading');
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) overlay.remove();
    }
}

// ============================================
// Filters
// ============================================
function resetFilters() {
    document.getElementById('inventorySearch').value = '';
    document.getElementById('filterCarat').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterManufacturer').value = '';
    document.getElementById('filterBranch').value = '';
    
    STATE.filters = {
        carat: '',
        status: '',
        manufacturer: '',
        branch: '',
        search: '',
    };
    STATE.currentPage = 1;
    loadInventory();
}

// ============================================
// Edit/Delete Items
// ============================================
async function editInventoryItem(id) {
    const item = STATE.items.find(i => i.id === id);
    if (!item) {
        showToast(t('common.no-data'), 'error');
        return;
    }
    
    window.location.hash = 'data-entry';
    window._editItem = item;
}

async function deleteInventoryItem(id) {
    if (!confirm(t('modal.confirm-delete'))) return;
    
    try {
        await deleteData('inventory', { id });
        showToast('✅ ' + t('common.success'), 'success');
        loadInventory();
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

// ============================================
// Excel Import
// ============================================
async function showImportModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay preview-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>📤 ${t('inventory.import-excel')}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            
            <div class="drop-zone" id="dropZone">
                <div class="drop-icon">📁</div>
                <div class="drop-text">${t('common.drag-drop') || 'اسحب وأفلت ملف Excel هنا'}</div>
                <div class="drop-hint">${t('common.click-select') || 'أو اضغط للاختيار من الجهاز'}</div>
                <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display: none;" />
            </div>
            
            <div id="importPreview" style="display: none;">
                <div class="preview-stats" id="previewStats"></div>
                <div class="preview-table-wrap">
                    <table class="preview-table">
                        <thead id="previewHeader"></thead>
                        <tbody id="previewBody"></tbody>
                    </table>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">${t('common.cancel')}</button>
                    <button class="btn btn-success" id="importConfirmBtn">✅ ${t('common.import')}</button>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('modalContainer').appendChild(modal);
    
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleImportFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleImportFile(e.target.files[0]);
        }
    });
    
    let parsedData = [];
    
    async function handleImportFile(file) {
        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(firstSheet);
                    
                    parsedData = await validateImportData(jsonData);
                    showImportPreview(parsedData);
                    
                } catch (err) {
                    showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
                }
            };
            reader.readAsArrayBuffer(file);
        } catch (err) {
            showToast('❌ ' + t('common.error'), 'error');
        }
    }
    
    function validateImportData(data) {
        const results = [];
        const requiredFields = ['sku', 'carat', 'weight_grams', 'letter_code'];
        const validCarats = Object.keys(CARATS);
        
        data.forEach((row, index) => {
            const validation = {
                index: index + 1,
                row: row,
                isValid: true,
                errors: [],
                warnings: [],
            };
            
            for (const field of requiredFields) {
                if (!row[field] || String(row[field]).trim() === '') {
                    validation.isValid = false;
                    validation.errors.push(`حقل ${field} ${t('common.required')}`);
                }
            }
            
            if (row.carat && !validCarats.includes(String(row.carat).toUpperCase())) {
                validation.isValid = false;
                validation.errors.push(`العيار غير صحيح: ${row.carat}`);
            }
            
            if (row.weight_grams) {
                const weight = parseFloat(row.weight_grams);
                if (isNaN(weight) || weight <= 0) {
                    validation.isValid = false;
                    validation.errors.push(t('common.required'));
                }
            }
            
            if (row.sku) {
                const existing = STATE.items.find(i => i.sku === String(row.sku).trim());
                if (existing) {
                    validation.warnings.push(`SKU موجود بالفعل: ${row.sku}`);
                }
            }
            
            results.push(validation);
        });
        
        return results;
    }
    
    function showImportPreview(data) {
        const previewDiv = document.getElementById('importPreview');
        previewDiv.style.display = 'block';
        
        const validCount = data.filter(d => d.isValid).length;
        const invalidCount = data.filter(d => !d.isValid).length;
        
        document.getElementById('previewStats').innerHTML = `
            <div class="stat-item">
                <span>${t('common.total')}:</span>
                <span class="stat-number">${data.length}</span>
            </div>
            <div class="stat-item">
                <span>✅ ${t('common.success')}:</span>
                <span class="stat-number" style="color: var(--success);">${validCount}</span>
            </div>
            <div class="stat-item">
                <span>❌ ${t('common.error')}:</span>
                <span class="stat-number" style="color: var(--danger);">${invalidCount}</span>
            </div>
        `;
        
        const headers = Object.keys(data[0]?.row || {});
        document.getElementById('previewHeader').innerHTML = `
            <tr>
                <th>#</th>
                ${headers.map(h => `<th>${sanitizeHTML(h)}</th>`).join('')}
                <th>${t('common.status')}</th>
            </tr>
        `;
        
        document.getElementById('previewBody').innerHTML = data.map(d => {
            const statusClass = d.isValid ? 'status-valid' : 'status-invalid';
            const statusText = d.isValid ? '✅ ' + t('common.success') : '❌ ' + t('common.error');
            const errors = d.errors.join(', ');
            const warnings = d.warnings.join(', ');
            
            return `
                <tr>
                    <td>${d.index}</td>
                    ${headers.map(h => `<td>${sanitizeHTML(d.row[h] || '')}</td>`).join('')}
                    <td>
                        <span class="${statusClass}">${statusText}</span>
                        ${errors ? `<br/><small style="color: var(--danger);">${errors}</small>` : ''}
                        ${warnings ? `<br/><small style="color: var(--warning);">${warnings}</small>` : ''}
                    </td>
                </tr>
            `;
        }).join('');
        
        document.getElementById('importConfirmBtn').disabled = invalidCount > 0;
    }
    
    document.getElementById('importConfirmBtn').addEventListener('click', async () => {
        const validItems = parsedData.filter(d => d.isValid);
        
        if (validItems.length === 0) {
            showToast(t('common.no-data'), 'warning');
            return;
        }
        
        if (!confirm(`هل أنت متأكد من استيراد ${validItems.length} قطعة؟`)) return;
        
        try {
            const branchId = getActiveBranchId();
            if (!branchId) {
                showToast(t('common.required'), 'warning');
                return;
            }
            
            let imported = 0;
            let failed = 0;
            
            for (const item of validItems) {
                try {
                    const row = item.row;
                    const carat = String(row.carat).toUpperCase();
                    const weight = parseFloat(row.weight_grams);
                    const pureWeight = weight * (CARATS[carat]?.ratio || 0);
                    
                    let manufacturerId = null;
                    if (row.manufacturer) {
                        const mfg = STATE.manufacturers.find(m => 
                            m.name.toLowerCase() === String(row.manufacturer).toLowerCase()
                        );
                        if (mfg) manufacturerId = mfg.id;
                    }
                    
                    const sku = row.sku ? String(row.sku).trim() : 
                        generateSKU(
                            'IMP',
                            carat,
                            String(row.letter_code || 'A').toUpperCase(),
                            STATE.items.length + imported + 1
                        );
                    
                    const payload = {
                        sku: sku,
                        manufacturer_id: manufacturerId,
                        carat: carat,
                        letter_code: String(row.letter_code || 'A').toUpperCase(),
                        weight_grams: weight,
                        workmanship_per_gram: parseFloat(row.workmanship_per_gram) || 0,
                        pure_gold_weight: pureWeight,
                        status: row.status || 'IN_STOCK',
                        branch_id: branchId,
                    };
                    
                    await insertData('inventory', payload);
                    imported++;
                } catch (err) {
                    failed++;
                    console.error('Import item error:', err);
                }
            }
            
            modal.remove();
            showToast(`✅ ${t('common.success')} ${imported} ${t('common.total')}${failed > 0 ? `, ${t('common.error')} ${failed}` : ''}`, 'success');
            loadInventory();
            
        } catch (err) {
            showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
        }
    });
}

// ============================================
// Excel Export
// ============================================
async function exportInventory() {
    try {
        const branchId = getActiveBranchId();
        const { carat, status, manufacturer, branch, search } = STATE.filters;
        
        let query = supabase
            .from('inventory')
            .select('*, manufacturer_id(name, code), branch_id(name)');
        
        if (branchId) query = query.eq('branch_id', branchId);
        if (carat) query = query.eq('carat', carat);
        if (status) query = query.eq('status', status);
        if (manufacturer) query = query.eq('manufacturer_id', manufacturer);
        if (branch) query = query.eq('branch_id', branch);
        if (search) {
            query = query.or(`sku.ilike.%${search}%,manufacturer_id.name.ilike.%${search}%`);
        }
        
        query = query.order('created_at', { ascending: false });
        
        const { data, error } = await query;
        if (error) throw error;
        
        const exportData = data.map(item => {
            const manufacturer = STATE.manufacturers.find(m => m.id === item.manufacturer_id);
            const branch = STATE.branches.find(b => b.id === item.branch_id);
            const pureWeight = item.pure_gold_weight || (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
            const price = pureWeight * (goldRates['24K'] || 0) + (item.weight_grams * item.workmanship_per_gram);
            
            return {
                'SKU': item.sku,
                'المصنع': manufacturer?.name || '',
                'العيار': item.carat,
                'الرمز': item.letter_code,
                'الوزن (جم)': item.weight_grams,
                'الوزن الصافي (جم)': pureWeight,
                'المصنعية/جم': item.workmanship_per_gram,
                'السعر التقديري': price,
                'الحالة': item.status,
                'الفرع': branch?.name || '',
                'تاريخ الإضافة': new Date(item.created_at).toLocaleDateString('ar-EG'),
            };
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        ws['!cols'] = [
            { wch: 20 }, // SKU
            { wch: 20 }, // Manufacturer
            { wch: 10 }, // Carat
            { wch: 10 }, // Letter
            { wch: 12 }, // Weight
            { wch: 15 }, // Pure Weight
            { wch: 15 }, // Workmanship
            { wch: 18 }, // Price
            { wch: 15 }, // Status
            { wch: 20 }, // Branch
            { wch: 18 }, // Date
        ];
        
        XLSX.utils.book_append_sheet(wb, ws, 'المخزون');
        
        const filename = `inventory_export_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(wb, filename);
        
        showToast('✅ ' + t('common.success'), 'success');
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    }
}

// ============================================
// Expose Globals
// ============================================
window.renderInventory = renderInventory;
window.resetFilters = resetFilters;
window.refreshInventory = loadInventory;
window.showImportModal = showImportModal;
window.exportInventory = exportInventory;
window.editInventoryItem = editInventoryItem;
window.deleteInventoryItem = deleteInventoryItem;