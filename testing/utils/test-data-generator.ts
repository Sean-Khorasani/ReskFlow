/**
 * Test Data Generator
 */

import { randomBytes } from 'crypto';

export class TestDataGenerator {
  private static counter = 0;

  static getCounter(): number {
    return ++this.counter;
  }

  static generateId(): string {
    return randomBytes(16).toString('hex');
  }

  static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  static generateEmail(prefix = 'test'): string {
    return `${prefix}${this.getCounter()}@test.com`;
  }

  static generatePhone(): string {
    return `+1555${Math.floor(Math.random() * 10000000).toString().padStart(7, '0')}`;
  }

  static generateName(): { firstName: string; lastName: string } {
    const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia'];
    return {
      firstName: firstNames[Math.floor(Math.random() * firstNames.length)],
      lastName: lastNames[Math.floor(Math.random() * lastNames.length)]
    };
  }

  static generateAddress() {
    return {
      street: `${Math.floor(Math.random() * 9999)} Test Street`,
      city: 'Test City',
      state: 'TC',
      postalCode: Math.floor(Math.random() * 90000 + 10000).toString(),
      country: 'US',
      latitude: 37.7749 + (Math.random() - 0.5) * 0.1,
      longitude: -122.4194 + (Math.random() - 0.5) * 0.1
    };
  }

  static generateUser(role: 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'ADMIN' = 'CUSTOMER') {
    const name = this.generateName();
    return {
      email: this.generateEmail(name.firstName.toLowerCase()),
      password: 'Test123!@#',
      firstName: name.firstName,
      lastName: name.lastName,
      phone: this.generatePhone(),
      role,
      address: this.generateAddress()
    };
  }

  static generateMerchant() {
    const cuisines = ['Italian', 'Chinese', 'Mexican', 'Indian', 'American', 'Japanese'];
    return {
      name: `Test Restaurant ${this.getCounter()}`,
      description: 'A test restaurant for automated testing',
      category: 'restaurant',
      cuisine: [cuisines[Math.floor(Math.random() * cuisines.length)]],
      address: this.generateAddress(),
      phone: this.generatePhone(),
      email: this.generateEmail('merchant'),
      hours: this.generateBusinessHours(),
      minimumOrder: Math.floor(Math.random() * 20 + 10),
      reskflowFee: Math.floor(Math.random() * 5 + 2),
      reskflowRadius: Math.floor(Math.random() * 10 + 5)
    };
  }

  static generateMenuItem() {
    const items = [
      { name: 'Pizza Margherita', category: 'Pizza', price: 12.99 },
      { name: 'Chicken Tikka Masala', category: 'Main Course', price: 15.99 },
      { name: 'Caesar Salad', category: 'Salad', price: 8.99 },
      { name: 'Burger Deluxe', category: 'Burger', price: 13.99 },
      { name: 'Pad Thai', category: 'Noodles', price: 11.99 }
    ];
    const item = items[Math.floor(Math.random() * items.length)];
    return {
      ...item,
      description: `Delicious ${item.name}`,
      preparationTime: Math.floor(Math.random() * 20 + 10),
      isAvailable: true,
      isVegetarian: Math.random() > 0.5,
      isVegan: Math.random() > 0.7,
      isGlutenFree: Math.random() > 0.8,
      images: [`https://example.com/images/${item.name.toLowerCase().replace(' ', '-')}.jpg`]
    };
  }

  static generateOrder(customerId: string, merchantId: string, items: any[] = []) {
    if (items.length === 0) {
      items = [
        { menuItemId: this.generateUUID(), quantity: Math.floor(Math.random() * 3 + 1), price: 12.99 }
      ];
    }
    
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.08;
    const reskflowFee = 3.99;
    const total = subtotal + tax + reskflowFee;

    return {
      customerId,
      merchantId,
      items,
      reskflowAddress: this.generateAddress(),
      paymentMethod: 'card',
      subtotal,
      tax,
      reskflowFee,
      total,
      instructions: 'Test order - please handle with care'
    };
  }

  static generatePaymentCard() {
    return {
      number: '4242424242424242',
      expMonth: 12,
      expYear: new Date().getFullYear() + 2,
      cvc: '123',
      name: 'Test User',
      zip: '12345'
    };
  }

  static generateBusinessHours() {
    return [
      { day: 'monday', open: '09:00', close: '22:00' },
      { day: 'tuesday', open: '09:00', close: '22:00' },
      { day: 'wednesday', open: '09:00', close: '22:00' },
      { day: 'thursday', open: '09:00', close: '22:00' },
      { day: 'friday', open: '09:00', close: '23:00' },
      { day: 'saturday', open: '10:00', close: '23:00' },
      { day: 'sunday', open: '10:00', close: '21:00' }
    ];
  }

  static generateDriver() {
    const driver = this.generateUser('DRIVER');
    return {
      ...driver,
      vehicle: {
        make: 'Toyota',
        model: 'Camry',
        year: 2020,
        color: 'Silver',
        licensePlate: `TEST${this.getCounter()}`,
        insurance: {
          provider: 'Test Insurance',
          policyNumber: `POL${this.getCounter()}`,
          expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        }
      },
      documents: {
        driversLicense: {
          number: `DL${this.getCounter()}`,
          state: 'CA',
          expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
        }
      }
    };
  }

  static generateLocation() {
    // San Francisco area coordinates
    const baseLat = 37.7749;
    const baseLng = -122.4194;
    const variance = 0.05; // About 5km variance

    return {
      latitude: baseLat + (Math.random() - 0.5) * variance,
      longitude: baseLng + (Math.random() - 0.5) * variance,
      accuracy: Math.floor(Math.random() * 20 + 5),
      heading: Math.floor(Math.random() * 360),
      speed: Math.floor(Math.random() * 60)
    };
  }

  static async generateBulkData(type: string, count: number): Promise<any[]> {
    const data = [];
    for (let i = 0; i < count; i++) {
      switch (type) {
        case 'users':
          data.push(this.generateUser());
          break;
        case 'merchants':
          data.push(this.generateMerchant());
          break;
        case 'drivers':
          data.push(this.generateDriver());
          break;
        case 'menuItems':
          data.push(this.generateMenuItem());
          break;
        default:
          throw new Error(`Unknown data type: ${type}`);
      }
    }
    return data;
  }
}

// Export commonly used generators
export const {
  generateId,
  generateUUID,
  generateEmail,
  generatePhone,
  generateName,
  generateAddress,
  generateUser,
  generateMerchant,
  generateMenuItem,
  generateOrder,
  generatePaymentCard,
  generateDriver,
  generateLocation,
  generateBulkData
} = TestDataGenerator;