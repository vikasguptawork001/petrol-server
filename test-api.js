/**
 * API Test Script
 * Tests all endpoints of the inventory management system
 * Run with: node server/test-api.js
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api';
let authToken = '';
let testUserId = '';
let testItemId = '';
let testBuyerPartyId = '';
let testSellerPartyId = '';
let testSaleTransactionId = '';

// Test results
const results = {
  passed: 0,
  failed: 0,
  errors: []
};

// Helper function to make API calls
async function apiCall(method, endpoint, data = null, token = null) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {}
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data?.error || error.message,
      status: error.response?.status || 500
    };
  }
}

// Test function
function test(name, testFn) {
  return async () => {
    try {
      console.log(`\n🧪 Testing: ${name}`);
      await testFn();
      results.passed++;
      console.log(`✅ PASSED: ${name}`);
    } catch (error) {
      results.failed++;
      results.errors.push({ test: name, error: error.message });
      console.log(`❌ FAILED: ${name} - ${error.message}`);
    }
  };
}

// ========== AUTHENTICATION TESTS ==========

const testLogin = test('Login with valid credentials', async () => {
  const result = await apiCall('POST', '/auth/login', {
    user_id: 'superadmin',
    password: 'admin123'
  });

  if (!result.success) throw new Error(result.error);
  if (!result.data.token) throw new Error('Token not received');
  authToken = result.data.token;
  testUserId = result.data.user.id;
  console.log(`   Token received: ${authToken.substring(0, 20)}...`);
});

const testLoginInvalid = test('Login with invalid credentials', async () => {
  const result = await apiCall('POST', '/auth/login', {
    user_id: 'invalid',
    password: 'wrong'
  });

  if (result.success) throw new Error('Should have failed with invalid credentials');
  if (result.status !== 401) throw new Error(`Expected 401, got ${result.status}`);
});

const testHealthCheck = test('Health check endpoint', async () => {
  const result = await apiCall('GET', '/health');
  if (!result.success) throw new Error(result.error);
  if (result.data.status !== 'OK') throw new Error('Health check failed');
});

// ========== ITEMS TESTS ==========

const testGetItems = test('Get all items', async () => {
  const result = await apiCall('GET', '/items?page=1&limit=10', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!Array.isArray(result.data.items)) throw new Error('Items should be an array');
  console.log(`   Found ${result.data.items.length} items`);
});

const testAddItem = test('Add new item (admin only)', async () => {
  const result = await apiCall('POST', '/items', {
    product_name: 'Test Product ' + Date.now(),
    product_code: 'TEST-' + Date.now(),
    brand: 'Test Brand',
    sale_rate: 1000,
    purchase_rate: 800,
    quantity: 0,
    alert_quantity: 10,
    tax_rate: 18
  }, authToken);

  if (!result.success) throw new Error(result.error);
  if (!result.data.id) throw new Error('Item ID not returned');
  testItemId = result.data.id;
  console.log(`   Item created with ID: ${testItemId}`);
});

const testSearchItems = test('Search items', async () => {
  const result = await apiCall('GET', '/items/search?q=test', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!Array.isArray(result.data.items)) throw new Error('Search results should be an array');
});

// ========== PARTIES TESTS ==========

const testAddBuyerParty = test('Add buyer party (admin only)', async () => {
  const result = await apiCall('POST', '/parties/buyers', {
    party_name: 'Test Buyer ' + Date.now(),
    mobile_number: '9876543210',
    email: 'testbuyer@test.com',
    address: 'Test Address',
    opening_balance: 0
  }, authToken);

  if (!result.success) throw new Error(result.error);
  if (!result.data.id) throw new Error('Buyer party ID not returned');
  testBuyerPartyId = result.data.id;
  console.log(`   Buyer party created with ID: ${testBuyerPartyId}`);
});

const testAddSellerParty = test('Add seller party (admin only)', async () => {
  const result = await apiCall('POST', '/parties/sellers', {
    party_name: 'Test Seller ' + Date.now(),
    mobile_number: '9876543211',
    email: 'testseller@test.com',
    address: 'Test Address',
    opening_balance: 0
  }, authToken);

  if (!result.success) throw new Error(result.error);
  if (!result.data.id) throw new Error('Seller party ID not returned');
  testSellerPartyId = result.data.id;
  console.log(`   Seller party created with ID: ${testSellerPartyId}`);
});

const testGetBuyerParties = test('Get all buyer parties', async () => {
  const result = await apiCall('GET', '/parties/buyers', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!Array.isArray(result.data.parties)) throw new Error('Parties should be an array');
});

const testGetSellerParties = test('Get all seller parties', async () => {
  const result = await apiCall('GET', '/parties/sellers', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!Array.isArray(result.data.parties)) throw new Error('Parties should be an array');
});

// ========== TRANSACTIONS TESTS ==========

const testCreateSale = test('Create sale transaction', async () => {
  if (!testItemId || !testSellerPartyId) {
    throw new Error('Prerequisites not met (item or seller party)');
  }

  const result = await apiCall('POST', '/transactions/sale', {
    seller_party_id: testSellerPartyId,
    items: [{
      item_id: testItemId,
      quantity: 1,
      sale_rate: 1000
    }],
    payment_status: 'fully_paid'
  }, authToken);

  if (!result.success) throw new Error(result.error);
  if (!result.data.transaction) throw new Error('Transaction not returned');
  testSaleTransactionId = result.data.transaction.id;
  console.log(`   Sale transaction created with ID: ${testSaleTransactionId}`);
});

const testGetSales = test('Get sale transactions', async () => {
  const result = await apiCall('GET', '/transactions/sales', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!Array.isArray(result.data.transactions)) throw new Error('Transactions should be an array');
});

// ========== REPORTS TESTS ==========

const testSalesReport = test('Get sales report', async () => {
  const result = await apiCall('GET', '/reports/sales', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!result.data.transactions) throw new Error('Transactions not returned');
  if (!result.data.summary) throw new Error('Summary not returned');
});

const testReturnReport = test('Get return report', async () => {
  const result = await apiCall('GET', '/reports/returns', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!result.data.transactions) throw new Error('Transactions not returned');
});

// ========== ORDERS TESTS ==========

const testGetOrders = test('Get order sheet', async () => {
  const result = await apiCall('GET', '/orders', null, authToken);
  if (!result.success) throw new Error(result.error);
  if (!Array.isArray(result.data.orders)) throw new Error('Orders should be an array');
});

// ========== AUTHORIZATION TESTS ==========

const testUnauthorizedAccess = test('Unauthorized access (no token)', async () => {
  const result = await apiCall('GET', '/items');
  if (result.success) throw new Error('Should have failed without token');
  if (result.status !== 401) throw new Error(`Expected 401, got ${result.status}`);
});

// Run all tests
async function runTests() {
  console.log('🚀 Starting API Tests...\n');
  console.log('='.repeat(50));

  // Authentication tests
  await testHealthCheck();
  await testLogin();
  await testLoginInvalid();
  await testUnauthorizedAccess();

  // Items tests
  await testGetItems();
  await testAddItem();
  await testSearchItems();

  // Parties tests
  await testGetBuyerParties();
  await testGetSellerParties();
  await testAddBuyerParty();
  await testAddSellerParty();

  // Transactions tests
  await testCreateSale();
  await testGetSales();

  // Reports tests
  await testSalesReport();
  await testReturnReport();

  // Orders tests
  await testGetOrders();

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('\n📊 Test Summary:');
  console.log(`   ✅ Passed: ${results.passed}`);
  console.log(`   ❌ Failed: ${results.failed}`);
  console.log(`   📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.errors.length > 0) {
    console.log('\n❌ Errors:');
    results.errors.forEach(({ test, error }) => {
      console.log(`   - ${test}: ${error}`);
    });
  }

  if (results.failed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Please review the errors above.');
    process.exit(1);
  }
}

// Check if server is running
async function checkServer() {
  try {
    const result = await apiCall('GET', '/health');
    if (result.success) {
      console.log('✓ Server is running\n');
      return true;
    }
  } catch (error) {
    console.error('❌ Server is not running. Please start the server first:');
    console.error('   npm run dev');
    process.exit(1);
  }
}

// Main
(async () => {
  await checkServer();
  await runTests();
})();













