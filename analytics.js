import { fetchData, supabase } from '../lib/supabase.js';
import { 
    showToast, formatCurrency, formatNumber, 
    getActiveBranchId, debounce
} from './utils.js';
import { CARATS, goldRates } from '../config.js';
import { t } from '../i18n/i18n.js';

// ============================================
// State
// ============================================
let charts = {};
let analyticsData = {};
let isInitialized = false;

// ============================================
// Main Render Function
// ============================================
export async function renderAnalytics(container) {
    container.innerHTML = `
        <div class="page-header">
            <h2>📈 ${t('analytics.title')}</h2>
            <div class="page-actions">
                <button class="btn btn-outline btn-sm" onclick="window.refreshAnalytics()">
                    🔄 ${t('common.refresh')}
                </button>
                <button class="btn btn-outline btn-sm" onclick="window.exportAnalyticsReport()">
                    📥 ${t('common.export')}
                </button>
            </div>
        </div>

        <!-- Summary Stats -->
        <div class="analytics-stats" id="analyticsStats">
            <div class="analytics-stat">
                <div class="stat-value" id="statTotalItems">0</div>
                <div class="stat-label">${t('dashboard.total-items')}</div>
            </div>
            <div class="analytics-stat">
                <div class="stat-value" id="statTotalValue">0 EGP</div>
                <div class="stat-label">${t('gold.market-value')}</div>
            </div>
            <div class="analytics-stat">
                <div class="stat-value" id="statTotalSales">0 EGP</div>
                <div class="stat-label">${t('report.gross-sales')}</div>
            </div>
            <div class="analytics-stat">
                <div class="stat-value danger" id="statDeadStock">0</div>
                <div class="stat-label">${t('analytics.dead-stock')}</div>
            </div>
            <div class="analytics-stat">
                <div class="stat-value success" id="statFastMoving">0</div>
                <div class="stat-label">${t('analytics.fast-moving')}</div>
            </div>
            <div class="analytics-stat">
                <div class="stat-value" id="statAvgDays">0</div>
                <div class="stat-label">${t('common.average') || 'متوسط'}</div>
            </div>
        </div>

        <!-- Charts Grid -->
        <div class="analytics-grid">
            <!-- Sales vs Gold Rate Trend -->
            <div class="chart-card full-width">
                <div class="chart-header">
                    <h3>📉 ${t('analytics.sales-trend')}</h3>
                    <div class="chart-actions">
                        <button class="btn btn-outline btn-sm" onclick="window.toggleChart('trend')">
                            🔄 ${t('common.toggle') || 'تبديل'}
                        </button>
                    </div>
                </div>
                <div class="chart-body">
                    <div class="chart-container tall">
                        <canvas id="trendChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Inventory Carat Distribution -->
            <div class="chart-card half-width">
                <div class="chart-header">
                    <h3>🍩 ${t('analytics.carat-distribution')}</h3>
                </div>
                <div class="chart-body">
                    <div class="chart-container">
                        <canvas id="caratChart"></canvas>
                    </div>
                </div>
            </div>

            <!-- Top Salespeople Leaderboard -->
            <div class="chart-card half-width">
                <div class="chart-header">
                    <h3>🏆 ${t('analytics.salespeople')}</h3>
                </div>
                <div class="chart-body">
                    <div class="chart-container">
                        <canvas id="salespeopleChart"></canvas>
                    </div>
                </div>
            </div>
        </div>

        <!-- Intelligence Metrics -->
        <div class="intelligence-grid">
            <!-- Fast Moving Items -->
            <div class="intelligence-card">
                <div class="intel-header">
                    <h4>⚡ ${t('analytics.fast-moving')}</h4>
                    <span class="text-muted" id="fastCount">${t('common.last') || 'آخر'} 30 ${t('time.days')}</span>
                </div>
                <div class="intel-body" id="fastMovingList">
                    <div class="text-center text-muted" style="padding: 20px;">
                        ${t('common.loading')}
                    </div>
                </div>
            </div>

            <!-- Dead Stock / Stagnant Items -->
            <div class="intelligence-card">
                <div class="intel-header">
                    <h4>🐌 ${t('analytics.dead-stock')}</h4>
                    <span class="text-muted" id="deadCount">> 90 ${t('time.days')}</span>
                </div>
                <div class="intel-body" id="deadStockList">
                    <div class="text-center text-muted" style="padding: 20px;">
                        ${t('common.loading')}
                    </div>
                </div>
            </div>
        </div>
    `;

    await loadAnalyticsData();
    initializeCharts();
    
    window.refreshAnalytics = refreshAnalytics;
    window.toggleChart = toggleChart;
    window.exportAnalyticsReport = exportAnalyticsReport;
    
    isInitialized = true;
    
    if (window._analyticsInterval) {
        clearInterval(window._analyticsInterval);
    }
    window._analyticsInterval = setInterval(refreshAnalytics, 60000);
}

// ============================================
// Load Analytics Data
// ============================================
async function loadAnalyticsData() {
    try {
        const branchId = getActiveBranchId();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        
        // 1. Inventory Data
        let inventoryQuery = supabase
            .from('inventory')
            .select('*');
        
        if (branchId) {
            inventoryQuery = inventoryQuery.eq('branch_id', branchId);
        }
        
        const { data: inventory, error: invError } = await inventoryQuery;
        if (invError) throw invError;
        
        // 2. Sales Data (last 30 days)
        let salesQuery = supabase
            .from('sales')
            .select('*')
            .eq('status', 'APPROVED')
            .gte('created_at', thirtyDaysAgo.toISOString());
        
        if (branchId) {
            salesQuery = salesQuery.eq('branch_id', branchId);
        }
        
        const { data: sales, error: salesError } = await salesQuery;
        if (salesError) throw salesError;
        
        // 3. Gold Rate History (mock for trend)
        const goldRateHistory = generateGoldRateHistory(30);
        
        // 4. Sales by salesperson
        let salespersonQuery = supabase
            .from('sales')
            .select('salesperson_name, total_cash')
            .eq('status', 'APPROVED')
            .gte('created_at', thirtyDaysAgo.toISOString());
        
        if (branchId) {
            salespersonQuery = salespersonQuery.eq('branch_id', branchId);
        }
        
        const { data: salespeople, error: spError } = await salespersonQuery;
        if (spError) throw spError;
        
        // 5. Sale items for fast moving
        let saleItemsQuery = supabase
            .from('sale_items')
            .select('inventory_id(sku, carat, manufacturer_id(name), weight_grams), created_at')
            .gte('created_at', thirtyDaysAgo.toISOString());
        
        const { data: saleItems, error: siError } = await saleItemsQuery;
        if (siError) throw siError;
        
        // 6. Dead stock (items > 90 days in inventory)
        const deadStock = inventory.filter(item => {
            const createdDate = new Date(item.created_at);
            const daysOld = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
            return daysOld > 90 && item.status === 'IN_STOCK';
        });
        
        // Store data
        analyticsData = {
            inventory: inventory || [],
            sales: sales || [],
            goldRateHistory: goldRateHistory,
            salespeople: salespeople || [],
            saleItems: saleItems || [],
            deadStock: deadStock || [],
            totalItems: inventory?.length || 0,
            totalValue: calculateInventoryValue(inventory),
            totalSales: sales?.reduce((sum, s) => sum + s.total_cash, 0) || 0,
            avgDays: calculateAverageDays(inventory),
        };
        
        updateSummaryStats();
        updateFastMovingList();
        updateDeadStockList();
        
        return analyticsData;
    } catch (err) {
        console.error('Load analytics error:', err);
        showToast('❌ ' + t('common.error'), 'error');
        throw err;
    }
}

// ============================================
// Helper Functions
// ============================================
function calculateInventoryValue(inventory) {
    const goldRate = goldRates['24K'] || 0;
    return inventory.reduce((sum, item) => {
        const pureWeight = item.pure_gold_weight || 
            (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
        const value = pureWeight * goldRate + (item.weight_grams * item.workmanship_per_gram);
        return sum + value;
    }, 0);
}

function calculateAverageDays(inventory) {
    if (inventory.length === 0) return 0;
    const totalDays = inventory.reduce((sum, item) => {
        const createdDate = new Date(item.created_at);
        return sum + Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    }, 0);
    return Math.round(totalDays / inventory.length);
}

function generateGoldRateHistory(days) {
    const history = [];
    const baseRate = goldRates['24K'] || 2800;
    const now = new Date();
    
    for (let i = days; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const variation = (Math.random() - 0.5) * 100;
        const rate = Math.max(baseRate + variation, 2000);
        history.push({
            date: date.toISOString().slice(0, 10),
            rate: rate,
        });
    }
    return history;
}

function updateSummaryStats() {
    document.getElementById('statTotalItems').textContent = analyticsData.totalItems;
    document.getElementById('statTotalValue').textContent = formatCurrency(analyticsData.totalValue);
    document.getElementById('statTotalSales').textContent = formatCurrency(analyticsData.totalSales);
    document.getElementById('statDeadStock').textContent = analyticsData.deadStock.length;
    document.getElementById('statFastMoving').textContent = analyticsData.saleItems?.length || 0;
    document.getElementById('statAvgDays').textContent = analyticsData.avgDays + ' ' + t('time.days');
}

// ============================================
// Initialize Charts
// ============================================
function initializeCharts() {
    Object.keys(charts).forEach(key => {
        if (charts[key]) {
            charts[key].destroy();
            delete charts[key];
        }
    });
    
    createTrendChart();
    createCaratChart();
    createSalespeopleChart();
}

function createTrendChart() {
    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    
    const sales = analyticsData.sales || [];
    const goldHistory = analyticsData.goldRateHistory || [];
    
    const salesByDate = {};
    sales.forEach(s => {
        const date = new Date(s.created_at).toISOString().slice(0, 10);
        if (!salesByDate[date]) {
            salesByDate[date] = 0;
        }
        salesByDate[date] += s.total_cash;
    });
    
    const dates = goldHistory.map(h => h.date);
    const goldRatesData = goldHistory.map(h => h.rate);
    const salesData = dates.map(d => salesByDate[d] || 0);
    
    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: t('report.gross-sales'),
                    data: salesData,
                    borderColor: '#d4a843',
                    backgroundColor: 'rgba(212, 168, 67, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointBackgroundColor: '#d4a843',
                    yAxisID: 'y',
                },
                {
                    label: t('gold.gold-rate'),
                    data: goldRatesData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointBackgroundColor: '#3b82f6',
                    yAxisID: 'y1',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 11 },
                        boxWidth: 12,
                        padding: 12,
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            let value = context.parsed.y;
                            if (context.dataset.label.includes(t('report.gross-sales'))) {
                                return label + ': ' + formatCurrency(value);
                            } else {
                                return label + ': ' + formatCurrency(value) + '/' + t('unit.gram');
                            }
                        }
                    }
                }
            },
            scales: {
                y: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    grid: {
                        drawOnChartArea: false,
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

function createCaratChart() {
    const ctx = document.getElementById('caratChart');
    if (!ctx) return;
    
    const inventory = analyticsData.inventory || [];
    const caratCounts = {};
    Object.keys(CARATS).forEach(c => caratCounts[c] = 0);
    
    inventory.forEach(item => {
        if (caratCounts[item.carat] !== undefined) {
            caratCounts[item.carat]++;
        }
    });
    
    const labels = Object.keys(CARATS);
    const data = labels.map(c => caratCounts[c] || 0);
    const colors = ['#d4a843', '#c49a3a', '#b8922f', '#a88225', '#9a721a'];
    
    charts.carat = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: 'var(--bg-card)',
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        font: { size: 12 },
                        boxWidth: 12,
                        padding: 10,
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
                            return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
                        }
                    }
                }
            }
        }
    });
}

function createSalespeopleChart() {
    const ctx = document.getElementById('salespeopleChart');
    if (!ctx) return;
    
    const salespeople = analyticsData.salespeople || [];
    
    const salesByPerson = {};
    salespeople.forEach(s => {
        if (!salesByPerson[s.salesperson_name]) {
            salesByPerson[s.salesperson_name] = 0;
        }
        salesByPerson[s.salesperson_name] += s.total_cash;
    });
    
    const sorted = Object.entries(salesByPerson)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    const labels = sorted.map(item => item[0] || t('common.no-data'));
    const data = sorted.map(item => item[1]);
    const colors = data.map((_, i) => {
        const hue = 40 - (i * 3);
        return `hsl(${hue}, 70%, 50%)`;
    });
    
    charts.salespeople = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: t('report.gross-sales'),
                data: data,
                backgroundColor: colors,
                borderColor: colors.map(c => c),
                borderWidth: 1,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return formatCurrency(context.parsed.x);
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
}

// ============================================
// Fast Moving Items
// ============================================
function updateFastMovingList() {
    const container = document.getElementById('fastMovingList');
    const count = document.getElementById('fastCount');
    
    const saleItems = analyticsData.saleItems || [];
    
    const skuCounts = {};
    saleItems.forEach(item => {
        const sku = item.inventory_id?.sku || 'unknown';
        if (!skuCounts[sku]) {
            skuCounts[sku] = {
                count: 0,
                sku: sku,
                carat: item.inventory_id?.carat || 'N/A',
                manufacturer: item.inventory_id?.manufacturer_id?.name || 'N/A',
            };
        }
        skuCounts[sku].count++;
    });
    
    const sorted = Object.values(skuCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    
    if (count) count.textContent = sorted.length + ' ' + t('common.total');
    
    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted" style="padding: 20px;">
                📭 ${t('common.no-data')}
            </div>
        `;
        return;
    }
    
    container.innerHTML = sorted.map((item, index) => `
        <div class="fast-item">
            <div class="item-info">
                <div class="item-name">#${index + 1} ${item.sku}</div>
                <div class="item-detail">${item.carat} | ${item.manufacturer}</div>
            </div>
            <div class="item-stats">
                <div class="count">${item.count}</div>
                <div class="label">${t('common.total')}</div>
            </div>
        </div>
    `).join('');
}

// ============================================
// Dead Stock / Stagnant Items
// ============================================
function updateDeadStockList() {
    const container = document.getElementById('deadStockList');
    const count = document.getElementById('deadCount');
    
    const deadStock = analyticsData.deadStock || [];
    const goldRate = goldRates['24K'] || 0;
    
    const sorted = deadStock.sort((a, b) => {
        const daysA = Math.floor((Date.now() - new Date(a.created_at).getTime()) / (1000 * 60 * 60 * 24));
        const daysB = Math.floor((Date.now() - new Date(b.created_at).getTime()) / (1000 * 60 * 60 * 24));
        return daysB - daysA;
    });
    
    if (count) count.textContent = sorted.length + ' ' + t('common.total');
    
    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted" style="padding: 20px; color: var(--success);">
                ✅ ${t('common.no-data')}
            </div>
        `;
        return;
    }
    
    container.innerHTML = sorted.map(item => {
        const createdDate = new Date(item.created_at);
        const daysOld = Math.floor((Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
        const pureWeight = item.pure_gold_weight || 
            (item.weight_grams * (CARATS[item.carat]?.ratio || 0));
        const capital = pureWeight * goldRate + (item.weight_grams * item.workmanship_per_gram);
        
        let severity = 'severity-low';
        if (daysOld > 180) severity = 'severity-high';
        else if (daysOld > 120) severity = 'severity-medium';
        
        return `
            <div class="dead-stock-item ${severity}">
                <div class="stock-info">
                    <div class="sku">${item.sku}</div>
                    <div class="detail">${item.carat} | ${item.letter_code} | ${formatNumber(item.weight_grams, 3)} جم</div>
                    <div class="days-old">${daysOld} ${t('time.days')}</div>
                </div>
                <div class="stock-value">
                    <div class="capital">${formatCurrency(capital)}</div>
                    <div class="weight">${formatNumber(pureWeight, 3)} جم</div>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// Refresh & Toggle
// ============================================
async function refreshAnalytics() {
    showToast('🔄 ' + t('common.refresh'), 'info');
    await loadAnalyticsData();
    initializeCharts();
    showToast('✅ ' + t('common.success'), 'success');
}

function toggleChart(chartName) {
    if (chartName === 'trend' && charts.trend) {
        const currentType = charts.trend.config.type;
        const newType = currentType === 'line' ? 'bar' : 'line';
        charts.trend.config.type = newType;
        charts.trend.update();
        showToast(`🔄 ${t('common.toggle')}`, 'info');
    }
}

// ============================================
// Export Report
// ============================================
async function exportAnalyticsReport() {
    try {
        const data = {
            'تقرير التحليلات': '',
            'تاريخ التقرير': new Date().toLocaleDateString('ar-EG'),
            '': '',
            'ملخص': '',
            'إجمالي القطع': analyticsData.totalItems,
            'قيمة المخزون': analyticsData.totalValue,
            'إجمالي المبيعات (30 يوم)': analyticsData.totalSales,
            'المخزون الراكد': analyticsData.deadStock.length,
            'متوسط أيام التخزين': analyticsData.avgDays,
            '': '',
            'توزيع العيارات': '',
        };
        
        const inventory = analyticsData.inventory || [];
        const caratCounts = {};
        Object.keys(CARATS).forEach(c => caratCounts[c] = 0);
        inventory.forEach(item => {
            if (caratCounts[item.carat] !== undefined) {
                caratCounts[item.carat]++;
            }
        });
        
        Object.keys(CARATS).forEach(c => {
            data[`قطعة ${c}`] = caratCounts[c] || 0;
        });
        
        data[''] = '';
        data['المخزون الراكد (تفصيل)'] = '';
        
        analyticsData.deadStock.forEach((item, index) => {
            const daysOld = Math.floor((Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60 * 24));
            data[`الراكد ${index + 1}`] = `${item.sku} - ${daysOld} ${t('time.days')} - ${formatCurrency(item.pure_gold_weight * (goldRates['24K'] || 0))}`;
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet([data]);
        XLSX.utils.book_append_sheet(wb, ws, 'تحليلات');
        XLSX.writeFile(wb, `analytics_report_${new Date().toISOString().slice(0,10)}.xlsx`);
        
        showToast('✅ ' + t('common.success'), 'success');
    } catch (err) {
        showToast('❌ ' + t('common.error') + ': ' + err.message, 'error');
    }
}

// ============================================
// Cleanup
// ============================================
window.addEventListener('beforeunload', () => {
    if (window._analyticsInterval) {
        clearInterval(window._analyticsInterval);
    }
    Object.keys(charts).forEach(key => {
        if (charts[key]) {
            charts[key].destroy();
        }
    });
});

// ============================================
// Expose Globals
// ============================================
window.renderAnalytics = renderAnalytics;
window.refreshAnalytics = refreshAnalytics;
window.toggleChart = toggleChart;
window.exportAnalyticsReport = exportAnalyticsReport;