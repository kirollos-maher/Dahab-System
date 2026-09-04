import { fetchData, insertData, updateData, supabase, deleteData } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, debounce,
    getActiveBranchId
} from './utils.js';
import { t } from '../i18n/i18n.js';
import { sanitizeHTML, validateEmail, validatePhone } from './security.js';

// ============================================
// State
// ============================================
let employees = [];
let roles = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'ACCOUNTANT', 'DATA_ENTRY', 'SALESPERSON'];
let branches = [];
let currentEmployee = null;

// ============================================
// Main Render Function
// ============================================
export async function renderEmployees(container) {
    const { data, error } = await supabase
        .from('employees')
        .select('*, branch_id(name)')
        .order('name');
    
    if (error) {
        showToast(t('common.error'), 'error');
        return;
    }
    
    employees = data || [];
    
    const branchData = await fetchData('branches', '*');
    branches = branchData || [];
    
    container.innerHTML = `
        <div class="page-header">
            <h2>👥 ${t('nav.employees')}</h2>
            <div class="page-actions">
                <button class="btn btn-primary" onclick="window.showAddEmployee()">
                    ➕ ${t('common.add')}
                </button>
                <button class="btn btn-outline" onclick="window.refreshEmployees()">
                    🔄 ${t('common.refresh')}
                </button>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h3>${t('nav.employees')}</h3>
                <span class="text-muted">${employees.length} ${t('common.total')}</span>
            </div>
            <div class="card-body no-padding">
                <div class="table-responsive">
                    <table class="inventory-table">
                        <thead>
                            <tr>
                                <th>${t('form.name')}</th>
                                <th>${t('form.phone')}</th>
                                <th>${t('employee.role')}</th>
                                <th>${t('gold.branch')}</th>
                                <th>${t('common.status')}</th>
                                <th>${t('common.date')}</th>
                                <th>${t('common.actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${employees.map(emp => renderEmployeeRow(emp)).join('')}
                            ${employees.length === 0 ? `
                                <tr>
                                    <td colspan="7" class="text-center text-muted">${t('common.no-data')}</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Shift Closure Section -->
        <div class="card mt-16">
            <div class="card-header">
                <h3>${t('employee.shift')}</h3>
                <button class="btn btn-primary btn-sm" onclick="window.startShiftClosure()">
                    🕒 ${t('accounting.shift-open')}
                </button>
            </div>
            <div class="card-body" id="shiftClosureList">
                <div class="text-center text-muted">${t('common.no-data')}</div>
            </div>
        </div>

        <!-- Audit Log Section -->
        <div class="card mt-16">
            <div class="card-header">
                <h3>${t('employee.audit')}</h3>
                <button class="btn btn-outline btn-sm" onclick="window.refreshAuditLog()">
                    🔄 ${t('common.refresh')}
                </button>
            </div>
            <div class="card-body no-padding">
                <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                    <table class="inventory-table">
                        <thead>
                            <tr>
                                <th>${t('form.name')}</th>
                                <th>${t('common.actions')}</th>
                                <th>${t('form.description')}</th>
                                <th>${t('common.date')}</th>
                            </tr>
                        </thead>
                        <tbody id="auditLogBody">
                            <tr>
                                <td colspan="4" class="text-center text-muted">${t('common.loading')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    loadShiftClosures();
    loadAuditLog();

    window.showAddEmployee = showAddEmployee;
    window.refreshEmployees = renderEmployees;
    window.startShiftClosure = startShiftClosure;
    window.refreshAuditLog = loadAuditLog;
    window.editEmployee = editEmployee;
    window.deleteEmployee = deleteEmployee;
    window.toggleEmployeeStatus = toggleEmployeeStatus;
}

// ============================================
// Render Employee Row
// ============================================
function renderEmployeeRow(employee) {
    const roleLabels = {
        SUPER_ADMIN: 'مدير عام',
        BRANCH_MANAGER: 'مدير فرع',
        ACCOUNTANT: 'محاسب',
        DATA_ENTRY: 'مدخل بيانات',
        SALESPERSON: 'مندوب مبيعات'
    };
    
    const branch = branches.find(b => b.id === employee.branch_id);
    const statusClass = employee.is_active ? 'status-in_stock' : 'status-sold';
    const statusText = employee.is_active ? 'نشط' : 'غير نشط';
    
    return `
        <tr>
            <td><strong>${sanitizeHTML(employee.name)}</strong></td>
            <td>${sanitizeHTML(employee.phone || '-')}</td>
            <td><span class="status-badge" style="background: #dbeafe; color: #2563eb;">${roleLabels[employee.role] || employee.role}</span></td>
            <td>${branch ? sanitizeHTML(branch.name) : 'غير معين'}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${new Date(employee.created_at).toLocaleDateString('ar-EG')}</td>
            <td>
                <button class="btn btn-outline btn-sm" onclick="window.editEmployee('${employee.id}')">✏️</button>
                <button class="btn btn-outline btn-sm" onclick="window.toggleEmployeeStatus('${employee.id}')">
                    ${employee.is_active ? '🔴' : '🟢'}
                </button>
                <button class="btn btn-danger btn-sm" onclick="window.deleteEmployee('${employee.id}')">🗑️</button>
            </td>
        </tr>
    `;
}

// ============================================
// Add/Edit Employee Modal
// ============================================
async function showAddEmployee(employeeData = null) {
    const isEdit = !!employeeData;
    const title = isEdit ? 'تعديل موظف' : 'إضافة موظف جديد';
    
    const branchOptions = branches.map(b => 
        `<option value="${b.id}" ${employeeData?.branch_id === b.id ? 'selected' : ''}>${b.name}</option>`
    ).join('');
    
    const roleOptions = roles.map(r => 
        `<option value="${r}" ${employeeData?.role === r ? 'selected' : ''}>${r}</option>`
    ).join('');
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${title}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <form id="employeeForm">
                <input type="hidden" name="id" value="${employeeData?.id || ''}" />
                
                <div class="form-group">
                    <label>${t('form.name')} *</label>
                    <input type="text" name="name" required value="${employeeData?.name || ''}" />
                </div>
                <div class="form-group">
                    <label>${t('form.phone')}</label>
                    <input type="tel" name="phone" value="${employeeData?.phone || ''}" />
                </div>
                <div class="form-group">
                    <label>${t('employee.role')} *</label>
                    <select name="role" required>
                        <option value="">${t('common.select')}</option>
                        ${roleOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>${t('gold.branch')}</label>
                    <select name="branch_id">
                        <option value="">${t('common.no-data')}</option>
                        ${branchOptions}
                    </select>
                </div>
                ${!isEdit ? `
                    <div class="form-group">
                        <label>${t('auth.email')} *</label>
                        <input type="email" name="email" required placeholder="example@domain.com" />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.password')} *</label>
                        <input type="password" name="password" required minlength="8" placeholder="********" />
                        <small class="text-muted">${t('common.required')}</small>
                    </div>
                ` : ''}
                
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
        
        if (!data.name || !data.role) {
            showToast(t('common.required'), 'warning');
            return;
        }
        
        if (!isEdit) {
            if (!data.email || !validateEmail(data.email)) {
                showToast(t('common.error'), 'warning');
                return;
            }
            if (!data.password || data.password.length < 8) {
                showToast(t('common.required'), 'warning');
                return;
            }
        }
        
        try {
            if (isEdit) {
                const payload = {
                    name: data.name,
                    phone: data.phone || null,
                    role: data.role,
                    branch_id: data.branch_id || null,
                };
                await updateData('employees', payload, { id: data.id });
                showToast('✅ ' + t('common.success'), 'success');
            } else {
                const { data: authData, error: authError } = await supabase.auth.admin.createUser({
                    email: data.email,
                    password: data.password,
                    email_confirm: true,
                    user_metadata: { name: data.name }
                });
                
                if (authError) throw authError;
                
                const employeePayload = {
                    auth_id: authData.user.id,
                    name: data.name,
                    phone: data.phone || null,
                    role: data.role,
                    branch_id: data.branch_id || null,
                    is_active: true,
                };
                await insertData('employees', employeePayload);
                showToast('✅ ' + t('common.success'), 'success');
            }
            
            modal.remove();
            renderEmployees(document.getElementById('pageContent'));
        } catch (err) {
            showToast(err.message || '❌ ' + t('common.error'), 'error');
        }
    });
}

async function editEmployee(id) {
    const employee = employees.find(e => e.id === id);
    if (!employee) {
        showToast(t('common.no-data'), 'error');
        return;
    }
    showAddEmployee(employee);
}

async function deleteEmployee(id) {
    if (!confirm(t('modal.confirm-delete'))) return;
    
    try {
        await updateData('employees', { is_active: false }, { id });
        showToast('✅ ' + t('common.success'), 'success');
        renderEmployees(document.getElementById('pageContent'));
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

async function toggleEmployeeStatus(id) {
    const employee = employees.find(e => e.id === id);
    if (!employee) return;
    
    try {
        await updateData('employees', { is_active: !employee.is_active }, { id });
        showToast(`✅ ${employee.is_active ? 'تعطيل' : 'تفعيل'}`, 'success');
        renderEmployees(document.getElementById('pageContent'));
    } catch (err) {
        showToast(err.message || '❌ ' + t('common.error'), 'error');
    }
}

// ============================================
// Shift Closure
// ============================================
async function startShiftClosure() {
    const branchId = getActiveBranchId();
    if (!branchId) {
        showToast(t('common.required'), 'warning');
        return;
    }
    
    const { data: employee, error: empError } = await supabase
        .from('employees')
        .select('id')
        .eq('auth_id', (await supabase.auth.getUser()).data.user.id)
        .single();
    
    if (empError || !employee) {
        showToast(t('common.error'), 'error');
        return;
    }
    
    const { data: openShift, error: shiftError } = await supabase
        .from('shift_closure')
        .select('*')
        .eq('employee_id', employee.id)
        .eq('status', 'open')
        .single();
    
    if (openShift) {
        showCloseShiftModal(openShift);
        return;
    }
    
    const now = new Date().toISOString();
    const shiftData = {
        employee_id: employee.id,
        branch_id: branchId,
        shift_start: now,
        shift_end: now,
        expected_cash: 0,
        actual_cash: 0,
        expected_gold: 0,
        actual_gold: 0,
        status: 'open',
        notes: 'بداية الوردية'
    };
    
    try {
        await insertData('shift_closure', shiftData);
        showToast('✅ ' + t('accounting.shift-open'), 'success');
        loadShiftClosures();
    } catch (err) {
        showToast('❌ ' + t('common.error'), 'error');
    }
}

async function showCloseShiftModal(shift) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${t('accounting.shift-close')}</h3>
                <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
            </div>
            <form id="closeShiftForm">
                <input type="hidden" name="id" value="${shift.id}" />
                
                <div class="form-row">
                    <div class="form-group">
                        <label>${t('suppliers.cash-balance')}</label>
                        <input type="number" name="expected_cash" step="0.01" value="${shift.expected_cash || 0}" readonly />
                    </div>
                    <div class="form-group">
                        <label>${t('common.actual') || 'الفعلي'} *</label>
                        <input type="number" name="actual_cash" step="0.01" required placeholder="0.00" />
                    </div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label>${t('suppliers.gold-balance')}</label>
                        <input type="number" name="expected_gold" step="0.001" value="${shift.expected_gold || 0}" readonly />
                    </div>
                    <div class="form-group">
                        <label>${t('common.actual') || 'الفعلي'} *</label>
                        <input type="number" name="actual_gold" step="0.001" required placeholder="0.000" />
                    </div>
                </div>
                
                <div class="form-group">
                    <label>${t('form.notes')}</label>
                    <textarea name="notes" placeholder="${t('form.notes')}"></textarea>
                </div>
                
                <div class="modal-footer">
                    <button type="button" class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">${t('common.cancel')}</button>
                    <button type="submit" class="btn btn-primary">${t('accounting.shift-close')}</button>
                </div>
            </form>
        </div>
    `;
    
    document.getElementById('modalContainer').appendChild(modal);
    
    modal.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = Object.fromEntries(formData.entries());
        
        const actualCash = parseFloat(data.actual_cash) || 0;
        const actualGold = parseFloat(data.actual_gold) || 0;
        const expectedCash = parseFloat(data.expected_cash) || 0;
        const expectedGold = parseFloat(data.expected_gold) || 0;
        
        const cashVariance = actualCash - expectedCash;
        const goldVariance = actualGold - expectedGold;
        
        const status = (Math.abs(cashVariance) > 1 || Math.abs(goldVariance) > 0.1) ? 'discrepancy' : 'closed';
        
        try {
            await updateData('shift_closure', {
                shift_end: new Date().toISOString(),
                actual_cash: actualCash,
                actual_gold: actualGold,
                cash_variance: cashVariance,
                gold_variance: goldVariance,
                status: status,
                notes: data.notes || '',
            }, { id: data.id });
            
            showToast(`✅ ${t('accounting.shift-close')}${status === 'discrepancy' ? ' ' + t('common.warning') : ''}`, status === 'discrepancy' ? 'warning' : 'success');
            modal.remove();
            loadShiftClosures();
        } catch (err) {
            showToast('❌ ' + t('common.error'), 'error');
        }
    });
}

async function loadShiftClosures() {
    const container = document.getElementById('shiftClosureList');
    if (!container) return;
    
    try {
        const { data, error } = await supabase
            .from('shift_closure')
            .select('*, employees(name)')
            .order('created_at', { ascending: false })
            .limit(10);
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            container.innerHTML = '<div class="text-center text-muted">' + t('common.no-data') + '</div>';
            return;
        }
        
        container.innerHTML = data.map(shift => {
            const statusLabels = {
                open: '🟢 ' + t('accounting.shift-open'),
                closed: '✅ ' + t('common.close'),
                discrepancy: '⚠️ ' + t('common.warning')
            };
            const statusClass = shift.status === 'open' ? 'status-in_stock' : shift.status === 'closed' ? 'status-approved' : 'status-rejected';
            
            return `
                <div class="return-item">
                    <div class="item-info">
                        <div class="sku">${shift.employees?.name || t('common.no-data')}</div>
                        <div class="details">
                            ${new Date(shift.shift_start).toLocaleString('ar-EG')} - ${new Date(shift.shift_end).toLocaleString('ar-EG')}
                        </div>
                        <div class="details">
                            ${t('suppliers.cash-balance')}: ${formatCurrency(shift.actual_cash)} (${formatCurrency(shift.cash_variance)}) |
                            ${t('gold.weight-grams')}: ${formatNumber(shift.actual_gold, 3)} جم (${formatNumber(shift.gold_variance, 3)} جم)
                        </div>
                    </div>
                    <div>
                        <span class="status-badge ${statusClass}">${statusLabels[shift.status] || shift.status}</span>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        console.error('Load shift closures error:', err);
        container.innerHTML = '<div class="text-center text-muted">' + t('common.error') + '</div>';
    }
}

// ============================================
// Audit Log
// ============================================
async function loadAuditLog() {
    const tbody = document.getElementById('auditLogBody');
    if (!tbody) return;
    
    try {
        const { data, error } = await supabase
            .from('audit_log')
            .select('*, employees(name)')
            .order('created_at', { ascending: false })
            .limit(50);
        
        if (error) throw error;
        
        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">' + t('common.no-data') + '</td></tr>';
            return;
        }
        
        tbody.innerHTML = data.map(log => `
            <tr>
                <td>${log.employees?.name || 'نظام'}</td>
                <td>${sanitizeHTML(log.action)}</td>
                <td>${log.details ? JSON.stringify(log.details) : ''}</td>
                <td>${new Date(log.created_at).toLocaleString('ar-EG')}</td>
            </tr>
        `).join('');
        
    } catch (err) {
        console.error('Audit log error:', err);
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">' + t('common.error') + '</td></tr>';
    }
}

// ============================================
// Expose Globals
// ============================================
window.renderEmployees = renderEmployees;
window.showAddEmployee = showAddEmployee;
window.editEmployee = editEmployee;
window.deleteEmployee = deleteEmployee;
window.toggleEmployeeStatus = toggleEmployeeStatus;
window.startShiftClosure = startShiftClosure;
window.loadShiftClosures = loadShiftClosures;
window.loadAuditLog = loadAuditLog;
window.refreshEmployees = renderEmployees;
window.refreshAuditLog = loadAuditLog;