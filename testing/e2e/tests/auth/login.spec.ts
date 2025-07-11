/**
 * E2E Tests: User Authentication - Login
 */

import { test, expect } from '@playwright/test';
import { getTestUser } from '../../helpers/test-data-setup';

test.describe('User Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });
  
  test('should display login page correctly', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Login | ReskFlow/);
    
    // Check form elements
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();
    
    // Check links
    await expect(page.locator('text=Forgot password?')).toBeVisible();
    await expect(page.locator('text=Create account')).toBeVisible();
  });
  
  test('should login successfully with valid credentials', async ({ page }) => {
    const customer = getTestUser('customer');
    
    // Fill form
    await page.fill('[data-testid="email-input"]', customer.email);
    await page.fill('[data-testid="password-input"]', customer.password);
    
    // Submit
    await page.click('[data-testid="login-button"]');
    
    // Wait for redirect
    await page.waitForURL('/dashboard', { timeout: 10000 });
    
    // Verify logged in
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-name"]')).toContainText(customer.firstName);
  });
  
  test('should show error with invalid credentials', async ({ page }) => {
    // Fill form with invalid credentials
    await page.fill('[data-testid="email-input"]', 'invalid@email.com');
    await page.fill('[data-testid="password-input"]', 'wrongpassword');
    
    // Submit
    await page.click('[data-testid="login-button"]');
    
    // Check error message
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/Invalid credentials/i);
    
    // Should stay on login page
    await expect(page).toHaveURL(/\/login/);
  });
  
  test('should validate email format', async ({ page }) => {
    // Enter invalid email
    await page.fill('[data-testid="email-input"]', 'invalidemail');
    await page.fill('[data-testid="password-input"]', 'password123');
    
    // Try to submit
    await page.click('[data-testid="login-button"]');
    
    // Check validation error
    await expect(page.locator('[data-testid="email-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="email-error"]')).toContainText(/valid email/i);
  });
  
  test('should require password', async ({ page }) => {
    // Enter only email
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    
    // Try to submit
    await page.click('[data-testid="login-button"]');
    
    // Check validation error
    await expect(page.locator('[data-testid="password-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-error"]')).toContainText(/required/i);
  });
  
  test('should toggle password visibility', async ({ page }) => {
    const password = 'TestPassword123';
    
    // Enter password
    await page.fill('[data-testid="password-input"]', password);
    
    // Initially password should be hidden
    await expect(page.locator('[data-testid="password-input"]')).toHaveAttribute('type', 'password');
    
    // Click toggle button
    await page.click('[data-testid="toggle-password"]');
    
    // Password should be visible
    await expect(page.locator('[data-testid="password-input"]')).toHaveAttribute('type', 'text');
    
    // Click again to hide
    await page.click('[data-testid="toggle-password"]');
    await expect(page.locator('[data-testid="password-input"]')).toHaveAttribute('type', 'password');
  });
  
  test('should remember me when checked', async ({ page, context }) => {
    const customer = getTestUser('customer');
    
    // Check remember me
    await page.check('[data-testid="remember-me"]');
    
    // Login
    await page.fill('[data-testid="email-input"]', customer.email);
    await page.fill('[data-testid="password-input"]', customer.password);
    await page.click('[data-testid="login-button"]');
    
    // Wait for redirect
    await page.waitForURL('/dashboard');
    
    // Get cookies
    const cookies = await context.cookies();
    const authCookie = cookies.find(c => c.name === 'auth_token' || c.name === 'refresh_token');
    
    // Check cookie has long expiration (more than 7 days)
    expect(authCookie).toBeDefined();
    expect(authCookie!.expires).toBeGreaterThan(Date.now() / 1000 + 7 * 24 * 60 * 60);
  });
  
  test('should redirect to requested page after login', async ({ page }) => {
    const customer = getTestUser('customer');
    
    // Try to access protected page
    await page.goto('/orders');
    
    // Should redirect to login with return URL
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Forders/);
    
    // Login
    await page.fill('[data-testid="email-input"]', customer.email);
    await page.fill('[data-testid="password-input"]', customer.password);
    await page.click('[data-testid="login-button"]');
    
    // Should redirect to originally requested page
    await page.waitForURL('/orders');
  });
  
  test('should handle network errors gracefully', async ({ page, context }) => {
    // Simulate network error
    await context.route('**/api/auth/login', route => {
      route.abort('failed');
    });
    
    const customer = getTestUser('customer');
    
    // Try to login
    await page.fill('[data-testid="email-input"]', customer.email);
    await page.fill('[data-testid="password-input"]', customer.password);
    await page.click('[data-testid="login-button"]');
    
    // Should show error message
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/network error|connection/i);
  });
  
  test('should prevent multiple login attempts', async ({ page }) => {
    // Make multiple failed login attempts
    for (let i = 0; i < 5; i++) {
      await page.fill('[data-testid="email-input"]', 'test@example.com');
      await page.fill('[data-testid="password-input"]', 'wrongpassword');
      await page.click('[data-testid="login-button"]');
      
      // Wait for error
      await page.waitForSelector('[data-testid="error-message"]');
      
      // Clear form
      await page.fill('[data-testid="email-input"]', '');
      await page.fill('[data-testid="password-input"]', '');
    }
    
    // After 5 attempts, should show rate limit message
    await page.fill('[data-testid="email-input"]', 'test@example.com');
    await page.fill('[data-testid="password-input"]', 'password');
    await page.click('[data-testid="login-button"]');
    
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/too many attempts|try again later/i);
  });
  
  test('should navigate to forgot password', async ({ page }) => {
    // Click forgot password link
    await page.click('text=Forgot password?');
    
    // Should navigate to forgot password page
    await expect(page).toHaveURL('/forgot-password');
    await expect(page.locator('h1')).toContainText(/Forgot Password/i);
  });
  
  test('should navigate to sign up', async ({ page }) => {
    // Click create account link
    await page.click('text=Create account');
    
    // Should navigate to sign up page
    await expect(page).toHaveURL('/signup');
    await expect(page.locator('h1')).toContainText(/Sign Up|Create Account/i);
  });
});