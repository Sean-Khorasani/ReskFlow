/**
 * Seed Data Script
 * Populates the database with test data for development and testing
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Test data constants
const CUSTOMER_COUNT = 100;
const MERCHANT_COUNT = 30;
const DRIVER_COUNT = 50;
const PARTNER_COUNT = 5;
const PRODUCTS_PER_MERCHANT = 20;
const ORDERS_PER_CUSTOMER = 5;

// Sample data
const cuisineTypes = ['Italian', 'Chinese', 'Mexican', 'Indian', 'Japanese', 'Thai', 'American', 'Mediterranean'];
const vehicleTypes = ['bike', 'car', 'van', 'truck'];
const orderStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled'];
const paymentMethods = ['cash', 'card', 'wallet', 'blockchain'];

async function main() {
  console.log('🌱 Starting seed data generation...');

  try {
    // Clear existing data
    await clearDatabase();

    // Create admin users
    const admins = await createAdmins();
    console.log(`✅ Created ${admins.length} admin users`);

    // Create customers
    const customers = await createCustomers();
    console.log(`✅ Created ${customers.length} customers`);

    // Create merchants and products
    const merchants = await createMerchants();
    console.log(`✅ Created ${merchants.length} merchants`);

    // Create partners and drivers
    const partners = await createPartners();
    console.log(`✅ Created ${partners.length} partners`);

    const drivers = await createDrivers(partners);
    console.log(`✅ Created ${drivers.length} drivers`);

    // Create vehicles
    const vehicles = await createVehicles(partners);
    console.log(`✅ Created ${vehicles.length} vehicles`);

    // Create orders
    const orders = await createOrders(customers, merchants, drivers);
    console.log(`✅ Created ${orders.length} orders`);

    // Create reviews
    const reviews = await createReviews(orders, customers);
    console.log(`✅ Created ${reviews.length} reviews`);

    // Create notifications
    await createNotifications(customers, merchants, drivers);
    console.log(`✅ Created notifications`);

    // Create analytics data
    await createAnalyticsData();
    console.log(`✅ Created analytics data`);

    console.log('✨ Seed data generation completed successfully!');

  } catch (error) {
    console.error('❌ Error seeding data:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

async function clearDatabase() {
  console.log('🗑️  Clearing existing data...');
  
  // Delete in reverse order of dependencies
  await prisma.review.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.partner.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.admin.deleteMany();
  await prisma.user.deleteMany();
}

async function createAdmins() {
  const admins = [
    {
      email: 'admin@reskflow.com',
      password: 'Admin123!',
      name: 'Super Admin',
      role: 'super_admin',
      permissions: ['all'],
    },
    {
      email: 'support@reskflow.com',
      password: 'Support123!',
      name: 'Support Admin',
      role: 'support_admin',
      permissions: ['users', 'orders', 'support'],
    },
    {
      email: 'operations@reskflow.com',
      password: 'Operations123!',
      name: 'Operations Admin',
      role: 'operations_admin',
      permissions: ['merchants', 'drivers', 'deliveries'],
    },
  ];

  return Promise.all(
    admins.map(async (admin) => {
      const hashedPassword = await bcrypt.hash(admin.password, 10);
      
      const user = await prisma.user.create({
        data: {
          email: admin.email,
          password: hashedPassword,
          role: 'admin',
          isActive: true,
          isVerified: true,
        },
      });

      return prisma.admin.create({
        data: {
          userId: user.id,
          name: admin.name,
          role: admin.role,
          permissions: admin.permissions,
        },
      });
    })
  );
}

async function createCustomers() {
  const customers = [];
  
  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName });
    const hashedPassword = await bcrypt.hash('Customer123!', 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'customer',
        isActive: true,
        isVerified: Math.random() > 0.1, // 90% verified
      },
    });

    const customer = await prisma.customer.create({
      data: {
        userId: user.id,
        name: `${firstName} ${lastName}`,
        phone: faker.phone.number('+1##########'),
        addresses: [
          {
            type: 'home',
            address: faker.location.streetAddress(),
            city: faker.location.city(),
            state: faker.location.state({ abbreviated: true }),
            zipCode: faker.location.zipCode(),
            latitude: parseFloat(faker.location.latitude()),
            longitude: parseFloat(faker.location.longitude()),
            isDefault: true,
          },
        ],
        preferences: {
          notifications: {
            email: true,
            sms: Math.random() > 0.3,
            push: Math.random() > 0.2,
          },
          dietary: faker.helpers.arrayElements(['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'], { min: 0, max: 2 }),
        },
        loyaltyPoints: faker.number.int({ min: 0, max: 1000 }),
      },
    });

    customers.push(customer);
  }

  // Add test customer for easy login
  const testUser = await prisma.user.create({
    data: {
      email: 'customer@test.com',
      password: await bcrypt.hash('Test123!', 10),
      role: 'customer',
      isActive: true,
      isVerified: true,
    },
  });

  const testCustomer = await prisma.customer.create({
    data: {
      userId: testUser.id,
      name: 'Test Customer',
      phone: '+1234567890',
      addresses: [
        {
          type: 'home',
          address: '123 Test Street',
          city: 'Test City',
          state: 'TC',
          zipCode: '12345',
          latitude: 40.7128,
          longitude: -74.0060,
          isDefault: true,
        },
      ],
      loyaltyPoints: 500,
    },
  });

  customers.push(testCustomer);
  return customers;
}

async function createMerchants() {
  const merchants = [];
  const categories = await createCategories();

  for (let i = 0; i < MERCHANT_COUNT; i++) {
    const businessName = faker.company.name() + ' ' + faker.helpers.arrayElement(['Restaurant', 'Kitchen', 'Diner', 'Cafe', 'Bistro']);
    const email = faker.internet.email({ firstName: businessName.toLowerCase().replace(/\s/g, '') });
    const hashedPassword = await bcrypt.hash('Merchant123!', 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'merchant',
        isActive: true,
        isVerified: true,
      },
    });

    const merchant = await prisma.merchant.create({
      data: {
        userId: user.id,
        businessName,
        ownerName: faker.person.fullName(),
        phone: faker.phone.number('+1##########'),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state({ abbreviated: true }),
        zipCode: faker.location.zipCode(),
        latitude: parseFloat(faker.location.latitude()),
        longitude: parseFloat(faker.location.longitude()),
        cuisine: faker.helpers.arrayElement(cuisineTypes),
        description: faker.company.catchPhrase(),
        rating: parseFloat(faker.number.float({ min: 3.5, max: 5.0, precision: 0.1 }).toFixed(1)),
        isActive: Math.random() > 0.1, // 90% active
        commission: faker.number.float({ min: 10, max: 20, precision: 0.5 }),
        businessHours: {
          monday: { open: '09:00', close: '22:00' },
          tuesday: { open: '09:00', close: '22:00' },
          wednesday: { open: '09:00', close: '22:00' },
          thursday: { open: '09:00', close: '22:00' },
          friday: { open: '09:00', close: '23:00' },
          saturday: { open: '10:00', close: '23:00' },
          sunday: { open: '10:00', close: '21:00' },
        },
        reskflowRadius: faker.number.int({ min: 3, max: 10 }),
        minOrderAmount: faker.number.int({ min: 10, max: 30 }),
        preparationTime: faker.number.int({ min: 15, max: 45 }),
      },
    });

    // Create products for merchant
    await createProductsForMerchant(merchant.id, categories);
    
    merchants.push(merchant);
  }

  // Add test merchant
  const testUser = await prisma.user.create({
    data: {
      email: 'merchant@test.com',
      password: await bcrypt.hash('Test123!', 10),
      role: 'merchant',
      isActive: true,
      isVerified: true,
    },
  });

  const testMerchant = await prisma.merchant.create({
    data: {
      userId: testUser.id,
      businessName: 'Test Restaurant',
      ownerName: 'Test Owner',
      phone: '+1234567890',
      address: '456 Test Avenue',
      city: 'Test City',
      state: 'TC',
      zipCode: '12345',
      latitude: 40.7128,
      longitude: -74.0060,
      cuisine: 'Italian',
      description: 'The best test restaurant in town!',
      rating: 4.5,
      isActive: true,
      commission: 15,
      reskflowRadius: 5,
      minOrderAmount: 15,
      preparationTime: 30,
    },
  });

  await createProductsForMerchant(testMerchant.id, categories);
  merchants.push(testMerchant);

  return merchants;
}

async function createCategories() {
  const categoryNames = ['Appetizers', 'Main Course', 'Desserts', 'Beverages', 'Salads', 'Soups', 'Sides', 'Specials'];
  
  return Promise.all(
    categoryNames.map((name) =>
      prisma.category.create({
        data: {
          name,
          description: `${name} category`,
        },
      })
    )
  );
}

async function createProductsForMerchant(merchantId: string, categories: any[]) {
  const products = [];
  
  for (let i = 0; i < PRODUCTS_PER_MERCHANT; i++) {
    const category = faker.helpers.arrayElement(categories);
    const product = await prisma.product.create({
      data: {
        merchantId,
        categoryId: category.id,
        name: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        price: parseFloat(faker.commerce.price({ min: 5, max: 50, dec: 2 })),
        image: faker.image.urlLoremFlickr({ category: 'food' }),
        isAvailable: Math.random() > 0.1, // 90% available
        preparationTime: faker.number.int({ min: 10, max: 30 }),
        nutritionalInfo: {
          calories: faker.number.int({ min: 100, max: 800 }),
          protein: faker.number.int({ min: 5, max: 40 }),
          carbs: faker.number.int({ min: 10, max: 80 }),
          fat: faker.number.int({ min: 5, max: 30 }),
        },
        tags: faker.helpers.arrayElements(['popular', 'spicy', 'vegetarian', 'vegan', 'gluten-free', 'new'], { min: 0, max: 3 }),
      },
    });
    products.push(product);
  }
  
  return products;
}

async function createPartners() {
  const partners = [];
  
  for (let i = 0; i < PARTNER_COUNT; i++) {
    const companyName = faker.company.name() + ' Logistics';
    const email = faker.internet.email({ firstName: companyName.toLowerCase().replace(/\s/g, '') });
    const hashedPassword = await bcrypt.hash('Partner123!', 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'partner',
        isActive: true,
        isVerified: true,
      },
    });

    const partner = await prisma.partner.create({
      data: {
        userId: user.id,
        companyName,
        contactName: faker.person.fullName(),
        phone: faker.phone.number('+1##########'),
        address: faker.location.streetAddress(),
        city: faker.location.city(),
        state: faker.location.state({ abbreviated: true }),
        zipCode: faker.location.zipCode(),
        commissionRate: faker.number.float({ min: 5, max: 15, precision: 0.5 }),
        isActive: true,
      },
    });

    partners.push(partner);
  }

  // Add test partner
  const testUser = await prisma.user.create({
    data: {
      email: 'partner@test.com',
      password: await bcrypt.hash('Test123!', 10),
      role: 'partner',
      isActive: true,
      isVerified: true,
    },
  });

  const testPartner = await prisma.partner.create({
    data: {
      userId: testUser.id,
      companyName: 'Test Logistics',
      contactName: 'Test Partner',
      phone: '+1234567890',
      address: '789 Test Boulevard',
      city: 'Test City',
      state: 'TC',
      zipCode: '12345',
      commissionRate: 10,
      isActive: true,
    },
  });

  partners.push(testPartner);
  return partners;
}

async function createDrivers(partners: any[]) {
  const drivers = [];
  
  for (let i = 0; i < DRIVER_COUNT; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName });
    const hashedPassword = await bcrypt.hash('Driver123!', 10);
    
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role: 'driver',
        isActive: true,
        isVerified: true,
      },
    });

    const driver = await prisma.driver.create({
      data: {
        userId: user.id,
        partnerId: faker.helpers.arrayElement(partners).id,
        name: `${firstName} ${lastName}`,
        phone: faker.phone.number('+1##########'),
        licenseNumber: faker.string.alphanumeric(10).toUpperCase(),
        vehicleType: faker.helpers.arrayElement(vehicleTypes),
        rating: parseFloat(faker.number.float({ min: 4.0, max: 5.0, precision: 0.1 }).toFixed(1)),
        isActive: Math.random() > 0.2, // 80% active
        isAvailable: Math.random() > 0.3, // 70% available
        currentLocation: {
          latitude: parseFloat(faker.location.latitude()),
          longitude: parseFloat(faker.location.longitude()),
        },
        totalDeliveries: faker.number.int({ min: 50, max: 1000 }),
        successRate: faker.number.float({ min: 90, max: 99, precision: 0.1 }),
      },
    });

    drivers.push(driver);
  }

  // Add test driver
  const testUser = await prisma.user.create({
    data: {
      email: 'driver@test.com',
      password: await bcrypt.hash('Test123!', 10),
      role: 'driver',
      isActive: true,
      isVerified: true,
    },
  });

  const testDriver = await prisma.driver.create({
    data: {
      userId: testUser.id,
      partnerId: partners[0].id,
      name: 'Test Driver',
      phone: '+1234567890',
      licenseNumber: 'TEST123456',
      vehicleType: 'car',
      rating: 4.8,
      isActive: true,
      isAvailable: true,
      currentLocation: {
        latitude: 40.7128,
        longitude: -74.0060,
      },
      totalDeliveries: 500,
      successRate: 95.5,
    },
  });

  drivers.push(testDriver);
  return drivers;
}

async function createVehicles(partners: any[]) {
  const vehicles = [];
  const makes = ['Toyota', 'Honda', 'Ford', 'Chevrolet', 'Nissan'];
  const models = ['Camry', 'Accord', 'F-150', 'Silverado', 'Altima'];
  
  for (const partner of partners) {
    // Create 3-5 vehicles per partner
    const vehicleCount = faker.number.int({ min: 3, max: 5 });
    
    for (let i = 0; i < vehicleCount; i++) {
      const vehicle = await prisma.vehicle.create({
        data: {
          partnerId: partner.id,
          type: faker.helpers.arrayElement(vehicleTypes),
          make: faker.helpers.arrayElement(makes),
          model: faker.helpers.arrayElement(models),
          year: faker.number.int({ min: 2018, max: 2024 }),
          licensePlate: faker.string.alphanumeric(7).toUpperCase(),
          vin: faker.vehicle.vin(),
          color: faker.vehicle.color(),
          isActive: Math.random() > 0.1, // 90% active
          mileage: faker.number.int({ min: 10000, max: 100000 }),
          lastMaintenance: faker.date.recent({ days: 90 }),
          nextMaintenance: faker.date.future({ years: 0.25 }),
        },
      });
      vehicles.push(vehicle);
    }
  }
  
  return vehicles;
}

async function createOrders(customers: any[], merchants: any[], drivers: any[]) {
  const orders = [];
  
  for (const customer of customers.slice(0, 50)) { // Create orders for first 50 customers
    const orderCount = faker.number.int({ min: 1, max: ORDERS_PER_CUSTOMER });
    
    for (let i = 0; i < orderCount; i++) {
      const merchant = faker.helpers.arrayElement(merchants);
      const status = faker.helpers.arrayElement(orderStatuses);
      const driver = ['picked_up', 'delivered'].includes(status) ? faker.helpers.arrayElement(drivers) : null;
      
      // Get products for this merchant
      const products = await prisma.product.findMany({
        where: { merchantId: merchant.id },
        take: faker.number.int({ min: 1, max: 5 }),
      });
      
      if (products.length === 0) continue;
      
      const orderItems = products.map((product) => ({
        productId: product.id,
        quantity: faker.number.int({ min: 1, max: 3 }),
        price: product.price,
        specialInstructions: Math.random() > 0.7 ? faker.lorem.sentence() : null,
      }));
      
      const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const reskflowFee = faker.number.float({ min: 2.99, max: 5.99, precision: 0.01 });
      const taxes = subtotal * 0.08; // 8% tax
      const total = subtotal + reskflowFee + taxes;
      
      const order = await prisma.order.create({
        data: {
          customerId: customer.id,
          merchantId: merchant.id,
          driverId: driver?.id,
          orderNumber: `ORD-${Date.now()}-${faker.string.alphanumeric(6).toUpperCase()}`,
          status,
          paymentMethod: faker.helpers.arrayElement(paymentMethods),
          paymentStatus: status === 'delivered' ? 'paid' : 'pending',
          reskflowAddress: customer.addresses[0].address,
          reskflowLocation: {
            latitude: customer.addresses[0].latitude,
            longitude: customer.addresses[0].longitude,
          },
          subtotal,
          reskflowFee,
          taxes,
          tip: status === 'delivered' ? faker.number.float({ min: 0, max: 10, precision: 0.01 }) : 0,
          total,
          estimatedDeliveryTime: faker.date.future({ years: 0.001 }), // Within next ~9 hours
          actualDeliveryTime: status === 'delivered' ? faker.date.recent({ days: 1 }) : null,
          items: {
            create: orderItems,
          },
        },
      });
      
      orders.push(order);
    }
  }
  
  return orders;
}

async function createReviews(orders: any[], customers: any[]) {
  const reviews = [];
  const deliveredOrders = await prisma.order.findMany({
    where: { status: 'delivered' },
    include: { customer: true, merchant: true, driver: true },
  });
  
  for (const order of deliveredOrders.slice(0, 100)) { // Create reviews for first 100 delivered orders
    // Review for merchant
    if (Math.random() > 0.3) { // 70% leave reviews
      const merchantReview = await prisma.review.create({
        data: {
          customerId: order.customerId,
          merchantId: order.merchantId,
          orderId: order.id,
          rating: faker.number.int({ min: 3, max: 5 }),
          comment: faker.lorem.paragraph(),
          type: 'merchant',
        },
      });
      reviews.push(merchantReview);
    }
    
    // Review for driver
    if (order.driverId && Math.random() > 0.4) { // 60% leave driver reviews
      const driverReview = await prisma.review.create({
        data: {
          customerId: order.customerId,
          driverId: order.driverId,
          orderId: order.id,
          rating: faker.number.int({ min: 3, max: 5 }),
          comment: faker.lorem.sentence(),
          type: 'driver',
        },
      });
      reviews.push(driverReview);
    }
  }
  
  return reviews;
}

async function createNotifications(customers: any[], merchants: any[], drivers: any[]) {
  const notificationTypes = ['order_update', 'promotion', 'system', 'payment'];
  
  // Create notifications for random users
  const allUsers = [
    ...customers.slice(0, 20).map(c => ({ id: c.userId, type: 'customer' })),
    ...merchants.slice(0, 10).map(m => ({ id: m.userId, type: 'merchant' })),
    ...drivers.slice(0, 10).map(d => ({ id: d.userId, type: 'driver' })),
  ];
  
  for (const user of allUsers) {
    const notificationCount = faker.number.int({ min: 1, max: 5 });
    
    for (let i = 0; i < notificationCount; i++) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: faker.helpers.arrayElement(notificationTypes),
          title: faker.lorem.sentence({ min: 3, max: 5 }),
          message: faker.lorem.paragraph(),
          isRead: Math.random() > 0.3, // 70% read
          data: {
            userType: user.type,
            timestamp: faker.date.recent({ days: 7 }),
          },
        },
      });
    }
  }
}

async function createAnalyticsData() {
  // This would typically be handled by the analytics service
  // For now, we'll just log that it would be created
  console.log('📊 Analytics data would be generated based on orders and user activity');
}

// Run the seed script
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });