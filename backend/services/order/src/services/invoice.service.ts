import fs from 'fs/promises';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Invoice, Order } from '@prisma/client';
import { prisma } from '../config/database';
import { config } from '../config';
import { generateInvoiceNumber, formatCurrency } from '../utils/helpers';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export class InvoiceService {
  async createInvoice(orderId: string): Promise<Invoice> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        invoice: true,
      },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    if (order.invoice) {
      return order.invoice;
    }

    // Get user and merchant details (would normally fetch from services)
    const customerInfo = {
      name: 'Customer Name', // Would fetch from user service
      email: 'customer@example.com',
      phone: '+1234567890',
    };

    const merchantInfo = {
      name: 'Merchant Name', // Would fetch from merchant service
      address: '123 Merchant St',
      phone: '+0987654321',
      taxId: 'TAX123456',
    };

    const invoiceNumber = generateInvoiceNumber();
    const invoiceData = {
      invoiceNumber,
      customerInfo,
      merchantInfo,
      items: order.items.map(item => ({
        name: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.totalPrice,
      })),
      subtotal: order.subtotal,
      tax: order.tax,
      total: order.total,
    };

    // Generate PDF
    const pdfPath = await this.generateInvoicePDF(order, invoiceData);

    // Save invoice record
    const invoice = await prisma.invoice.create({
      data: {
        orderId,
        invoiceNumber,
        invoiceUrl: pdfPath,
        customerInfo,
        merchantInfo,
        items: invoiceData.items,
        subtotal: order.subtotal,
        tax: order.tax,
        total: order.total,
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        paidAt: order.paymentStatus === 'COMPLETED' ? new Date() : null,
      },
    });

    logger.info(`Invoice created for order ${order.orderNumber}: ${invoiceNumber}`);
    return invoice;
  }

  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    return prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        order: true,
      },
    });
  }

  async getInvoiceByOrderId(orderId: string): Promise<Invoice | null> {
    return prisma.invoice.findUnique({
      where: { orderId },
      include: {
        order: true,
      },
    });
  }

  private async generateInvoicePDF(order: Order, invoiceData: any): Promise<string> {
    const doc = new PDFDocument({ margin: 50 });
    const fileName = `invoice-${invoiceData.invoiceNumber}.pdf`;
    const filePath = path.join(config.invoice.storagePath, fileName);

    // Ensure directory exists
    await fs.mkdir(config.invoice.storagePath, { recursive: true });

    // Create write stream
    const stream = doc.pipe(fs.createWriteStream(filePath));

    // Header
    doc.fontSize(20).text(config.invoice.company.name, { align: 'center' });
    doc.fontSize(10).text(config.invoice.company.address, { align: 'center' });
    doc.text(`Tax ID: ${config.invoice.company.taxId}`, { align: 'center' });
    doc.moveDown();

    // Invoice title
    doc.fontSize(16).text('INVOICE', { align: 'center' });
    doc.moveDown();

    // Invoice details
    doc.fontSize(10);
    doc.text(`Invoice Number: ${invoiceData.invoiceNumber}`);
    doc.text(`Order Number: ${order.orderNumber}`);
    doc.text(`Date: ${new Date().toLocaleDateString()}`);
    doc.moveDown();

    // Customer info
    doc.fontSize(12).text('Bill To:', { underline: true });
    doc.fontSize(10);
    doc.text(invoiceData.customerInfo.name);
    doc.text(invoiceData.customerInfo.email);
    doc.text(invoiceData.customerInfo.phone);
    doc.moveDown();

    // Merchant info
    doc.fontSize(12).text('From:', { underline: true });
    doc.fontSize(10);
    doc.text(invoiceData.merchantInfo.name);
    doc.text(invoiceData.merchantInfo.address);
    doc.text(invoiceData.merchantInfo.phone);
    doc.moveDown();

    // Items table
    doc.fontSize(12).text('Order Items:', { underline: true });
    doc.moveDown();

    // Table header
    const tableTop = doc.y;
    const itemX = 50;
    const quantityX = 300;
    const priceX = 400;
    const totalX = 480;

    doc.fontSize(10);
    doc.text('Item', itemX, tableTop);
    doc.text('Qty', quantityX, tableTop);
    doc.text('Price', priceX, tableTop);
    doc.text('Total', totalX, tableTop);
    doc.moveDown();

    // Items
    invoiceData.items.forEach((item: any) => {
      const y = doc.y;
      doc.text(item.name, itemX, y);
      doc.text(item.quantity.toString(), quantityX, y);
      doc.text(formatCurrency(item.unitPrice), priceX, y);
      doc.text(formatCurrency(item.total), totalX, y);
      doc.moveDown();
    });

    // Totals
    doc.moveDown();
    const totalsX = 400;
    doc.text('Subtotal:', totalsX, doc.y);
    doc.text(formatCurrency(invoiceData.subtotal), totalX, doc.y);
    doc.moveDown(0.5);
    
    doc.text('Tax:', totalsX, doc.y);
    doc.text(formatCurrency(invoiceData.tax), totalX, doc.y);
    doc.moveDown(0.5);
    
    if (order.reskflowFee > 0) {
      doc.text('Delivery Fee:', totalsX, doc.y);
      doc.text(formatCurrency(order.reskflowFee), totalX, doc.y);
      doc.moveDown(0.5);
    }
    
    if (order.serviceFee > 0) {
      doc.text('Service Fee:', totalsX, doc.y);
      doc.text(formatCurrency(order.serviceFee), totalX, doc.y);
      doc.moveDown(0.5);
    }
    
    if (order.discount > 0) {
      doc.text('Discount:', totalsX, doc.y);
      doc.text(`-${formatCurrency(order.discount)}`, totalX, doc.y);
      doc.moveDown(0.5);
    }
    
    doc.fontSize(12);
    doc.text('Total:', totalsX, doc.y);
    doc.text(formatCurrency(invoiceData.total), totalX, doc.y);

    // Footer
    doc.fontSize(8);
    doc.moveDown(2);
    doc.text('Thank you for your business!', { align: 'center' });

    // Finalize PDF
    doc.end();

    // Wait for stream to finish
    await new Promise((resolve) => stream.on('finish', resolve));

    return filePath;
  }
}