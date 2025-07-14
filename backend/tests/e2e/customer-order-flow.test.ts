/**
 * End-to-End Test: Customer Order Flow
 * Tests the complete flow from browsing to reskflow
 */

import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:4000/api';

// Test data
const testCustomer = {
  email: 'customer@test.com',
  password: 'Test123!',
};

const testMerchant = {
  name: 'Test Restaurant',
};

test.describe('Customer Order Flow', () => {
  let authToken: string;
  let customerId: string;
  let orderId: string;

  test.beforeAll(async ({ request }) => {
    // Login as customer
    const loginResponse = await request.post(`${API_URL}/auth/login`, {
      data: testCustomer,
    });
    
    expect(loginResponse.ok()).toBeTruthy();
    const loginData = await loginResponse.json();
    authToken = loginData.token;
    customerId = loginData.user.id;
  });

  test('should browse restaurants and menu', async ({ page }) => {
    // Navigate to home page
    await page.goto(BASE_URL);
    
    // Search for restaurant
    await page.fill('[data-testid="search-input"]', testMerchant.name);
    await page.press('[data-testid="search-input"]', 'Enter');
    
    // Wait for results
    await page.waitForSelector('[data-testid="restaurant-card"]');
    
    // Click on restaurant
    await page.click(`[data-testid="restaurant-card"]:has-text("${testMerchant.name}")`);
    
    // Wait for menu to load
    await page.waitForSelector('[data-testid="menu-item"]');
    
    // Verify menu items are displayed
    const menuItems = await page.$$('[data-testid="menu-item"]');
    expect(menuItems.length).toBeGreaterThan(0);
  });

  test('should add items to cart', async ({ page }) => {
    // Navigate to restaurant page
    await page.goto(`${BASE_URL}/restaurant/test-restaurant`);
    
    // Add first item to cart
    await page.click('[data-testid="menu-item"]:first-child [data-testid="add-to-cart-btn"]');
    
    // Verify cart badge updates
    await expect(page.locator('[data-testid="cart-badge"]')).toHaveText('1');
    
    // Add another item
    await page.click('[data-testid="menu-item"]:nth-child(2) [data-testid="add-to-cart-btn"]');
    
    // Verify cart badge updates
    await expect(page.locator('[data-testid="cart-badge"]')).toHaveText('2');
    
    // Open cart
    await page.click('[data-testid="cart-button"]');
    
    // Verify cart items
    const cartItems = await page.$$('[data-testid="cart-item"]');
    expect(cartItems.length).toBe(2);
  });

  test('should complete checkout', async ({ page }) => {
    // Set auth token
    await page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);
    
    // Navigate to cart
    await page.goto(`${BASE_URL}/cart`);
    
    // Proceed to checkout
    await page.click('[data-testid="checkout-btn"]');
    
    // Wait for checkout page
    await page.waitForURL('**/checkout');
    
    // Verify reskflow address is pre-filled
    await expect(page.locator('[data-testid="reskflow-address"]')).toHaveValue(/123 Test Street/);
    
    // Select payment method
    await page.click('[data-testid="payment-method-card"]');
    
    // Add tip
    await page.click('[data-testid="tip-15"]');
    
    // Place order
    await page.click('[data-testid="place-order-btn"]');
    
    // Wait for confirmation
    await page.waitForSelector('[data-testid="order-confirmation"]');
    
    // Get order ID
    const orderIdElement = await page.locator('[data-testid="order-id"]').textContent();
    orderId = orderIdElement?.replace('Order #', '') || '';
    
    expect(orderId).toBeTruthy();
  });

  test('should track order status', async ({ page }) => {
    // Set auth token
    await page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);
    
    // Navigate to order tracking
    await page.goto(`${BASE_URL}/orders/${orderId}`);
    
    // Verify order status is displayed
    await expect(page.locator('[data-testid="order-status"]')).toBeVisible();
    
    // Verify timeline is displayed
    await expect(page.locator('[data-testid="order-timeline"]')).toBeVisible();
    
    // Verify estimated reskflow time
    await expect(page.locator('[data-testid="estimated-reskflow"]')).toBeVisible();
  });

  test('should receive real-time updates', async ({ page, context }) => {
    // Set auth token
    await page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);
    
    // Navigate to order tracking
    await page.goto(`${BASE_URL}/orders/${orderId}`);
    
    // Listen for WebSocket messages
    await page.evaluate(() => {
      return new Promise((resolve) => {
        const ws = new WebSocket('ws://localhost:3001/customer');
        
        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.type === 'order:updated' && data.orderId === orderId) {
            resolve(data);
          }
        };
      });
    });
    
    // Simulate order update (this would normally come from merchant/driver)
    await page.request.post(`${API_URL}/orders/${orderId}/status`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        status: 'confirmed',
      },
    });
    
    // Verify UI updates
    await expect(page.locator('[data-testid="order-status"]')).toContainText('Confirmed');
  });

  test('should handle order cancellation', async ({ page }) => {
    // Create a new order for cancellation test
    const newOrderResponse = await page.request.post(`${API_URL}/orders`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        merchantId: 'test-merchant-id',
        items: [
          {
            productId: 'test-product-1',
            quantity: 1,
            price: 10.99,
          },
        ],
        reskflowAddress: '123 Test Street',
        paymentMethod: 'card',
      },
    });
    
    const newOrder = await newOrderResponse.json();
    const newOrderId = newOrder.id;
    
    // Navigate to order page
    await page.goto(`${BASE_URL}/orders/${newOrderId}`);
    
    // Click cancel button
    await page.click('[data-testid="cancel-order-btn"]');
    
    // Confirm cancellation
    await page.click('[data-testid="confirm-cancel-btn"]');
    
    // Verify order is cancelled
    await expect(page.locator('[data-testid="order-status"]')).toContainText('Cancelled');
  });

  test('should leave review after reskflow', async ({ page }) => {
    // Simulate completed order
    const completedOrderResponse = await page.request.post(`${API_URL}/orders`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      data: {
        merchantId: 'test-merchant-id',
        items: [
          {
            productId: 'test-product-1',
            quantity: 1,
            price: 10.99,
          },
        ],
        reskflowAddress: '123 Test Street',
        paymentMethod: 'card',
        status: 'delivered',
      },
    });
    
    const completedOrder = await completedOrderResponse.json();
    
    // Navigate to order page
    await page.goto(`${BASE_URL}/orders/${completedOrder.id}`);
    
    // Click leave review button
    await page.click('[data-testid="leave-review-btn"]');
    
    // Rate merchant
    await page.click('[data-testid="merchant-rating-5"]');
    
    // Add comment
    await page.fill('[data-testid="review-comment"]', 'Great food and fast reskflow!');
    
    // Rate driver
    await page.click('[data-testid="driver-rating-5"]');
    
    // Submit review
    await page.click('[data-testid="submit-review-btn"]');
    
    // Verify review submitted
    await expect(page.locator('[data-testid="review-success"]')).toBeVisible();
  });

  test('should handle payment failure', async ({ page }) => {
    // Set auth token
    await page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);
    
    // Navigate to checkout with items in cart
    await page.goto(`${BASE_URL}/checkout`);
    
    // Select a card that will fail
    await page.click('[data-testid="payment-method-card"]');
    await page.fill('[data-testid="card-number"]', '4000000000000002'); // Stripe test card that always fails
    
    // Try to place order
    await page.click('[data-testid="place-order-btn"]');
    
    // Verify error message
    await expect(page.locator('[data-testid="payment-error"]')).toContainText('Payment failed');
    
    // Verify order was not created
    await expect(page.locator('[data-testid="order-confirmation"]')).not.toBeVisible();
  });

  test('should apply promo code', async ({ page }) => {
    // Set auth token
    await page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, authToken);
    
    // Navigate to checkout
    await page.goto(`${BASE_URL}/checkout`);
    
    // Enter promo code
    await page.fill('[data-testid="promo-code-input"]', 'TESTCODE10');
    await page.click('[data-testid="apply-promo-btn"]');
    
    // Verify discount applied
    await expect(page.locator('[data-testid="discount-amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="discount-amount"]')).toContainText('-$');
    
    // Verify total updated
    const originalTotal = await page.locator('[data-testid="original-total"]').textContent();
    const discountedTotal = await page.locator('[data-testid="final-total"]').textContent();
    
    expect(parseFloat(discountedTotal?.replace('$', '') || '0')).toBeLessThan(
      parseFloat(originalTotal?.replace('$', '') || '0')
    );
  });
});

// Helper function to wait for element
async function waitForElement(page: any, selector: string, timeout = 30000) {
  await page.waitForSelector(selector, { timeout });
}