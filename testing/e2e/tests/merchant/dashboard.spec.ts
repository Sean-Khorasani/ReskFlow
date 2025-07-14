/**
 * E2E Tests: Merchant Dashboard
 */

import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';
import { getTestMerchants } from '../../helpers/test-data-setup';

test.describe('Merchant Dashboard', () => {
  let authHelper: AuthHelper;
  
  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await authHelper.apiLogin('merchant');
    await page.goto('/merchant/dashboard');
  });
  
  test('should display merchant dashboard overview', async ({ page }) => {
    // Verify dashboard elements
    await expect(page.locator('h1')).toContainText('Merchant Dashboard');
    
    // Key metrics cards
    await expect(page.locator('[data-testid="todays-orders"]')).toBeVisible();
    await expect(page.locator('[data-testid="todays-revenue"]')).toBeVisible();
    await expect(page.locator('[data-testid="average-rating"]')).toBeVisible();
    await expect(page.locator('[data-testid="active-orders"]')).toBeVisible();
    
    // Recent orders section
    await expect(page.locator('[data-testid="recent-orders"]')).toBeVisible();
    
    // Quick actions
    await expect(page.locator('[data-testid="manage-menu"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-analytics"]')).toBeVisible();
    await expect(page.locator('[data-testid="merchant-settings"]')).toBeVisible();
  });
  
  test('should manage incoming orders', async ({ page }) => {
    // Wait for orders list
    await page.waitForSelector('[data-testid="orders-list"]');
    
    // If there are pending orders
    const pendingOrder = page.locator('[data-testid="order-status-pending"]').first();
    
    if (await pendingOrder.isVisible()) {
      // Click on order to view details
      await pendingOrder.click();
      
      // Order details modal/page
      await expect(page.locator('[data-testid="order-details"]')).toBeVisible();
      await expect(page.locator('[data-testid="customer-info"]')).toBeVisible();
      await expect(page.locator('[data-testid="order-items"]')).toBeVisible();
      await expect(page.locator('[data-testid="reskflow-address"]')).toBeVisible();
      
      // Accept order
      await page.click('[data-testid="accept-order"]');
      
      // Set preparation time
      await page.fill('[data-testid="prep-time"]', '25');
      await page.click('[data-testid="confirm-accept"]');
      
      // Verify order status updated
      await expect(page.locator('[data-testid="order-status"]')).toContainText('Confirmed');
      await expect(page.locator('[data-testid="success-message"]')).toContainText('Order accepted');
    }
  });
  
  test('should update order status', async ({ page }) => {
    // Find a confirmed order
    const confirmedOrder = page.locator('[data-testid="order-status-confirmed"]').first();
    
    if (await confirmedOrder.isVisible()) {
      await confirmedOrder.click();
      
      // Update to preparing
      await page.click('[data-testid="start-preparing"]');
      await expect(page.locator('[data-testid="order-status"]')).toContainText('Preparing');
      
      // Update to ready
      await page.click('[data-testid="mark-ready"]');
      await expect(page.locator('[data-testid="order-status"]')).toContainText('Ready');
      
      // Assign to driver
      await page.click('[data-testid="assign-driver"]');
      await page.selectOption('[data-testid="driver-select"]', { index: 1 });
      await page.click('[data-testid="confirm-assign"]');
      
      await expect(page.locator('[data-testid="order-status"]')).toContainText('Out for reskflow');
    }
  });
  
  test('should manage menu items', async ({ page }) => {
    // Navigate to menu management
    await page.click('[data-testid="manage-menu"]');
    await page.waitForURL('/merchant/menu');
    
    // View current menu items
    await expect(page.locator('[data-testid="menu-items-grid"]')).toBeVisible();
    
    // Add new item
    await page.click('[data-testid="add-menu-item"]');
    
    // Fill item details
    await page.fill('[data-testid="item-name"]', 'Test Special Pizza');
    await page.fill('[data-testid="item-description"]', 'A special test pizza with all toppings');
    await page.fill('[data-testid="item-price"]', '19.99');
    await page.selectOption('[data-testid="item-category"]', 'Pizza');
    
    // Upload image (mock)
    await page.setInputFiles('[data-testid="item-image"]', {
      name: 'pizza.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake-image-data')
    });
    
    // Set availability
    await page.check('[data-testid="item-available"]');
    
    // Save item
    await page.click('[data-testid="save-item"]');
    
    // Verify item added
    await expect(page.locator('[data-testid="success-message"]')).toContainText('Menu item added');
    await expect(page.locator('text=Test Special Pizza')).toBeVisible();
    
    // Edit item
    await page.click('[data-testid="edit-item-Test Special Pizza"]');
    await page.fill('[data-testid="item-price"]', '17.99');
    await page.click('[data-testid="save-item"]');
    
    // Toggle availability
    await page.click('[data-testid="toggle-availability-Test Special Pizza"]');
    await expect(page.locator('[data-testid="item-status-Test Special Pizza"]')).toContainText('Unavailable');
  });
  
  test('should view analytics', async ({ page }) => {
    // Navigate to analytics
    await page.click('[data-testid="view-analytics"]');
    await page.waitForURL('/merchant/analytics');
    
    // Date range selector
    await expect(page.locator('[data-testid="date-range-selector"]')).toBeVisible();
    
    // Revenue chart
    await expect(page.locator('[data-testid="revenue-chart"]')).toBeVisible();
    
    // Orders chart
    await expect(page.locator('[data-testid="orders-chart"]')).toBeVisible();
    
    // Top items
    await expect(page.locator('[data-testid="top-items-table"]')).toBeVisible();
    
    // Customer insights
    await expect(page.locator('[data-testid="customer-insights"]')).toBeVisible();
    
    // Change date range
    await page.selectOption('[data-testid="date-range-selector"]', 'last-7-days');
    
    // Charts should update (check for loading state)
    await expect(page.locator('[data-testid="loading-indicator"]')).toBeVisible();
    await expect(page.locator('[data-testid="loading-indicator"]')).not.toBeVisible({ timeout: 5000 });
  });
  
  test('should manage restaurant settings', async ({ page }) => {
    // Navigate to settings
    await page.click('[data-testid="merchant-settings"]');
    await page.waitForURL('/merchant/settings');
    
    // Update operating hours
    await page.click('[data-testid="edit-hours"]');
    
    // Change Monday hours
    await page.fill('[data-testid="monday-open"]', '09:00');
    await page.fill('[data-testid="monday-close"]', '23:00');
    
    // Save hours
    await page.click('[data-testid="save-hours"]');
    await expect(page.locator('[data-testid="success-message"]')).toContainText('Hours updated');
    
    // Update reskflow settings
    await page.fill('[data-testid="minimum-order"]', '20.00');
    await page.fill('[data-testid="reskflow-fee"]', '4.99');
    await page.fill('[data-testid="reskflow-radius"]', '5');
    
    await page.click('[data-testid="save-reskflow-settings"]');
    
    // Toggle restaurant availability
    await page.click('[data-testid="toggle-restaurant-status"]');
    await expect(page.locator('[data-testid="restaurant-status"]')).toContainText('Temporarily Closed');
    
    // Add closing reason
    await page.fill('[data-testid="closing-reason"]', 'Kitchen maintenance');
    await page.click('[data-testid="save-status"]');
  });
  
  test('should handle real-time order notifications', async ({ page }) => {
    // Enable notifications (mock permission)
    await page.evaluate(() => {
      window.Notification = {
        permission: 'granted',
        requestPermission: async () => 'granted'
      } as any;
    });
    
    // Simulate new order notification
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('new-order', {
        detail: {
          orderId: 'ORD-123',
          customerName: 'John Doe',
          total: 35.99
        }
      }));
    });
    
    // Notification popup should appear
    await expect(page.locator('[data-testid="order-notification"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-notification"]')).toContainText('New Order');
    await expect(page.locator('[data-testid="order-notification"]')).toContainText('John Doe');
    
    // Click notification to view order
    await page.click('[data-testid="view-order-ORD-123"]');
    await expect(page.locator('[data-testid="order-details"]')).toBeVisible();
  });
  
  test('should export data', async ({ page }) => {
    // Navigate to analytics
    await page.goto('/merchant/analytics');
    
    // Export orders data
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-orders"]')
    ]);
    
    // Verify download
    expect(download.suggestedFilename()).toMatch(/orders.*\.csv/);
    
    // Export revenue report
    const [revenueDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-testid="export-revenue"]')
    ]);
    
    expect(revenueDownload.suggestedFilename()).toMatch(/revenue.*\.pdf/);
  });
  
  test('should manage promotions', async ({ page }) => {
    // Navigate to promotions
    await page.goto('/merchant/promotions');
    
    // Create new promotion
    await page.click('[data-testid="create-promotion"]');
    
    // Fill promotion details
    await page.fill('[data-testid="promo-name"]', 'Weekend Special');
    await page.fill('[data-testid="promo-code"]', 'WEEKEND20');
    await page.selectOption('[data-testid="promo-type"]', 'percentage');
    await page.fill('[data-testid="promo-value"]', '20');
    await page.fill('[data-testid="promo-min-order"]', '30');
    
    // Set validity period
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    
    await page.fill('[data-testid="promo-start-date"]', tomorrow.toISOString().split('T')[0]);
    await page.fill('[data-testid="promo-end-date"]', nextWeek.toISOString().split('T')[0]);
    
    // Save promotion
    await page.click('[data-testid="save-promotion"]');
    
    // Verify promotion created
    await expect(page.locator('[data-testid="success-message"]')).toContainText('Promotion created');
    await expect(page.locator('text=Weekend Special')).toBeVisible();
    
    // Toggle promotion status
    await page.click('[data-testid="toggle-promo-WEEKEND20"]');
    await expect(page.locator('[data-testid="promo-status-WEEKEND20"]')).toContainText('Inactive');
  });
});