// SPEC section 6 fixtures, as the tests expect to see them through the API.
// Test-only passwords, not real secrets. Shared, frozen after G1.

export const PASSWORDS = {
  hq1: 'TestPass-hq1',
  truck1: 'TestPass-truck1',
  franchise1: 'TestPass-franchise1',
  truck2: 'TestPass-truck2',
  truck_off: 'TestPass-truckoff',
};

export const LOCATIONS = {
  1: { id: 1, name: 'Xpresso HQ Warehouse', type: 'hq' },
  2: { id: 2, name: 'Xpresso Food Truck', type: 'truck' },
  3: { id: 3, name: 'Test Franchise Store', type: 'franchise' },
  4: { id: 4, name: 'Test Truck Two', type: 'truck' },
};

export const USERS = {
  hq1: { id: 1, location: 1, role: 'hq' },
  truck1: { id: 2, location: 2, role: 'truck' },
  franchise1: { id: 3, location: 3, role: 'franchise' },
  truck2: { id: 4, location: 4, role: 'truck' },
};

// Active products only, in API order: category, then sku.
export const ACTIVE_PRODUCTS = [
  { sku: 'DAI006', name: 'Full Cream Milk 2L', category: 'Dairy', unit: 'bottle', moq: 6, franchise: 38.9, cost: 27.35, itemNo: 'MILK2L' },
  { sku: 'HOT011', name: 'Coffee Beans 1kg', category: 'Hot Drinks', unit: 'bag', moq: 1, franchise: 285, cost: 210.5, itemNo: 'BEANS' },
  { sku: 'PKD010', name: 'Paper Cup 250ml x50', category: 'Packaging', unit: 'sleeve', moq: 1, franchise: 95, cost: 61.2, itemNo: 'CUP250' },
  { sku: 'PKD020', name: 'Cup Lid 250ml x50', category: 'Packaging', unit: 'sleeve', moq: 1, franchise: 42, cost: 25.8, itemNo: 'CUPLID' },
  { sku: 'PKD021', name: 'Cup Lid 350ml x50', category: 'Packaging', unit: 'sleeve', moq: 1, franchise: 44, cost: 26.9, itemNo: 'CUPLID' },
  { sku: 'SYR001', name: 'Hazelnut Syrup 750ml', category: 'Syrups', unit: 'bottle', moq: 1, franchise: 120, cost: 84.75, itemNo: null },
];

export const INACTIVE_SKU = 'PKD034';
export const INACTIVE_ITEM_NO = 'CUP34';

// Every fixture cost price in rands (including the inactive PKD034 at 30.00).
export const COST_PRICES = [210.5, 27.35, 61.2, 25.8, 26.9, 84.75, 30];

// The FinCon ItemNos of active products: the only ones the app may request.
export const ACTIVE_ITEM_NOS = ['BEANS', 'MILK2L', 'CUP250', 'CUPLID'];

// Stock statuses the default mock quantities must produce (SPEC section 6).
export const DEFAULT_STATUSES = {
  DAI006: 'low_stock',
  HOT011: 'in_stock',
  PKD010: 'out_of_stock',
  PKD020: 'in_stock',
  PKD021: 'in_stock',
  SYR001: 'in_stock',
};

// SPEC section 6 worked example.
export const WORKED_EXAMPLE = {
  body: { lines: [{ sku: 'HOT011', qty: 2 }, { sku: 'DAI006', qty: 6 }] },
  lines: [
    { sku: 'HOT011', name: 'Coffee Beans 1kg', unit: 'bag', qty: 2, unit_cost: 210.5, line_cost: 421 },
    { sku: 'DAI006', name: 'Full Cream Milk 2L', unit: 'bottle', qty: 6, unit_cost: 27.35, line_cost: 164.1 },
  ],
  cost_total: 585.1,
};

export const STATUSES = ['pending', 'in_process', 'out_for_delivery', 'delivered'];
