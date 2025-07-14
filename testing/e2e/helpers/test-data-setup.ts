/**
 * Test Data Setup Helper
 * Creates test users, merchants, and products for E2E tests
 */

import { Page } from '@playwright/test';

export interface TestUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: string;
  token?: string;
  id?: string;
}

export interface TestMerchant {
  id: string;
  name: string;
  email: string;
  cuisine: string;
  address: any;
}

export interface TestProduct {
  id: string;
  merchantId: string;
  name: string;
  price: number;
  category: string;
}

export interface TestData {
  users: {
    customer: TestUser;
    merchant: TestUser;
    driver: TestUser;
    admin: TestUser;
  };
  merchants: TestMerchant[];
  products: TestProduct[];
}

export async function setupTestData(page: Page): Promise<TestData> {
  const baseURL = page.url().replace(/\/health$/, '');
  
  // Test users
  const users = {
    customer: {
      email: 'e2e.customer@test.com',
      password: 'Test123!@#',
      firstName: 'Test',
      lastName: 'Customer',
      phone: '+1234567890',
      role: 'CUSTOMER'
    },
    merchant: {
      email: 'e2e.merchant@test.com',
      password: 'Test123!@#',
      firstName: 'Test',
      lastName: 'Merchant',
      phone: '+1234567891',
      role: 'MERCHANT'
    },
    driver: {
      email: 'e2e.driver@test.com',
      password: 'Test123!@#',
      firstName: 'Test',
      lastName: 'Driver',
      phone: '+1234567892',
      role: 'DRIVER'
    },
    admin: {
      email: 'e2e.admin@test.com',
      password: 'Test123!@#',
      firstName: 'Test',
      lastName: 'Admin',
      phone: '+1234567893',
      role: 'ADMIN'
    }
  };
  
  // Create users and get tokens
  for (const [key, user] of Object.entries(users)) {
    try {
      // Register user
      const registerResponse = await page.request.post(`${baseURL}/api/auth/register`, {
        data: user
      });
      
      if (registerResponse.ok()) {
        const userData = await registerResponse.json();
        user.id = userData.id;
        
        // Login to get token
        const loginResponse = await page.request.post(`${baseURL}/api/auth/login`, {
          data: {
            email: user.email,
            password: user.password
          }
        });
        
        if (loginResponse.ok()) {
          const loginData = await loginResponse.json();
          user.token = loginData.tokens.accessToken;
        }
      }
    } catch (error) {
      console.warn(`Failed to create user ${key}:`, error.message);
    }
  }
  
  // Create test merchants
  const merchants: TestMerchant[] = [];
  
  if (users.merchant.token) {
    const merchantsData = [
      {
        name: 'Test Pizza Place',
        email: 'pizza@test.com',
        cuisine: 'Italian',
        description: 'Best test pizzas in town',
        address: {
          street: '123 Pizza St',
          city: 'Test City',
          state: 'TC',
          postalCode: '12345',
          latitude: 37.7749,
          longitude: -122.4194
        },
        phone: '+1234567894',
        minimumOrder: 15.00,
        reskflowFee: 3.99,
        estimatedDeliveryTime: 30,
        operatingHours: {
          monday: { open: '10:00', close: '22:00' },
          tuesday: { open: '10:00', close: '22:00' },
          wednesday: { open: '10:00', close: '22:00' },
          thursday: { open: '10:00', close: '22:00' },
          friday: { open: '10:00', close: '23:00' },
          saturday: { open: '10:00', close: '23:00' },
          sunday: { open: '11:00', close: '21:00' }
        }
      },
      {
        name: 'Test Burger Joint',
        email: 'burger@test.com',
        cuisine: 'American',
        description: 'Juicy test burgers',
        address: {
          street: '456 Burger Ave',
          city: 'Test City',
          state: 'TC',
          postalCode: '12346',
          latitude: 37.7849,
          longitude: -122.4094
        },
        phone: '+1234567895',
        minimumOrder: 12.00,
        reskflowFee: 2.99,
        estimatedDeliveryTime: 25,
        operatingHours: {
          monday: { open: '11:00', close: '23:00' },
          tuesday: { open: '11:00', close: '23:00' },
          wednesday: { open: '11:00', close: '23:00' },
          thursday: { open: '11:00', close: '23:00' },
          friday: { open: '11:00', close: '00:00' },
          saturday: { open: '11:00', close: '00:00' },
          sunday: { open: '12:00', close: '22:00' }
        }
      }
    ];
    
    for (const merchantData of merchantsData) {
      try {
        const response = await page.request.post(`${baseURL}/api/merchants`, {
          data: merchantData,
          headers: {
            Authorization: `Bearer ${users.merchant.token}`
          }
        });
        
        if (response.ok()) {
          const merchant = await response.json();
          merchants.push(merchant);
        }
      } catch (error) {
        console.warn('Failed to create merchant:', error.message);
      }
    }
  }
  
  // Create test products
  const products: TestProduct[] = [];
  
  if (merchants.length > 0 && users.merchant.token) {
    const productsData = [
      // Pizza Place menu
      {
        merchantId: merchants[0]?.id,
        items: [
          {
            name: 'Margherita Pizza',
            description: 'Classic tomato sauce, mozzarella, basil',
            price: 12.99,
            category: 'Pizza',
            image: 'margherita.jpg',
            isAvailable: true
          },
          {
            name: 'Pepperoni Pizza',
            description: 'Tomato sauce, mozzarella, pepperoni',
            price: 14.99,
            category: 'Pizza',
            image: 'pepperoni.jpg',
            isAvailable: true
          },
          {
            name: 'Caesar Salad',
            description: 'Romaine lettuce, croutons, parmesan',
            price: 8.99,
            category: 'Salads',
            image: 'caesar.jpg',
            isAvailable: true
          },
          {
            name: 'Garlic Bread',
            description: 'Fresh baked bread with garlic butter',
            price: 4.99,
            category: 'Appetizers',
            image: 'garlic-bread.jpg',
            isAvailable: true
          }
        ]
      },
      // Burger Joint menu
      {
        merchantId: merchants[1]?.id,
        items: [
          {
            name: 'Classic Burger',
            description: 'Beef patty, lettuce, tomato, onion',
            price: 10.99,
            category: 'Burgers',
            image: 'classic-burger.jpg',
            isAvailable: true
          },
          {
            name: 'Cheeseburger',
            description: 'Beef patty, cheese, lettuce, tomato',
            price: 11.99,
            category: 'Burgers',
            image: 'cheeseburger.jpg',
            isAvailable: true
          },
          {
            name: 'French Fries',
            description: 'Crispy golden fries',
            price: 3.99,
            category: 'Sides',
            image: 'fries.jpg',
            isAvailable: true
          },
          {
            name: 'Milkshake',
            description: 'Vanilla, chocolate, or strawberry',
            price: 5.99,
            category: 'Beverages',
            image: 'milkshake.jpg',
            isAvailable: true
          }
        ]
      }
    ];
    
    for (const { merchantId, items } of productsData) {
      if (!merchantId) continue;
      
      for (const item of items) {
        try {
          const response = await page.request.post(
            `${baseURL}/api/merchants/${merchantId}/menu/items`,
            {
              data: item,
              headers: {
                Authorization: `Bearer ${users.merchant.token}`
              }
            }
          );
          
          if (response.ok()) {
            const product = await response.json();
            products.push({
              ...product,
              merchantId
            });
          }
        } catch (error) {
          console.warn('Failed to create product:', error.message);
        }
      }
    }
  }
  
  return {
    users: users as TestData['users'],
    merchants,
    products
  };
}

export function getTestUser(role: keyof TestData['users']): TestUser {
  const users = JSON.parse(process.env.TEST_USERS || '{}');
  return users[role];
}

export function getTestMerchants(): TestMerchant[] {
  return JSON.parse(process.env.TEST_MERCHANTS || '[]');
}

export function getTestProducts(): TestProduct[] {
  return JSON.parse(process.env.TEST_PRODUCTS || '[]');
}