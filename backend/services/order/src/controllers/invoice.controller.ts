import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from '../services/invoice.service';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import fs from 'fs/promises';

export class InvoiceController {
  private invoiceService: InvoiceService;

  constructor() {
    this.invoiceService = new InvoiceService();
  }

  getInvoice = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invoiceId } = req.params;
      
      const invoice = await this.invoiceService.getInvoice(invoiceId);
      
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      // Check access
      if (invoice.order.userId !== req.user!.userId && 
          req.user!.role !== 'ADMIN' &&
          (req.user!.role !== 'MERCHANT' || invoice.order.merchantId !== req.user!.merchantId)) {
        throw new ForbiddenError('Access denied');
      }

      res.json({ invoice });
    } catch (error) {
      next(error);
    }
  };

  getInvoiceByOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      
      const invoice = await this.invoiceService.getInvoiceByOrderId(orderId);
      
      if (!invoice) {
        throw new NotFoundError('Invoice not found for this order');
      }

      // Check access
      if (invoice.order.userId !== req.user!.userId && 
          req.user!.role !== 'ADMIN' &&
          (req.user!.role !== 'MERCHANT' || invoice.order.merchantId !== req.user!.merchantId)) {
        throw new ForbiddenError('Access denied');
      }

      res.json({ invoice });
    } catch (error) {
      next(error);
    }
  };

  downloadInvoice = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invoiceId } = req.params;
      
      const invoice = await this.invoiceService.getInvoice(invoiceId);
      
      if (!invoice) {
        throw new NotFoundError('Invoice not found');
      }

      // Check access
      if (invoice.order.userId !== req.user!.userId && 
          req.user!.role !== 'ADMIN' &&
          (req.user!.role !== 'MERCHANT' || invoice.order.merchantId !== req.user!.merchantId)) {
        throw new ForbiddenError('Access denied');
      }

      if (!invoice.invoiceUrl) {
        throw new NotFoundError('Invoice PDF not found');
      }

      // Check if file exists
      try {
        await fs.access(invoice.invoiceUrl);
      } catch {
        throw new NotFoundError('Invoice file not found');
      }

      // Stream the PDF file
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`
      );

      const fileStream = await fs.readFile(invoice.invoiceUrl);
      res.send(fileStream);
    } catch (error) {
      next(error);
    }
  };
}