import { fetchData, supabase, subscribeToTable } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, 
    getActiveBranchId, debounce
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t, getCurrentLanguage } from '../i18n/i18n.js';

// ============================================
// State
// ============================================
let dashboardState = {
    metrics: {
        totalGoldWeight: 0,
        totalGoldValue: 0,
        totalItems: 0,
        dailySales: 0,
        dailyWeight: 0,
        dailyTransactions: 0,
        supplierDebt: 0,
        clientDebt: 0,
    },
    recentActivity: [],
    subscriptions: [],
    isRealtimeConnected: false,
    lastUpdate: null,
};

// ============================================
// Main Render Function
// ============================================
export async function renderDashboard(container) {
    // Set up realtime connections first
    await setupRealtimeSubscriptions();
    
    // Load initial data
    await refreshDashboardData();
    
    container.innerHTML = `
        <div class="page-header">
            <h2 data-i18n="dashboard.title">📊 ${t('dashboard.title')}</h2>
            <div class="page-actions">
                <div class="realtime-indicator" id="realtimeIndicator">
                    <span class="pulse-dot" id="realtimeDot"></span>
                    <span id="realtimeStatus">${t('common.success')}</span>
                </div>
                <button class="btn btn-outline btn-sm" onclick="window.refreshDashboard()">
                    🔄 ${t('common.refresh')}
                </button>
                <button class="btn btn-outline btn-sm" onclick="window.exportDashboardReport()">
                    📥 ${t('common.export')}
                </button>
            </div>
        </div>

        <!-- Key Metrics -->
        <div class="metric-grid" id="metricGrid">
            <div class="metric-card" id="metricGold">
                <div class="metric-icon">🏦</div>
                <div class="metric-label" data-i18n="dashboard.total-gold">${t('dashboard.total-gold')}</div>
                <div class="metric-value gold" id="totalGoldWeight">0.000 جم</div>
                <div class="metric-value" style="font-size: 18px; color: var(--accent-gold);" id="totalGoldValue">0.00 EGP</div>
            </div>
            
            <div class="metric-card" id="metricSales">
                <div class="metric-icon">💰</div>
                <div class="metric-label" data-i18n="dashboard.daily-sales">${t('dashboard.daily-sales')}</div>
                <div class="metric-value success" id="dailySales">0.00 EGP</div>
                <div style="font-size: 13px; color: var(--text-muted);">
                    <span id="dailyWeight">0.000 جم</span> | 
                    <span id="dailyTransactions">0 ${t('common.total')}</span>
                </div>
            </div>
            
            <div class="metric-card" id="metricSuppliers">
                <div class="metric-icon">🤝</div>
                <div class="metric-label" data-i18n="dashboard.supplier-debt">${t('dashboard.supplier-debt')}</div>
                <div class="metric-value danger" id="supplierDebt">0.00 EGP</div>
                <div style="font-size: 13px; color: var(--text-muted);">
                    <span id="supplierGoldDebt">0.000 جم</span> ${t('gold.weight')}
                </div>
            </div>
            
            <div class="metric-card" id="metricClients">
                <div class="metric-icon">👥</div>
                <div class="metric-label" data-i18n="dashboard.client-debt">${t('dashboard.client-debt')}</div>
                <div class="metric-value" id="clientDebt" style="color: var(--success);">0.00 EGP</div>
                <div style="font-size: 13px; color: var(--text-muted);">
                    <span id="clientGoldDebt">0.000 جم</span> ${t('gold.weight')}
                </div>
            </div>
            
            <div class="metric-card" id="metricInventory">
                <div class="metric-icon">📦</div>
                <div class="metric-label" data-i18n="dashboard.total-items">${t('dashboard.total-items')}</div>
                <div class="metric-value" id="totalItems">0</div>
                <div style="font-size: 13px; color: var(--text-muted);">
                    <span id="inStockItems">0</span> ${t('inventory.in-stock')} | 
                    <span id="soldItems">0</span> ${t('inventory.sold')}
                </div>
            </div>
            
            <div class="metric-card" id="metricActivity">
                <div class="metric-icon">📈</div>
                <div class="metric-label" data-i18n="dashboard.last-update">${t('dashboard.last-update')}</div>
                <div class="metric-value" style="font-size: 20px;" id="lastUpdateTime">--</div>
                <div style="font-size: 13px; color: var(--text-muted);">
                    <span id="updateCount">0</span> ${t('common.refresh')}
                </div>
            </div>
        </div>

        <!-- Charts and Activity -->
        <div class="dashboard-grid">
            <!-- Recent Activity Feed -->
            <div class="chart-card full-width">
                <div class="chart-header">
                    <h3>🔄 ${t('dashboard.recent-activity')}</h3>
                    <span class="text-muted" id="activityCount">0 ${t('common.total')}</span>
                </div>
                <div class="chart-body" style="padding: 0;">
                    <div class="activity-feed" id="activityFeed">
                        <div class="empty-state">
                            <div class="empty-icon">📭</div>
                            <div class="empty-title">${t('common.no-data')}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Update metrics with current data
    updateMetrics();
    updateActivityFeed();

    // Expose globals
    window.refreshDashboard = refreshDashboard;
    window.exportDashboardReport = exportDashboardReport;
}

// ============================================
// Setup Realtime Subscriptions
// ============================================
async function setupRealtimeSubscriptions() {
    // Clean up existing subscriptions
    dashboardState.subscriptions.forEach(sub => {
        if (sub && sub.unsubscribe) {
            try { sub.unsubscribe(); } catch (e) {}
        }
    });
    dashboardState.subscriptions = [];

    try {
        // Subscribe to inventory changes
        const inventoryChannel = supabase
            .channel('public:inventory')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'inventory',
                },
                (payload) => {
                    console.log('🔄 Inventory change detected:', payload);
                    handleInventoryChange(payload);
                }
            )
            .subscribe((status) => {
                console.log('📡 Inventory subscription status:', status);
                updateRealtimeStatus(status === 'SUBSCRIBED');
            });

        dashboardState.subscriptions.push(inventoryChannel);

        // Subscribe to sales changes
        const salesChannel = supabase
            .channel('public:sales')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'sales',
                },
                (payload) => {
                    console.log('🔄 Sales change detected:', payload);
                    handleSalesChange(payload);
                }
            )
            .subscribe((status) => {
                console.log('📡 Sales subscription status:', status);
                updateRealtimeStatus(status === 'SUBSCRIBED');
            });

        dashboardState.subscriptions.push(salesChannel);

        // Subscribe to entity changes (suppliers/clients)
        const entityChannel = supabase
            .channel('public:entities')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'entities',
                },
                (payload) => {
                    console.log('🔄 Entity change detected:', payload);
                    handleEntityChange(payload);
                }
            )
            .subscribe((status) => {
                console.log('📡 Entity subscription status:', status);
            });

        dashboardState.subscriptions.push(entityChannel);

        // Subscribe to branch expenses
        const expenseChannel = supabase
            .channel('public:branch_expenses')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'branch_expenses',
                },
                (payload) => {
                    console.log('🔄 Expense change detected:', payload);
                    refreshDashboardData();
                }
            )
            .subscribe();

        dashboardState.subscriptions.push(expenseChannel);

        showToast('📡 ' + t('common.success'), 'success');

    } catch (err) {
        console.error('Realtime setup error:', err);
        showToast('⚠️ ' + t('common.error'), 'warning');
        updateRealtimeStatus(false);
    }
}

// ============================================
// Realtime Handlers
// ============================================
function handleInventoryChange(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    let activity = {
        type: 'inventory',
        icon: '📦',
        text: '',
        amount: '',
        time: new Date(),
    };

    if (eventType === 'INSERT') {
        activity.text = `${t('common.add')} ${t('inventory.add-item')}: <strong>${newRecord.sku}</strong>`;
        activity.amount = `${formatNumber(newRecord.weight_grams, 3)} جم`;
        showToast(`📦 ${t('common.add')} ${newRecord.sku}`, 'success');
    } else if (eventType === 'UPDATE') {
        if (oldRecord.status !== newRecord.status) {
            const statusLabels = {
                'SOLD': t('inventory.sold'),
                'IN_STOCK': t('inventory.in-stock'),
                'RESERVED': t('inventory.reserved'),
                'IN_TRANSIT': t('inventory.in-transit'),
            };
            activity.text = `${t('common.edit')} ${newRecord.sku} → ${statusLabels[newRecord.status] || newRecord.status}`;
            showToast(`🔄 ${t('common.edit')} ${newRecord.sku}`, 'info');
        } else {
            activity.text = `${t('common.edit')} ${newRecord.sku}`;
        }
        activity.amount = `${formatNumber(newRecord.weight_grams, 3)} جم`;
    } else if (eventType === 'DELETE') {
        activity.text = `${t('common.delete')} ${oldRecord.sku}`;
        activity.amount = '-';
        showToast(`🗑️ ${t('common.delete')} ${oldRecord.sku}`, 'info');
    }

    if (activity.text) {
        addActivity(activity);
    }

    refreshDashboardData();
}

function handleSalesChange(payload) {
    const { eventType, new: newRecord } = payload;

    if (eventType === 'INSERT') {
        const activity = {
            type: 'sale',
            icon: '💰',
            text: `${t('pos.complete-sale')}: <strong>${newRecord.invoice_number}</strong>`,
            amount: formatCurrency(newRecord.total_cash),
            time: new Date(),
        };
        addActivity(activity);
        showToast(`💰 ${t('pos.complete-sale')} ${newRecord.invoice_number}`, 'success');
    } else if (eventType === 'UPDATE') {
        const statusLabels = {
            'APPROVED': `✅ ${t('pos.approved')}`,
            'REJECTED': `❌ ${t('pos.rejected')}`,
            'PENDING_APPROVAL': `⏳ ${t('pos.pending-approval')}`,
        };
        const activity = {
            type: 'sale',
            icon: '📋',
            text: `${t('common.edit')} ${newRecord.invoice_number}: ${statusLabels[newRecord.status] || newRecord.status}`,
            amount: formatCurrency(newRecord.total_cash),
            time: new Date(),
        };
        addActivity(activity);
        showToast(`📋 ${t('common.edit')} ${newRecord.invoice_number}`, 'info');
    }

    refreshDashboardData();
}

function handleEntityChange(payload) {
    const { eventType, new: newRecord } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
        const typeLabel = newRecord.type === 'SUPPLIER' ? t('suppliers.supplier') : t('suppliers.client');
        const activity = {
            type: 'entity',
            icon: '🤝',
            text: `${t('common.edit')} ${typeLabel}: <strong>${newRecord.name}</strong>`,
            amount: formatCurrency(newRecord.cash_balance),
            time: new Date(),
        };
        addActivity(activity);
    }

    refreshDashboardData();
}

// ============================================
// Refresh Dashboard Data
// ============================================
async function refreshDashboardData() {
    try {
        const branchId = getActiveBranchId();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString();

        // 1. Inventory Summary
        let inventoryQuery = supabase
            .from('inventory')
            .select('id, pure_gold_weight, weight_grams, workmanship_per_gram, carat, status');
        
        if (branchId) {
            inventoryQuery = inventoryQuery.eq('branch_id', branchId);
        }
        
        const { data: inventory, error: invError } = await inventoryQuery;
        if (invError) throw invError;

        // 2. Today's Sales
        let salesQuery = supabase
            .from('sales')
            .select('id, total_cash, total_grams, status, created_at')
            .eq('status', 'APPROVED')
            .gte('created_at', todayStr);
        
        if (branchId) {
            salesQuery = salesQuery.eq('branch_id', branchId);
        }
        
        const { data: sales, error: salesError } = await salesQuery;
        if (salesError) throw salesError;

        // 3. Entities (Suppliers & Clients)
        const { data: entities, error: entityError } = await supabase
            .from('entities')
            .select('*');
        
        if (entityError) throw entityError;

        // Calculate metrics
        const goldRate = goldRates['24K'] || 0;
        
        const totalGoldWeight = inventory.reduce((sum, item) => {
            const pureWeight = item.pure_gold_weight || 
                (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
            return sum + pureWeight;
        }, 0);
        
        const totalGoldValue = totalGoldWeight * goldRate;

        const dailySales = sales.reduce((sum, s) => sum + s.total_cash, 0);
        const dailyWeight = sales.reduce((sum, s) => sum + s.total_grams, 0);
        const dailyTransactions = sales.length;

        const suppliers = entities.filter(e => e.type === 'SUPPLIER');
        const clients = entities.filter(e => e.type === 'WHOLESALE_CLIENT');
        
        const supplierDebt = suppliers.reduce((sum, s) => sum + (s.cash_balance > 0 ? s.cash_balance : 0), 0);
        const supplierGoldDebt = suppliers.reduce((sum, s) => sum + (s.gold_gram_balance > 0 ? s.gold_gram_balance : 0), 0);
        
        const clientDebt = clients.reduce((sum, c) => sum + (c.cash_balance < 0 ? Math.abs(c.cash_balance) : 0), 0);
        const clientGoldDebt = clients.reduce((sum, c) => sum + (c.gold_gram_balance < 0 ? Math.abs(c.gold_gram_balance) : 0), 0);

        const totalItems = inventory.length;
        const inStockItems = inventory.filter(i => i.status === 'IN_STOCK').length;
        const soldItems = inventory.filter(i => i.status === 'SOLD').length;

        dashboardState.metrics = {
            totalGoldWeight,
            totalGoldValue,
            totalItems,
            inStockItems,
            soldItems,
            dailySales,
            dailyWeight,
            dailyTransactions,
            supplierDebt,
            supplierGoldDebt,
            clientDebt,
            clientGoldDebt,
        };
        dashboardState.lastUpdate = new Date();

        updateMetrics();
        updateRealtimeStatus(true);

        const activityCount = document.getElementById('activityCount');
        if (activityCount) {
            activityCount.textContent = dashboardState.recentActivity.length + ' ' + t('common.total');
        }

        const lastUpdateEl = document.getElementById('lastUpdateTime');
        if (lastUpdateEl) {
            lastUpdateEl.textContent = dashboardState.lastUpdate.toLocaleTimeString(
                getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US'
            );
        }

        const updateCountEl = document.getElementById('updateCount');
        if (updateCountEl) {
            const current = parseInt(updateCountEl.textContent) || 0;
            updateCountEl.textContent = current + 1;
        }

    } catch (err) {
        console.error('Refresh dashboard error:', err);
        showToast('❌ ' + t('common.error'), 'error');
    }
}

// ============================================
// Update UI Metrics
// ============================================
function updateMetrics() {
    const m = dashboardState.metrics;

    document.getElementById('totalGoldWeight').textContent = formatNumber(m.totalGoldWeight, 3) + ' جم';
    document.getElementById('totalGoldValue').textContent = formatCurrency(m.totalGoldValue);
    document.getElementById('dailySales').textContent = formatCurrency(m.dailySales);
    document.getElementById('dailyWeight').textContent = formatNumber(m.dailyWeight, 3) + ' جم';
    document.getElementById('dailyTransactions').textContent = m.dailyTransactions + ' ' + t('common.total');
    document.getElementById('supplierDebt').textContent = formatCurrency(m.supplierDebt);
    document.getElementById('supplierGoldDebt').textContent = formatNumber(m.supplierGoldDebt, 3);
    document.getElementById('clientDebt').textContent = formatCurrency(m.clientDebt);
    document.getElementById('clientGoldDebt').textContent = formatNumber(m.clientGoldDebt, 3);
    document.getElementById('totalItems').textContent = m.totalItems;
    document.getElementById('inStockItems').textContent = m.inStockItems;
    document.getElementById('soldItems').textContent = m.soldItems;

    document.querySelectorAll('.metric-card').forEach(card => {
        card.classList.remove('metric-flash');
        void card.offsetWidth;
        card.classList.add('metric-flash');
    });
}

// ============================================
// Activity Feed
// ============================================
function addActivity(activity) {
    dashboardState.recentActivity.unshift({
        ...activity,
        id: Date.now() + Math.random(),
    });

    if (dashboardState.recentActivity.length > 50) {
        dashboardState.recentActivity = dashboardState.recentActivity.slice(0, 50);
    }

    updateActivityFeed();
}

function updateActivityFeed() {
    const feed = document.getElementById('activityFeed');
    if (!feed) return;

    const activities = dashboardState.recentActivity;

    if (activities.length === 0) {
        feed.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📭</div>
                <div class="empty-title">${t('common.no-data')}</div>
            </div>
        `;
        return;
    }

    feed.innerHTML = activities.map(activity => `
        <div class="activity-item">
            <div class="activity-icon">${activity.icon || '📌'}</div>
            <div class="activity-content">
                <div class="activity-text">${activity.text}</div>
                <div class="activity-time">${formatTimeAgo(activity.time)}</div>
            </div>
            ${activity.amount ? `<div class="activity-amount gold">${activity.amount}</div>` : ''}
        </div>
    `).join('');
}

function formatTimeAgo(date) {
    const now = new Date();
    const diff = Math.floor((now - new Date(date)) / 1000);

    if (diff < 60) return t('time.now');
    if (diff < 3600) return Math.floor(diff / 60) + ' ' + t('time.minutes');
    if (diff < 86400) return Math.floor(diff / 3600) + ' ' + t('time.hours');
    return Math.floor(diff / 86400) + ' ' + t('time.days');
}

// ============================================
// Realtime Status
// ============================================
function updateRealtimeStatus(connected) {
    dashboardState.isRealtimeConnected = connected;
    
    const dot = document.getElementById('realtimeDot');
    const status = document.getElementById('realtimeStatus');
    
    if (dot) {
        dot.className = 'pulse-dot' + (connected ? '' : ' disconnected');
    }
    if (status) {
        status.textContent = connected ? t('common.success') : t('common.error');
        status.style.color = connected ? 'var(--success)' : 'var(--danger)';
    }
}

// ============================================
// Export Dashboard Report
// ============================================
async function exportDashboardReport() {
    try {
        const m = dashboardState.metrics;
        
        const reportData = {
            [t('dashboard.title')]: '',
            [t('common.date')]: new Date().toLocaleDateString(getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US'),
            [t('common.time')]: new Date().toLocaleTimeString(getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US'),
            '': '',
            [t('dashboard.total-gold')]: formatNumber(m.totalGoldWeight, 3) + ' جم',
            [t('gold.market-value')]: formatCurrency(m.totalGoldValue),
            [t('dashboard.daily-sales')]: formatCurrency(m.dailySales),
            [t('gold.weight-grams')]: formatNumber(m.dailyWeight, 3) + ' جم',
            [t('common.total')]: m.dailyTransactions,
            [t('dashboard.supplier-debt')]: formatCurrency(m.supplierDebt),
            [t('suppliers.gold-balance')]: formatNumber(m.supplierGoldDebt, 3) + ' جم',
            [t('dashboard.client-debt')]: formatCurrency(m.clientDebt),
            [t('suppliers.gold-balance')]: formatNumber(m.clientGoldDebt, 3) + ' جم',
            [t('dashboard.total-items')]: m.totalItems,
            [t('inventory.in-stock')]: m.inStockItems,
            [t('inventory.sold')]: m.soldItems,
            '': '',
            [t('dashboard.last-update')]: dashboardState.lastUpdate?.toLocaleString(getCurrentLanguage() === 'ar' ? 'ar-EG' : 'en-US') || '--',
        };

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet([reportData]);
        XLSX.utils.book_append_sheet(wb, ws, t('dashboard.title'));
        XLSX.writeFile(wb, `dashboard_report_${new Date().toISOString().slice(0,10)}.xlsx`);
        
        showToast('✅ ' + t('common.success'), 'success');
    } catch (err) {
        showToast('❌ ' + t('common.error'), 'error');
    }
}

// ============================================
// Cleanup
// ============================================
window.addEventListener('beforeunload', () => {
    dashboardState.subscriptions.forEach(sub => {
        if (sub && sub.unsubscribe) {
            try { sub.unsubscribe(); } catch (e) {}
        }
    });
    dashboardState.subscriptions = [];
});

// ============================================
// Expose Globals
// ============================================
window.renderDashboard = renderDashboard;
window.refreshDashboard = refreshDashboard;
window.exportDashboardReport = exportDashboardReport;