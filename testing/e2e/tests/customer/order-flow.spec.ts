/**
 * E2E Tests: Customer Order Flow
 */

import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { getTestMerchants, getTestProducts } from '../../helpers/test-data-setup';

test.describe('Customer Order Flow', () => {
  let authHelper: AuthHelper;
  
  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await authHelper.apiLogin('customer');
    await page.goto('/');
  });
  
  test('should complete full order flow', async ({ page }) => {
    const merchants = getTestMerchants();
    const products = getTestProducts();
    const pizzaPlace = merchants.find(m => m.name.includes('Pizza'));
    const pizzaProducts = products.filter(p => p.merchantId === pizzaPlace?.id);
    
    // Step 1: Search for restaurants
    await page.fill('[data-testid="search-input"]', 'Pizza');
    await page.click('[data-testid="search-button"]');
    
    // Wait for search results
    await page.waitForSelector('[data-testid="merchant-card"]');
    
    // Step 2: Select a restaurant
    await page.click(`[data-testid="merchant-${pizzaPlace?.id}"]`);
    
    // Wait for merchant page
    await page.waitForURL(`/merchants/${pizzaPlace?.id}`);
    
    // Verify merchant details
    await expect(page.locator('h1')).toContainText(pizzaPlace!.name);
    await expect(page.locator('[data-testid="merchant-cuisine"]')).toContainText(pizzaPlace!.cuisine);
    
    // Step 3: Add items to cart
    const margherita = pizzaProducts.find(p => p.name.includes('Margherita'));
    const caesarSalad = pizzaProducts.find(p => p.name.includes('Caesar'));
    
    // Add Margherita Pizza
    await page.click(`[data-testid="add-to-cart-${margherita?.id}"]`);
    
    // Verify cart updated
    await expect(page.locator('[data-testid="cart-count"]')).toContainText('1');
    
    // Add another item
    await page.click(`[data-testid="add-to-cart-${caesarSalad?.id}"]`);
    await expect(page.locator('[data-testid="cart-count"]')).toContainText('2');
    
    // Step 4: View cart
    await page.click('[data-testid="view-cart"]');
    
    // Verify cart contents
    await expect(page.locator('[data-testid="cart-item"]')).toHaveCount(2);
    await expect(page.locator(`[data-testid="cart-item-${margherita?.id}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="cart-item-${caesarSalad?.id}"]`)).toBeVisible();
    
    // Verify totals
    const subtotal = margherita!.price + caesarSalad!.price;
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText(subtotal.toFixed(2));
    
    // Step 5: Proceed to checkout
    await page.click('[data-testid="checkout-button"]');
    
    // Wait for checkout page
    await page.waitForURL('/checkout');
    
    // Step 6: Fill reskflow details
    await page.fill('[data-testid="reskflow-street"]', '123 Test Street');
    await page.fill('[data-testid="reskflow-city"]', 'Test City');
    await page.fill('[data-testid="reskflow-state"]', 'TC');
    await page.fill('[data-testid="reskflow-zip"]', '12345');
    await page.fill('[data-testid="reskflow-instructions"]', 'Leave at door');
    
    // Step 7: Select payment method
    await page.click('[data-testid="payment-method-card"]');
    
    // Use saved card or add new one
    const savedCard = await page.locator('[data-testid="saved-card"]').isVisible();
    if (!savedCard) {
      await page.click('[data-testid="add-new-card"]');
      await page.fill('[data-testid="card-number"]', '4242424242424242');
      await page.fill('[data-testid="card-expiry"]', '12/25');
      await page.fill('[data-testid="card-cvc"]', '123');
      await page.fill('[data-testid="card-name"]', 'Test Customer');
    }
    
    // Step 8: Review order
    await expect(page.locator('[data-testid="order-summary"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-fee"]')).toBeVisible();
    await expect(page.locator('[data-testid="tax"]')).toBeVisible();
    await expect(page.locator('[data-testid="total"]')).toBeVisible();
    
    // Step 9: Place order
    await page.click('[data-testid="place-order-button"]');
    
    // Wait for order confirmation
    await page.waitForURL(/\/orders\/[a-zA-Z0-9-]+/);
    
    // Verify order confirmation
    await expect(page.locator('[data-testid="order-confirmed"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-number"]')).toBeVisible();
    await expect(page.locator('[data-testid="estimated-reskflow"]')).toBeVisible();
    
    // Step 10: Track order
    await expect(page.locator('[data-testid="order-status"]')).toContainText(/Pending|Confirmed/);
    await expect(page.locator('[data-testid="order-timeline"]')).toBeVisible();
  });
  
  test('should handle cart modifications', async ({ page }) => {
    const products = getTestProducts();
    const burger = products.find(p => p.name.includes('Classic Burger'));
    
    // Go to merchant page
    await page.goto(`/merchants/${burger?.merchantId}`);
    
    // Add item to cart
    await page.click(`[data-testid="add-to-cart-${burger?.id}"]`);
    
    // Open cart
    await page.click('[data-testid="view-cart"]');
    
    // Increase quantity
    await page.click(`[data-testid="increase-quantity-${burger?.id}"]`);
    await expect(page.locator(`[data-testid="quantity-${burger?.id}"]`)).toContainText('2');
    
    // Verify price updated
    const itemTotal = burger!.price * 2;
    await expect(page.locator(`[data-testid="item-total-${burger?.id}"]`)).toContainText(itemTotal.toFixed(2));
    
    // Add special instructions
    await page.fill(`[data-testid="item-notes-${burger?.id}"]`, 'No onions please');
    
    // Remove one item
    await page.click(`[data-testid="decrease-quantity-${burger?.id}"]`);
    await expect(page.locator(`[data-testid="quantity-${burger?.id}"]`)).toContainText('1');
    
    // Remove item completely
    await page.click(`[data-testid="remove-item-${burger?.id}"]`);
    
    // Verify cart is empty
    await expect(page.locator('[data-testid="empty-cart"]')).toBeVisible();
  });
  
  test('should validate minimum order amount', async ({ page }) => {
    const merchants = getTestMerchants();
    const merchant = merchants[0];
    const products = getTestProducts().filter(p => p.merchantId === merchant.id);
    const cheapItem = products.reduce((min, p) => p.price < min.price ? p : min);
    
    // Go to merchant
    await page.goto(`/merchants/${merchant.id}`);
    
    // Add cheap item
    await page.click(`[data-testid="add-to-cart-${cheapItem.id}"]`);
    
    // Try to checkout
    await page.click('[data-testid="view-cart"]');
    await page.click('[data-testid="checkout-button"]');
    
    // Should show minimum order error
    await expect(page.locator('[data-testid="minimum-order-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="minimum-order-error"]')).toContainText(`${merchant.minimumOrder}`);
  });
  
  test('should save reskflow address', async ({ page }) => {
    // Complete first order with new address
    await completeQuickOrder(page);
    
    // Start second order
    const merchants = getTestMerchants();
    await page.goto(`/merchants/${merchants[0].id}`);
    
    // Add item and go to checkout
    await page.click('[data-testid^="add-to-cart-"]');
    await page.click('[data-testid="view-cart"]');
    await page.click('[data-testid="checkout-button"]');
    
    // Should see saved addresses
    await expect(page.locator('[data-testid="saved-addresses"]')).toBeVisible();
    await expect(page.locator('[data-testid="saved-address-0"]')).toContainText('123 Test Street');
    
    // Select saved address
    await page.click('[data-testid="use-saved-address-0"]');
    
    // Address fields should be filled
    await expect(page.locator('[data-testid="reskflow-street"]')).toHaveValue('123 Test Street');
  });
  
  test('should apply promo code', async ({ page }) => {
    // Add items to cart
    const products = getTestProducts();
    await page.goto(`/merchants/${products[0].merchantId}`);
    await page.click(`[data-testid="add-to-cart-${products[0].id}"]`);
    await page.click(`[data-testid="add-to-cart-${products[1].id}"]`);
    
    // Go to cart
    await page.click('[data-testid="view-cart"]');
    
    // Note original total
    const originalTotal = await page.locator('[data-testid="cart-total"]').textContent();
    
    // Apply promo code
    await page.fill('[data-testid="promo-code-input"]', 'TESTCODE10');
    await page.click('[data-testid="apply-promo"]');
    
    // Verify discount applied
    await expect(page.locator('[data-testid="discount-amount"]')).toBeVisible();
    await expect(page.locator('[data-testid="promo-success"]')).toContainText('Promo code applied');
    
    // Verify total reduced
    const newTotal = await page.locator('[data-testid="cart-total"]').textContent();
    expect(parseFloat(newTotal!.replace('$', ''))).toBeLessThan(parseFloat(originalTotal!.replace('$', '')));
  });
  
  test('should handle out of stock items', async ({ page }) => {
    const products = getTestProducts();
    const product = products[0];
    
    // Simulate item going out of stock
    await page.route(`**/api/merchants/${product.merchantId}/menu`, async route => {
      const response = await route.fetch();
      const data = await response.json();
      
      // Mark first item as unavailable
      data.items[0].isAvailable = false;
      
      await route.fulfill({
        response,
        json: data
      });
    });
    
    // Go to merchant
    await page.goto(`/merchants/${product.merchantId}`);
    
    // Item should show as unavailable
    await expect(page.locator(`[data-testid="item-${product.id}"]`)).toHaveClass(/unavailable|out-of-stock/);
    await expect(page.locator(`[data-testid="add-to-cart-${product.id}"]`)).toBeDisabled();
  });
  
  test('should show real-time order updates', async ({ page }) => {
    // Place an order
    await completeQuickOrder(page);
    
    // Should be on order tracking page
    await expect(page).toHaveURL(/\/orders\/[a-zA-Z0-9-]+/);
    
    // Initial status
    await expect(page.locator('[data-testid="order-status"]')).toContainText('Pending');
    
    // Simulate status update
    await page.evaluate(() => {
      // Trigger a status update event (would come from WebSocket in real app)
      window.dispatchEvent(new CustomEvent('order-update', {
        detail: { status: 'CONFIRMED', estimatedDeliveryTime: '30 minutes' }
      }));
    });
    
    // Status should update without page reload
    await expect(page.locator('[data-testid="order-status"]')).toContainText('Confirmed');
    await expect(page.locator('[data-testid="estimated-time"]')).toContainText('30 minutes');
  });
});

// Helper function to complete a quick order
async function completeQuickOrder(page: any) {
  const products = getTestProducts();
  const product = products[0];
  
  await page.goto(`/merchants/${product.merchantId}`);
  await page.click(`[data-testid="add-to-cart-${product.id}"]`);
  await page.click('[data-testid="view-cart"]');
  await page.click('[data-testid="checkout-button"]');
  
  // Fill minimum required fields
  await page.fill('[data-testid="reskflow-street"]', '123 Test Street');
  await page.fill('[data-testid="reskflow-city"]', 'Test City');
  await page.fill('[data-testid="reskflow-state"]', 'TC');
  await page.fill('[data-testid="reskflow-zip"]', '12345');
  
  // Use default payment method
  await page.click('[data-testid="place-order-button"]');
  
  // Wait for confirmation
  await page.waitForURL(/\/orders\/[a-zA-Z0-9-]+/);
}