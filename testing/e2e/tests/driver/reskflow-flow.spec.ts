/**
 * E2E Tests: Driver Delivery Flow
 */

import { test, expect } from '@playwright/test';
import { AuthHelper } from '../../helpers/auth-helper';

test.describe('Driver Delivery Flow', () => {
  let authHelper: AuthHelper;
  
  test.beforeEach(async ({ page }) => {
    authHelper = new AuthHelper(page);
    await authHelper.apiLogin('driver');
    await page.goto('/driver/dashboard');
  });
  
  test('should display driver dashboard', async ({ page }) => {
    // Verify dashboard elements
    await expect(page.locator('h1')).toContainText('Driver Dashboard');
    
    // Status toggle
    await expect(page.locator('[data-testid="driver-status-toggle"]')).toBeVisible();
    
    // Stats cards
    await expect(page.locator('[data-testid="todays-deliveries"]')).toBeVisible();
    await expect(page.locator('[data-testid="todays-earnings"]')).toBeVisible();
    await expect(page.locator('[data-testid="current-rating"]')).toBeVisible();
    await expect(page.locator('[data-testid="active-time"]')).toBeVisible();
    
    // Available deliveries section
    await expect(page.locator('[data-testid="available-deliveries"]')).toBeVisible();
    
    // Current reskflow (if any)
    const currentDelivery = page.locator('[data-testid="current-reskflow"]');
    if (await currentDelivery.isVisible()) {
      await expect(currentDelivery).toContainText(/Pickup|Delivery/);
    }
  });
  
  test('should go online and accept reskflow', async ({ page }) => {
    // Check current status
    const statusToggle = page.locator('[data-testid="driver-status-toggle"]');
    const isOnline = await statusToggle.getAttribute('aria-checked') === 'true';
    
    // Go online if offline
    if (!isOnline) {
      await statusToggle.click();
      await expect(page.locator('[data-testid="status-indicator"]')).toContainText('Online');
    }
    
    // Wait for available deliveries
    await page.waitForSelector('[data-testid="reskflow-card"]', { timeout: 30000 });
    
    // View first available reskflow
    const firstDelivery = page.locator('[data-testid="reskflow-card"]').first();
    const reskflowId = await firstDelivery.getAttribute('data-reskflow-id');
    
    // Check reskflow details
    await expect(firstDelivery.locator('[data-testid="pickup-location"]')).toBeVisible();
    await expect(firstDelivery.locator('[data-testid="reskflow-location"]')).toBeVisible();
    await expect(firstDelivery.locator('[data-testid="estimated-distance"]')).toBeVisible();
    await expect(firstDelivery.locator('[data-testid="reskflow-fee"]')).toBeVisible();
    
    // Accept reskflow
    await firstDelivery.locator('[data-testid="accept-reskflow"]').click();
    
    // Confirm acceptance
    await page.click('[data-testid="confirm-accept"]');
    
    // Should navigate to active reskflow view
    await expect(page.locator('[data-testid="active-reskflow"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('Heading to pickup');
  });
  
  test('should complete reskflow flow', async ({ page }) => {
    // Assuming driver has an active reskflow
    const hasActiveDelivery = await page.locator('[data-testid="active-reskflow"]').isVisible();
    
    if (!hasActiveDelivery) {
      // Accept a reskflow first
      await page.locator('[data-testid="driver-status-toggle"]').click();
      await page.waitForSelector('[data-testid="reskflow-card"]');
      await page.locator('[data-testid="accept-reskflow"]').first().click();
      await page.click('[data-testid="confirm-accept"]');
    }
    
    // Navigate to pickup
    await expect(page.locator('[data-testid="navigation-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="pickup-address"]')).toBeVisible();
    
    // Simulate arrival at restaurant
    await page.click('[data-testid="arrived-at-pickup"]');
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('At pickup location');
    
    // View order details
    await page.click('[data-testid="view-order-details"]');
    await expect(page.locator('[data-testid="order-items"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-number"]')).toBeVisible();
    
    // Confirm pickup
    await page.click('[data-testid="confirm-pickup"]');
    
    // Enter order verification code (if required)
    const verificationRequired = await page.locator('[data-testid="verification-code"]').isVisible();
    if (verificationRequired) {
      await page.fill('[data-testid="verification-code"]', '1234');
      await page.click('[data-testid="verify-pickup"]');
    }
    
    // Status should update
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('Heading to customer');
    
    // Navigate to customer
    await expect(page.locator('[data-testid="customer-address"]')).toBeVisible();
    await expect(page.locator('[data-testid="customer-phone"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-instructions"]')).toBeVisible();
    
    // Simulate arrival at customer
    await page.click('[data-testid="arrived-at-customer"]');
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('At reskflow location');
    
    // Complete reskflow
    await page.click('[data-testid="complete-reskflow"]');
    
    // Delivery confirmation
    await page.selectOption('[data-testid="reskflow-method"]', 'handed-to-customer');
    await page.click('[data-testid="confirm-reskflow"]');
    
    // Should show completion screen
    await expect(page.locator('[data-testid="reskflow-completed"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-earnings"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-summary"]')).toBeVisible();
    
    // Return to dashboard
    await page.click('[data-testid="back-to-dashboard"]');
    await expect(page).toHaveURL('/driver/dashboard');
  });
  
  test('should handle navigation and route optimization', async ({ page }) => {
    // Accept a reskflow
    await page.locator('[data-testid="driver-status-toggle"]').click();
    await page.waitForSelector('[data-testid="reskflow-card"]');
    await page.locator('[data-testid="accept-reskflow"]').first().click();
    await page.click('[data-testid="confirm-accept"]');
    
    // Check navigation features
    await expect(page.locator('[data-testid="navigation-map"]')).toBeVisible();
    await expect(page.locator('[data-testid="estimated-time"]')).toBeVisible();
    await expect(page.locator('[data-testid="distance-remaining"]')).toBeVisible();
    
    // Open navigation app
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click('[data-testid="open-in-maps"]')
    ]);
    
    // Should open maps with correct destination
    expect(newPage.url()).toMatch(/maps|waze|google/);
    await newPage.close();
    
    // Report navigation issue
    await page.click('[data-testid="report-navigation-issue"]');
    await page.selectOption('[data-testid="issue-type"]', 'wrong-address');
    await page.fill('[data-testid="issue-description"]', 'Restaurant is actually next door');
    await page.click('[data-testid="submit-issue"]');
    
    await expect(page.locator('[data-testid="issue-reported"]')).toBeVisible();
  });
  
  test('should manage availability and breaks', async ({ page }) => {
    // Go online
    await page.locator('[data-testid="driver-status-toggle"]').click();
    
    // Take a break
    await page.click('[data-testid="take-break"]');
    await page.selectOption('[data-testid="break-duration"]', '30');
    await page.click('[data-testid="start-break"]');
    
    // Status should show on break
    await expect(page.locator('[data-testid="status-indicator"]')).toContainText('On Break');
    await expect(page.locator('[data-testid="break-timer"]')).toBeVisible();
    
    // End break early
    await page.click('[data-testid="end-break"]');
    await expect(page.locator('[data-testid="status-indicator"]')).toContainText('Online');
    
    // Go offline
    await page.locator('[data-testid="driver-status-toggle"]').click();
    await expect(page.locator('[data-testid="status-indicator"]')).toContainText('Offline');
  });
  
  test('should view earnings and history', async ({ page }) => {
    // Navigate to earnings
    await page.click('[data-testid="view-earnings"]');
    await page.waitForURL('/driver/earnings');
    
    // Daily earnings
    await expect(page.locator('[data-testid="daily-earnings"]')).toBeVisible();
    await expect(page.locator('[data-testid="deliveries-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="tips-earned"]')).toBeVisible();
    
    // Weekly summary
    await expect(page.locator('[data-testid="weekly-summary"]')).toBeVisible();
    
    // Delivery history
    await page.click('[data-testid="reskflow-history-tab"]');
    await expect(page.locator('[data-testid="reskflow-list"]')).toBeVisible();
    
    // Filter by date
    await page.fill('[data-testid="date-from"]', '2024-01-01');
    await page.fill('[data-testid="date-to"]', '2024-01-31');
    await page.click('[data-testid="apply-filter"]');
    
    // View reskflow details
    const firstDelivery = page.locator('[data-testid="reskflow-row"]').first();
    if (await firstDelivery.isVisible()) {
      await firstDelivery.click();
      await expect(page.locator('[data-testid="reskflow-details-modal"]')).toBeVisible();
      await expect(page.locator('[data-testid="reskflow-route"]')).toBeVisible();
      await expect(page.locator('[data-testid="reskflow-timeline"]')).toBeVisible();
    }
  });
  
  test('should handle customer communication', async ({ page }) => {
    // Accept a reskflow first
    await page.locator('[data-testid="driver-status-toggle"]').click();
    await page.waitForSelector('[data-testid="reskflow-card"]');
    await page.locator('[data-testid="accept-reskflow"]').first().click();
    await page.click('[data-testid="confirm-accept"]');
    
    // After pickup, heading to customer
    await page.click('[data-testid="arrived-at-pickup"]');
    await page.click('[data-testid="confirm-pickup"]');
    
    // Contact customer
    await page.click('[data-testid="contact-customer"]');
    
    // Choose contact method
    await page.click('[data-testid="call-customer"]');
    
    // Should show calling interface (mocked)
    await expect(page.locator('[data-testid="calling-screen"]')).toBeVisible();
    await page.click('[data-testid="end-call"]');
    
    // Send message
    await page.click('[data-testid="message-customer"]');
    await page.selectOption('[data-testid="quick-message"]', 'on-my-way');
    await page.click('[data-testid="send-message"]');
    
    await expect(page.locator('[data-testid="message-sent"]')).toBeVisible();
  });
  
  test('should handle reskflow issues', async ({ page }) => {
    // Assume driver has active reskflow
    const hasActiveDelivery = await page.locator('[data-testid="active-reskflow"]').isVisible();
    
    if (!hasActiveDelivery) {
      await page.locator('[data-testid="driver-status-toggle"]').click();
      await page.waitForSelector('[data-testid="reskflow-card"]');
      await page.locator('[data-testid="accept-reskflow"]').first().click();
      await page.click('[data-testid="confirm-accept"]');
    }
    
    // Report issue
    await page.click('[data-testid="report-issue"]');
    
    // Select issue type
    await page.selectOption('[data-testid="issue-category"]', 'customer-unavailable');
    
    // Follow resolution steps
    await expect(page.locator('[data-testid="resolution-steps"]')).toBeVisible();
    
    // Try contacting customer
    await page.click('[data-testid="contact-customer-step"]');
    await page.click('[data-testid="tried-calling"]');
    
    // Start timer
    await page.click('[data-testid="start-wait-timer"]');
    await expect(page.locator('[data-testid="wait-timer"]')).toBeVisible();
    
    // If customer doesn't respond, follow protocol
    await page.click('[data-testid="customer-not-responding"]');
    await page.selectOption('[data-testid="reskflow-outcome"]', 'left-at-door');
    
    // Take photo proof
    await page.setInputFiles('[data-testid="photo-proof"]', {
      name: 'reskflow-proof.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fake-image-data')
    });
    
    // Complete reskflow
    await page.click('[data-testid="complete-with-issue"]');
    
    await expect(page.locator('[data-testid="issue-resolved"]')).toBeVisible();
  });
});