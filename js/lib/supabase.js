import { SUPABASE_CONFIG } from '../config.js';
import { getActiveBranchId } from '../config.js';

// Initialize Supabase client
const { createClient } = supabase;

export const supabase = createClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.anonKey
);

/**
 * Fetch data with branch isolation
 * Automatically filters by active branch ID
 */
export async function fetchData(table, select = '*', filter = null, order = null) {
    let query = supabase.from(table).select(select);
    
    // Apply branch filter if table has branch_id column
    const branchId = getActiveBranchId();
    if (branchId && ['inventory', 'sales', 'purchases', 'branch_expenses', 'shifts', 'shift_closure'].includes(table)) {
        query = query.eq('branch_id', branchId);
    }
    
    if (filter) {
        query = query.match(filter);
    }
    
    if (order) {
        query = query.order(order.column, { ascending: order.ascending ?? false });
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

/**
 * Insert data with branch isolation
 */
export async function insertData(table, data) {
    const branchId = getActiveBranchId();
    if (branchId && ['inventory', 'sales', 'purchases', 'branch_expenses', 'shifts', 'shift_closure'].includes(table)) {
        data.branch_id = branchId;
    }
    
    const { data: result, error } = await supabase
        .from(table)
        .insert(data)
        .select();
    if (error) throw error;
    return result;
}

/**
 * Update data with branch isolation
 */
export async function updateData(table, data, match) {
    const branchId = getActiveBranchId();
    if (branchId && ['inventory', 'sales', 'purchases', 'branch_expenses', 'shifts', 'shift_closure'].includes(table)) {
        data.branch_id = branchId;
    }
    
    const { data: result, error } = await supabase
        .from(table)
        .update(data)
        .match(match)
        .select();
    if (error) throw error;
    return result;
}

/**
 * Delete data (soft delete only for critical tables)
 */
export async function deleteData(table, match) {
    // Prevent hard delete on critical tables
    const protectedTables = ['sales', 'entity_ledger', 'inventory', 'employees'];
    if (protectedTables.includes(table)) {
        // Soft delete by marking as deleted
        const { data: result, error } = await supabase
            .from(table)
            .update({ deleted: true, deleted_at: new Date().toISOString() })
            .match(match)
            .select();
        if (error) throw error;
        return result;
    }
    
    const { error } = await supabase
        .from(table)
        .delete()
        .match(match);
    if (error) throw error;
    return true;
}

/**
 * Subscribe to realtime changes with branch isolation
 */
export function subscribeToTable(table, callback, filter = null) {
    const branchId = getActiveBranchId();
    let channel = supabase
        .channel(`public:${table}`);
    
    // Build filter
    let filterObj = {};
    if (branchId && ['inventory', 'sales', 'purchases', 'branch_expenses', 'shifts', 'shift_closure'].includes(table)) {
        filterObj.branch_id = branchId;
    }
    if (filter) {
        filterObj = { ...filterObj, ...filter };
    }
    
    channel = channel.on(
        'postgres_changes',
        {
            event: '*',
            schema: 'public',
            table: table,
            filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
        },
        (payload) => callback(payload)
    );
    
    return channel.subscribe();
}