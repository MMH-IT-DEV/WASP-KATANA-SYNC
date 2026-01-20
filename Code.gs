// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  WASP_BASE_URL: 'https://mymagichealer.waspinventorycloud.com',
  WASP_TOKEN: PropertiesService.getScriptProperties().getProperty('WASP_TOKEN'),
  KATANA_API_KEY: '2e56f8e8-fb41-4686-8e22-4bb8be576199',
  SLACK_WEBHOOK_URL: PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL')
};

// ============================================
// DEBUG LOGGING TO SHEET
// ============================================
const DEBUG_SHEET_ID = '1eX7MCU-Is5CMmROL1PfuhGoB73yRF7dYdyXHqzMYOUQ';

function logToSheet(eventType, data, result) {
  try {
    const sheet = SpreadsheetApp.openById(DEBUG_SHEET_ID).getActiveSheet();
    sheet.appendRow([
      new Date().toISOString(),
      eventType,
      JSON.stringify(data).substring(0, 50000),
      JSON.stringify(result).substring(0, 50000)
    ]);
  } catch (e) {
    Logger.log('Sheet logging error: ' + e.message);
  }
}

// ============================================
// WEBHOOK RECEIVER
// ============================================

/**
 * Health check endpoint
 */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Main webhook receiver
 */
function doPost(e) {
  try {
    logToSheet('CONFIG_CHECK', {hasWaspToken: !!CONFIG.WASP_TOKEN, tokenLength: CONFIG.WASP_TOKEN?.length || 0}, {});
    
    // Log raw request first for debugging
    logToSheet('RAW_REQUEST', {
      contentType: e.postData?.type,
      contentLength: e.postData?.length,
      contents: e.postData?.contents?.substring(0, 1000)
    }, {});
    
    const rawPayload = e.postData?.contents;
    
    if (!rawPayload) {
      logToSheet('ERROR', {error: 'No payload contents'}, {status: 'failed'});
      return ContentService.createTextOutput(JSON.stringify({error: 'No payload'})).setMimeType(ContentService.MimeType.JSON);
    }
    
    let payload;
    try {
      payload = JSON.parse(rawPayload);
    } catch (parseError) {
      logToSheet('PARSE_ERROR', {error: parseError.message, raw: rawPayload?.substring(0, 500)}, {status: 'failed'});
      return ContentService.createTextOutput(JSON.stringify({error: 'JSON parse failed'})).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Detect source - Katana uses "action", WASP uses "source"/"event" field
    let eventType;
    if (payload.source === 'WASP') {
      eventType = payload.event;
    } else {
      eventType = payload.action || payload.event || payload.type || 'unknown';
    }
    
    logToSheet(eventType + '_RAW', payload, {status: 'received'});
    
    Logger.log('Received webhook: ' + eventType);
    
    let result;
    
    switch(eventType) {
      case 'purchase_order.created':
        result = handlePurchaseOrderCreated(payload);
        break;
      case 'purchase_order.received':
        result = handlePurchaseOrderReceived(payload);
        break;
      case 'sales_order.delivered':
        result = handleSalesOrderDelivered(payload);
        break;
      case 'manufacturing_order.done':
        result = handleManufacturingOrderDone(payload);
        break;
      case 'quantity_added':
        result = handleWaspQuantityAdded(payload);
        break;
      case 'quantity_removed':
        result = handleWaspQuantityRemoved(payload);
        break;
      default:
        result = { status: 'ignored', event: eventType };
    }
    
    logToSheet(eventType + '_RESULT', payload, result);
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    logToSheet('ERROR', {error: error.message}, {status: 'failed'});
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================
// EVENT HANDLERS
// ============================================

/**
 * Handle PO Created event
 */
function handlePurchaseOrderCreated(payload) {
  const poId = payload.object?.id;
  logToSheet('PO_CREATED_LOG', payload, { poId: poId });
  sendSlackNotification('📋 PO Created in Katana\nID: ' + poId);
  return { status: 'logged', poId: poId };
}

/**
 * Handle PO Received event - Full sync to WASP
 */
function handlePurchaseOrderReceived(payload) {
  const poId = payload.object?.id;
  
  if (!poId) {
    logToSheet('PO_RECEIVED_ERROR', payload, {error: 'No PO ID found'});
    return { status: 'error', message: 'No PO ID in webhook' };
  }
  
  // 1. Fetch PO header
  const poData = fetchKatanaPO(poId);
  if (!poData) return { status: 'error', message: 'Failed to fetch PO header' };
  
  // 2. Fetch PO rows
  const poRowsData = fetchKatanaPORows(poId);
  if (!poRowsData) return { status: 'error', message: 'Failed to fetch PO rows' };
  
  const rows = poRowsData.data || poRowsData || [];
  const results = [];
  
  // 3. Process each row
  for (const row of rows) {
    const variantId = row.variant_id;
    const quantity = row.quantity;
    
    // Fetch variant to get SKU
    const variant = fetchKatanaVariant(variantId);
    const sku = variant?.sku;
    
    logToSheet('PO_ROW_PROCESSING', { variantId: variantId, sku: sku, qty: quantity }, row);
    
    if (sku && quantity > 0) {
      const poNumber = poData.order_no || ('PO-' + poId);
      const lotNumber = poNumber.replace(/[^a-zA-Z0-9-]/g, ''); // Clean special chars
      
      const result = waspAddInventoryWithLot(
        sku,
        quantity,
        'RECEIVING-DOCK',
        lotNumber,  // PO number as lot
        '',         // Let function generate default expiry
        'PO Received: ' + poNumber
      );
      results.push({ sku: sku, quantity: quantity, result: result });
      logToSheet('WASP_ADD_RESULT', { sku: sku, quantity: quantity }, result);
    } else {
      logToSheet('PO_ROW_SKIPPED', { sku: sku, quantity: quantity }, { reason: 'Missing SKU or zero quantity' });
    }
  }
  
  sendSlackNotification('📦 PO Received: ' + (poData.order_no || poId) + ' - ' + results.length + ' items processed');
  
  return { status: 'processed', poId: poId, itemsProcessed: results.length, results: results };
}

/**
 * Handle Sales Order Delivered event - Remove from WASP
 */
function handleSalesOrderDelivered(payload) {
  const soId = payload.object?.id;
  
  if (!soId) {
    logToSheet('SO_DELIVERED_ERROR', payload, {error: 'No SO ID found'});
    return { status: 'error', message: 'No SO ID in webhook' };
  }
  
  // Fetch SO details
  const soData = fetchKatanaSalesOrder(soId);
  if (!soData) return { status: 'error', message: 'Failed to fetch SO details' };
  
  const items = soData.rows || soData.sales_order_rows || [];
  const results = [];
  
  for (const item of items) {
    const variantId = item.variant_id;
    const quantity = item.delivered_quantity || item.quantity;
    
    // Resolve SKU via variant
    const variant = fetchKatanaVariant(variantId);
    const sku = variant?.sku;
    
    if (sku && quantity > 0) {
      const result = waspRemoveInventory(
        sku,
        quantity,
        'SHIPPING-DOCK',
        'SO Delivered: ' + (soData.order_no || soId)
      );
      results.push({ sku: sku, quantity: quantity, result: result });
    }
  }
  
  sendSlackNotification('🚚 SO Delivered: ' + (soData.order_no || soId) + ' - ' + results.length + ' items removed');
  
  return { status: 'processed', soId: soId, results: results };
}

/**
 * Handle Manufacturing Order Done event
 */
function handleManufacturingOrderDone(payload) {
  const moId = payload.object?.id;
  logToSheet('MO_DONE_LOG', payload, { moId: moId });
  sendSlackNotification('🔧 MO Completed in Katana\nID: ' + moId);
  
  return { status: 'logged', moId: moId, note: 'Placeholder for logic' };
}

// ============================================
// WASP CALLOUT HANDLERS (WASP → Katana)
// ============================================

/**
 * Handle WASP quantity added event
 * When inventory is added in WASP, create adjustment in Katana
 */
function handleWaspQuantityAdded(payload) {
  logToSheet('WASP_CALLOUT_ADD', payload, {status: 'received'});
  
  const itemNumber = payload.AssetTag;
  const quantity = parseFloat(payload.Quantity) || 0;
  const location = payload.LocationCode;
  const notes = payload.Notes || '';
  
  // For now, just log - Katana API integration TBD
  sendSlackNotification('📥 WASP Add Callout\nItem: ' + itemNumber + '\nQty: ' + quantity + '\nLocation: ' + location);
  
  // TODO: Call Katana API to create stock adjustment
  // const katanaResult = createKatanaAdjustment(itemNumber, quantity, 'add');
  
  return { 
    status: 'logged', 
    source: 'WASP',
    event: 'quantity_added',
    item: itemNumber, 
    quantity: quantity,
    note: 'Katana sync pending - API research needed'
  };
}

/**
 * Handle WASP quantity removed event
 * When inventory is removed in WASP, create adjustment in Katana
 */
function handleWaspQuantityRemoved(payload) {
  logToSheet('WASP_CALLOUT_REMOVE', payload, {status: 'received'});
  
  const itemNumber = payload.AssetTag;
  const quantity = parseFloat(payload.Quantity) || 0;
  const location = payload.LocationCode;
  const notes = payload.Notes || '';
  
  // For now, just log - Katana API integration TBD
  sendSlackNotification('📤 WASP Remove Callout\nItem: ' + itemNumber + '\nQty: ' + quantity + '\nLocation: ' + location);
  
  // TODO: Call Katana API to create stock adjustment
  // const katanaResult = createKatanaAdjustment(itemNumber, quantity, 'remove');
  
  return { 
    status: 'logged', 
    source: 'WASP',
    event: 'quantity_removed',
    item: itemNumber, 
    quantity: quantity,
    note: 'Katana sync pending - API research needed'
  };
}

// ============================================
// KATANA API FUNCTIONS
// ============================================

function katanaApiCall(endpoint) {
  const url = 'https://api.katanamrp.com/v1/' + endpoint;
  const options = {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.KATANA_API_KEY,
      'Accept': 'application/json'
    },
    muteHttpExceptions: true
  };
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();
    
    if (code === 200) {
      return JSON.parse(body);
    } else {
      logToSheet('KATANA_API_ERROR', { endpoint: endpoint, statusCode: code }, body);
      return null;
    }
  } catch (error) {
    logToSheet('KATANA_API_EXCEPTION', { endpoint: endpoint }, { error: error.message });
    return null;
  }
}

function fetchKatanaPO(poId) { return katanaApiCall('purchase_orders/' + poId); }
function fetchKatanaPORows(poId) { return katanaApiCall('purchase_order_rows?purchase_order_id=' + poId); }
function fetchKatanaVariant(variantId) { return katanaApiCall('variants/' + variantId); }
function fetchKatanaSalesOrder(soId) { return katanaApiCall('sales_orders/' + soId); }
function fetchKatanaMO(moId) { return katanaApiCall('manufacturing_orders/' + moId); }

// ============================================
// WASP API FUNCTIONS
// ============================================

function waspApiCall(url, payload) {
  // Don't double-stringify
  const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  
  const options = {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.WASP_TOKEN,
      'Content-Type': 'application/json'
    },
    payload: payloadString,
    muteHttpExceptions: true
  };
  
  logToSheet('WASP_API_CALL', {url: url, payloadType: typeof payload, payloadSent: payloadString.substring(0,500)}, {});
  
  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const body = response.getContentText();
    
    logToSheet('WASP_API_RESPONSE', {statusCode: code}, body.substring(0, 1000));
    
    return {
      success: code === 200 && !body.includes('HasError":true'),
      code: code,
      response: body
    };
  } catch (error) {
    logToSheet('WASP_API_ERROR', {url: url}, {error: error.message});
    return {
      success: false,
      code: 0,
      response: error.message
    };
  }
}

function waspAddInventoryWithLot(itemNumber, quantity, locationCode, lotNumber, expiryDate, notes) {
  const url = CONFIG.WASP_BASE_URL + '/public-api/transactions/item/add';
  
  // Use provided lot or generate default
  const lot = lotNumber || 'NO-LOT';
  
  // Use provided expiry or default to 2 years from now
  let dateCode = expiryDate;
  if (!dateCode) {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 2);
    dateCode = future.toISOString().slice(0,10);
  }
  
  const payload = [{
    ItemNumber: itemNumber,
    Quantity: quantity,
    SiteName: "MMH Kelowna",
    LocationCode: locationCode,
    Lot: lot,
    DateCode: dateCode,
    Notes: notes || ""
  }];
  
  logToSheet('WASP_PAYLOAD', {itemNumber: itemNumber, quantity: quantity, lot: lot}, payload);
  
  // Pass as object, NOT as string
  return waspApiCall(url, payload);
}

function waspAddInventory(itemNumber, quantity, locationCode, notes) {
  const url = CONFIG.WASP_BASE_URL + '/public-api/transactions/item/add';
  
  const payload = [{
    "ItemNumber": itemNumber,
    "Quantity": quantity,
    "SiteName": "MMH Kelowna",
    "LocationCode": locationCode,
    "Notes": notes || ""
  }];
  
  return waspApiCall(url, payload);
}

function waspRemoveInventory(itemNumber, quantity, locationCode, notes) {
  const url = CONFIG.WASP_BASE_URL + '/public-api/transactions/item/remove';
  
  const payload = [{
    "ItemNumber": itemNumber,
    "Quantity": quantity,
    "SiteName": "MMH Kelowna",
    "LocationCode": locationCode,
    "Notes": notes || ""
  }];
  
  return waspApiCall(url, payload);
}

// ============================================
// UTILITY & TEST FUNCTIONS
// ============================================

function sendSlackNotification(message) {
  if (!CONFIG.SLACK_WEBHOOK_URL) return;
  
  const payload = { text: '🔄 *Katana-WASP Sync*\n' + message };
  try {
    UrlFetchApp.fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify(payload)
    });
  } catch (error) {
    Logger.log('Slack Error: ' + error.message);
  }
}

function testWaspConnection() {
  const result = waspApiCall(CONFIG.WASP_BASE_URL + '/public-api/ic/item/infosearch', {});
  Logger.log('WASP Test Result: ' + JSON.stringify(result));
}

function testSheetLogging() {
  logToSheet('TEST_EVENT', { test: 'data' }, { status: 'success' });
  Logger.log('Test log sent to sheet');
}
function testWaspAddItem() {
  const token = PropertiesService.getScriptProperties().getProperty('WASP_TOKEN');
  const baseUrl = 'https://mymagichealer.waspinventorycloud.com/public-api/transactions/item/add';
  
  // Try different field name combinations
  const testPayloads = [
    // Attempt 1: Current format
    {
      name: "Test 1: SiteCode + LotNumber",
      payload: [{
        "ItemNumber": "B-YELLOW-1",
        "Quantity": 1,
        "SiteCode": "MMH Kelowna",
        "LocationCode": "RECEIVING-DOCK",
        "LotNumber": "TEST-LOT-1",
        "DateCode": "2028-01-19"
      }]
    },
    // Attempt 2: SiteName instead of SiteCode
    {
      name: "Test 2: SiteName + Lot",
      payload: [{
        "ItemNumber": "B-YELLOW-1",
        "Quantity": 1,
        "SiteName": "MMH Kelowna",
        "LocationCode": "RECEIVING-DOCK",
        "Lot": "TEST-LOT-2",
        "DateCode": "2028-01-19"
      }]
    },
    // Attempt 3: Site + Lot
    {
      name: "Test 3: Site + Lot",
      payload: [{
        "ItemNumber": "B-YELLOW-1",
        "Quantity": 1,
        "Site": "MMH Kelowna",
        "Location": "RECEIVING-DOCK",
        "Lot": "TEST-LOT-3",
        "DateCode": "2028-01-19"
      }]
    },
    // Attempt 4: All lowercase
    {
      name: "Test 4: lowercase fields",
      payload: [{
        "itemNumber": "B-YELLOW-1",
        "quantity": 1,
        "siteCode": "MMH Kelowna",
        "locationCode": "RECEIVING-DOCK",
        "lotNumber": "TEST-LOT-4",
        "dateCode": "2028-01-19"
      }]
    }
  ];
  
  const results = [];
  
  for (const test of testPayloads) {
    const options = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(test.payload),
      muteHttpExceptions: true
    };
    
    try {
      const response = UrlFetchApp.fetch(baseUrl, options);
      const code = response.getResponseCode();
      const body = response.getContentText();
      
      results.push({
        test: test.name,
        statusCode: code,
        success: !body.includes('HasError":true'),
        response: body.substring(0, 500)
      });
      
      Logger.log(test.name + ': ' + code + ' - ' + body.substring(0, 200));
      
    } catch (error) {
      results.push({
        test: test.name,
        error: error.message
      });
    }
    
    // Small delay between tests
    Utilities.sleep(500);
  }
  
  // Log all results to sheet
  logToSheet('WASP_FIELD_TEST', {totalTests: results.length}, results);
  
  return results;
}
