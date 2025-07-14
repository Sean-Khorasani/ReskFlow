/**
 * End-to-End Test: Driver Delivery Flow
 * Tests the complete flow for drivers from login to reskflow completion
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:4000/api';

const testDriver = {
  email: 'driver@test.com',
  password: 'Test123!',
};

test.describe('Driver Delivery Flow', () => {
  let authToken: string;
  let driverId: string;

  test.beforeAll(async ({ request }) => {
    // Login as driver
    const loginResponse = await request.post(`${API_URL}/auth/login`, {
      data: testDriver,
    });
    
    expect(loginResponse.ok()).toBeTruthy();
    const loginData = await loginResponse.json();
    authToken = loginData.token;
    driverId = loginData.user.id;
  });

  test('should go online and receive reskflow requests', async ({ page }) => {
    // Set auth token
    await page.addInitScript((token) => {
      localStorage.setItem('driver_token', token);
    }, authToken);
    
    // Navigate to driver app
    await page.goto(`${BASE_URL}/driver`);
    
    // Toggle online status
    await page.click('[data-testid="online-toggle"]');
    
    // Verify status changed
    await expect(page.locator('[data-testid="driver-status"]')).toContainText('Online');
    
    // Wait for reskflow request
    await page.waitForSelector('[data-testid="reskflow-request"]', { timeout: 60000 });
    
    // Verify request details
    await expect(page.locator('[data-testid="pickup-location"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-location"]')).toBeVisible();
    await expect(page.locator('[data-testid="estimated-earnings"]')).toBeVisible();
  });

  test('should accept reskflow request', async ({ page }) => {
    // Accept the reskflow
    await page.click('[data-testid="accept-reskflow-btn"]');
    
    // Verify navigation to reskflow details
    await page.waitForURL('**/reskflow/*');
    
    // Verify reskflow status
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('Heading to Restaurant');
    
    // Verify navigation button is visible
    await expect(page.locator('[data-testid="start-navigation-btn"]')).toBeVisible();
  });

  test('should navigate to restaurant and confirm arrival', async ({ page }) => {
    // Simulate arrival at restaurant
    await page.click('[data-testid="arrived-at-restaurant-btn"]');
    
    // Verify status update
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('At Restaurant');
    
    // Verify order details are shown
    await expect(page.locator('[data-testid="order-details"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-items"]')).toBeVisible();
  });

  test('should confirm order pickup', async ({ page }) => {
    // Confirm order pickup
    await page.click('[data-testid="confirm-pickup-btn"]');
    
    // Enter order verification code (if required)
    const verificationCode = await page.locator('[data-testid="order-code"]').textContent();
    if (verificationCode) {
      await page.fill('[data-testid="verification-code-input"]', verificationCode);
      await page.click('[data-testid="verify-code-btn"]');
    }
    
    // Verify status update
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('Heading to Customer');
    
    // Verify customer details are shown
    await expect(page.locator('[data-testid="customer-details"]')).toBeVisible();
    await expect(page.locator('[data-testid="reskflow-address"]')).toBeVisible();
  });

  test('should navigate to customer and complete reskflow', async ({ page }) => {
    // Simulate arrival at customer location
    await page.click('[data-testid="arrived-at-customer-btn"]');
    
    // Verify status update
    await expect(page.locator('[data-testid="reskflow-status"]')).toContainText('At Customer Location');
    
    // Contact customer if needed
    const contactButton = page.locator('[data-testid="contact-customer-btn"]');
    if (await contactButton.isVisible()) {
      await contactButton.click();
      // Verify contact options
      await expect(page.locator('[data-testid="call-customer-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="message-customer-btn"]')).toBeVisible();
    }
    
    // Complete reskflow
    await page.click('[data-testid="complete-reskflow-btn"]');
    
    // Confirm reskflow method
    await page.click('[data-testid="reskflow-method-handed"]');
    
    // Take photo proof (if required)
    const photoRequired = await page.locator('[data-testid="photo-proof-required"]').isVisible();
    if (photoRequired) {
      // Simulate photo capture
      await page.click('[data-testid="take-photo-btn"]');
      await page.setInputFiles('[data-testid="photo-input"]', 'tests/fixtures/reskflow-proof.jpg');
    }
    
    // Submit completion
    await page.click('[data-testid="submit-reskflow-btn"]');
    
    // Verify completion
    await expect(page.locator('[data-testid="reskflow-complete-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="earnings-amount"]')).toBeVisible();
  });

  test('should view earnings and statistics', async ({ page }) => {
    // Navigate to earnings page
    await page.click('[data-testid="menu-earnings"]');
    
    // Verify earnings display
    await expect(page.locator('[data-testid="today-earnings"]')).toBeVisible();
    await expect(page.locator('[data-testid="week-earnings"]')).toBeVisible();
    await expect(page.locator('[data-testid="total-deliveries"]')).toBeVisible();
    
    // View detailed statistics
    await page.click('[data-testid="view-details-btn"]');
    
    // Verify statistics
    await expect(page.locator('[data-testid="acceptance-rate"]')).toBeVisible();
    await expect(page.locator('[data-testid="completion-rate"]')).toBeVisible();
    await expect(page.locator('[data-testid="avg-reskflow-time"]')).toBeVisible();
  });

  test('should handle multiple reskflow requests', async ({ page }) => {
    // Go online
    await page.click('[data-testid="online-toggle"]');
    
    // Wait for batch reskflow request
    await page.waitForSelector('[data-testid="batch-reskflow-request"]', { timeout: 60000 });
    
    // Verify multiple orders shown
    const orderCards = await page.$$('[data-testid="batch-order-card"]');
    expect(orderCards.length).toBeGreaterThan(1);
    
    // Accept batch reskflow
    await page.click('[data-testid="accept-batch-btn"]');
    
    // Verify route optimization
    await expect(page.locator('[data-testid="optimized-route"]')).toBeVisible();
    await expect(page.locator('[data-testid="total-distance"]')).toBeVisible();
    await expect(page.locator('[data-testid="estimated-time"]')).toBeVisible();
  });

  test('should handle reskflow issues', async ({ page }) => {
    // Report an issue during reskflow
    await page.click('[data-testid="report-issue-btn"]');
    
    // Select issue type
    await page.click('[data-testid="issue-type-cannot-find-customer"]');
    
    // Add details
    await page.fill('[data-testid="issue-details"]', 'Customer not responding to calls or messages');
    
    // Submit issue
    await page.click('[data-testid="submit-issue-btn"]');
    
    // Verify support contacted
    await expect(page.locator('[data-testid="support-contacted-message"]')).toBeVisible();
    
    // Wait for resolution
    await page.waitForSelector('[data-testid="issue-resolved-message"]', { timeout: 120000 });
  });

  test('should manage availability schedule', async ({ page }) => {
    // Navigate to schedule
    await page.click('[data-testid="menu-schedule"]');
    
    // Set availability for tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    await page.click(`[data-testid="date-${tomorrow.toISOString().split('T')[0]}"]`);
    
    // Set hours
    await page.fill('[data-testid="start-time"]', '09:00');
    await page.fill('[data-testid="end-time"]', '17:00');
    
    // Save schedule
    await page.click('[data-testid="save-schedule-btn"]');
    
    // Verify schedule saved
    await expect(page.locator('[data-testid="schedule-saved-message"]')).toBeVisible();
  });

  test('should track performance metrics', async ({ page }) => {
    // Navigate to performance page
    await page.click('[data-testid="menu-performance"]');
    
    // Verify metrics displayed
    await expect(page.locator('[data-testid="customer-rating"]')).toBeVisible();
    await expect(page.locator('[data-testid="on-time-percentage"]')).toBeVisible();
    await expect(page.locator('[data-testid="acceptance-rate"]')).toBeVisible();
    
    // View feedback
    await page.click('[data-testid="view-feedback-btn"]');
    
    // Verify customer reviews
    const reviews = await page.$$('[data-testid="customer-review"]');
    expect(reviews.length).toBeGreaterThan(0);
  });
});

// Helper function to simulate GPS location
async function updateLocation(page: any, lat: number, lng: number) {
  await page.evaluate(({ latitude, longitude }) => {
    navigator.geolocation.getCurrentPosition = (success) => {
      success({
        coords: {
          latitude,
          longitude,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      });
    };
  }, { latitude: lat, longitude: lng });
}