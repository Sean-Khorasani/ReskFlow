/**
 * Authentication Helper for E2E Tests
 */

import { Page, BrowserContext } from '@playwright/test';
import { getTestUser } from './test-data-setup';

export class AuthHelper {
  constructor(private page: Page) {}
  
  /**
   * Login with test user credentials
   */
  async login(role: 'customer' | 'merchant' | 'driver' | 'admin') {
    const user = getTestUser(role);
    
    if (!user) {
      throw new Error(`Test user for role ${role} not found`);
    }
    
    // Go to login page
    await this.page.goto('/login');
    
    // Fill login form
    await this.page.fill('[data-testid="email-input"]', user.email);
    await this.page.fill('[data-testid="password-input"]', user.password);
    
    // Submit form
    await this.page.click('[data-testid="login-button"]');
    
    // Wait for navigation to complete
    await this.page.waitForURL((url) => !url.pathname.includes('/login'), {
      timeout: 10000
    });
    
    // Verify logged in
    await this.page.waitForSelector('[data-testid="user-menu"]', {
      state: 'visible',
      timeout: 5000
    });
    
    return user;
  }
  
  /**
   * Login with API and set authentication state
   */
  async apiLogin(role: 'customer' | 'merchant' | 'driver' | 'admin') {
    const user = getTestUser(role);
    
    if (!user || !user.token) {
      throw new Error(`Test user token for role ${role} not found`);
    }
    
    // Set authentication token in localStorage
    await this.page.addInitScript((token) => {
      localStorage.setItem('auth_token', token);
    }, user.token);
    
    // Set authorization header for API requests
    await this.page.route('**/*', async (route) => {
      const headers = {
        ...route.request().headers(),
        'Authorization': `Bearer ${user.token}`
      };
      await route.continue({ headers });
    });
    
    return user;
  }
  
  /**
   * Logout current user
   */
  async logout() {
    // Click user menu
    await this.page.click('[data-testid="user-menu"]');
    
    // Click logout
    await this.page.click('[data-testid="logout-button"]');
    
    // Wait for redirect to homepage or login
    await this.page.waitForURL((url) => 
      url.pathname === '/' || url.pathname === '/login',
      { timeout: 5000 }
    );
  }
  
  /**
   * Check if user is logged in
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      await this.page.waitForSelector('[data-testid="user-menu"]', {
        state: 'visible',
        timeout: 1000
      });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Get current user info from page
   */
  async getCurrentUser() {
    if (!await this.isLoggedIn()) {
      return null;
    }
    
    // Get user info from page or API
    const userInfo = await this.page.evaluate(() => {
      // Try to get from localStorage or global state
      const token = localStorage.getItem('auth_token');
      if (token) {
        try {
          // Decode JWT (base64)
          const payload = JSON.parse(atob(token.split('.')[1]));
          return payload;
        } catch {
          return null;
        }
      }
      return null;
    });
    
    return userInfo;
  }
}

/**
 * Create authenticated context for a specific role
 */
export async function createAuthenticatedContext(
  browser: any,
  role: 'customer' | 'merchant' | 'driver' | 'admin'
): Promise<BrowserContext> {
  const user = getTestUser(role);
  
  if (!user || !user.token) {
    throw new Error(`Test user token for role ${role} not found`);
  }
  
  // Create context with auth state
  const context = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [{
        origin: process.env.BASE_URL || 'http://localhost:3000',
        localStorage: [{
          name: 'auth_token',
          value: user.token
        }]
      }]
    },
    extraHTTPHeaders: {
      'Authorization': `Bearer ${user.token}`
    }
  });
  
  return context;
}