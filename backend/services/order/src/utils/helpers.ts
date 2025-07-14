import crypto from 'crypto';

export function generateOrderNumber(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `ORD-${timestamp}-${random}`.toUpperCase();
}

export function generateInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(3).toString('hex');
  return `INV-${year}-${timestamp}-${random}`.toUpperCase();
}

export function calculateOrderTotal(items: any[], tax: number, reskflowFee: number, serviceFee: number, discount: number = 0): {
  subtotal: number;
  tax: number;
  reskflowFee: number;
  serviceFee: number;
  discount: number;
  total: number;
} {
  const subtotal = items.reduce((sum, item) => sum + (item.unitPrice * item.quantity), 0);
  const total = subtotal + tax + reskflowFee + serviceFee - discount;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    reskflowFee: Math.round(reskflowFee * 100) / 100,
    serviceFee: Math.round(serviceFee * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

export function isOrderCancellable(createdAt: Date, cancellationWindowMinutes: number): boolean {
  const now = new Date();
  const orderAge = (now.getTime() - createdAt.getTime()) / 1000 / 60; // in minutes
  return orderAge <= cancellationWindowMinutes;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function parseDeliveryAddress(address: any): {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
} {
  return {
    street: address.street || '',
    city: address.city || '',
    state: address.state || '',
    postalCode: address.postalCode || '',
    country: address.country || 'US',
    coordinates: address.coordinates ? {
      lat: parseFloat(address.coordinates.lat),
      lng: parseFloat(address.coordinates.lng),
    } : undefined,
  };
}

export function sanitizeOrderData(data: any): any {
  const sanitized = { ...data };
  
  // Remove sensitive fields
  delete sanitized.paymentDetails;
  delete sanitized.internalNotes;
  
  return sanitized;
}