import sgMail from '@sendgrid/mail';
import mjml2html from 'mjml';
import handlebars from 'handlebars';
import { config, logger } from '@reskflow/shared';
import { readFileSync } from 'fs';
import { join } from 'path';

interface EmailOptions {
  to: string | string[];
  subject: string;
  templateName?: string;
  templateData?: any;
  html?: string;
  text?: string;
  attachments?: Array<{
    content: string;
    filename: string;
    type: string;
    disposition: string;
  }>;
}

export class EmailService {
  private templates: Map<string, handlebars.TemplateDelegate> = new Map();

  constructor() {
    sgMail.setApiKey(config.services.sendgrid.apiKey);
    this.loadTemplates();
    this.registerHelpers();
  }

  private loadTemplates() {
    const templateFiles = [
      'welcome',
      'reskflow-created',
      'reskflow-status',
      'reskflow-completed',
      'payment-receipt',
      'driver-assigned',
      'password-reset',
      'verification',
      'invoice',
    ];

    templateFiles.forEach(name => {
      try {
        const mjmlTemplate = readFileSync(
          join(__dirname, `../templates/email/${name}.mjml`),
          'utf-8'
        );
        const { html } = mjml2html(mjmlTemplate);
        const template = handlebars.compile(html);
        this.templates.set(name, template);
      } catch (error) {
        logger.error(`Failed to load email template: ${name}`, error);
      }
    });
  }

  private registerHelpers() {
    handlebars.registerHelper('formatCurrency', (amount: number, currency = 'USD') => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
      }).format(amount);
    });

    handlebars.registerHelper('formatDate', (date: Date) => {
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(date));
    });

    handlebars.registerHelper('trackingUrl', (trackingNumber: string) => {
      return `https://track.reskflow.com/${trackingNumber}`;
    });
  }

  async sendEmail(options: EmailOptions): Promise<void> {
    try {
      let html = options.html;
      let text = options.text;

      if (options.templateName && options.templateData) {
        const template = this.templates.get(options.templateName);
        if (template) {
          html = template(options.templateData);
          // Simple HTML to text conversion
          text = html?.replace(/<[^>]*>/g, '') || '';
        }
      }

      const msg = {
        to: options.to,
        from: {
          email: config.services.sendgrid.fromEmail,
          name: 'ReskFlow',
        },
        subject: options.subject,
        html,
        text,
        attachments: options.attachments,
        trackingSettings: {
          clickTracking: {
            enable: true,
            enableText: true,
          },
          openTracking: {
            enable: true,
          },
        },
      };

      await sgMail.send(msg);
      
      logger.info('Email sent successfully', {
        to: options.to,
        subject: options.subject,
        template: options.templateName,
      });
    } catch (error) {
      logger.error('Failed to send email', error);
      throw error;
    }
  }

  async sendBulkEmails(
    recipients: string[],
    subject: string,
    templateName: string,
    commonData: any,
    personalizations?: Map<string, any>
  ): Promise<void> {
    try {
      const template = this.templates.get(templateName);
      if (!template) {
        throw new Error(`Template not found: ${templateName}`);
      }

      const messages = recipients.map(recipient => {
        const personalData = personalizations?.get(recipient) || {};
        const html = template({ ...commonData, ...personalData });

        return {
          to: recipient,
          from: {
            email: config.services.sendgrid.fromEmail,
            name: 'ReskFlow',
          },
          subject,
          html,
        };
      });

      // SendGrid allows up to 1000 recipients per request
      const chunks = [];
      for (let i = 0; i < messages.length; i += 1000) {
        chunks.push(messages.slice(i, i + 1000));
      }

      for (const chunk of chunks) {
        await sgMail.send(chunk);
      }

      logger.info('Bulk emails sent', {
        count: recipients.length,
        template: templateName,
      });
    } catch (error) {
      logger.error('Failed to send bulk emails', error);
      throw error;
    }
  }

  async sendDeliveryNotification(
    recipient: string,
    reskflow: any,
    type: 'created' | 'assigned' | 'picked_up' | 'in_transit' | 'delivered'
  ): Promise<void> {
    const subjects = {
      created: 'Your reskflow has been created',
      assigned: 'Driver assigned to your reskflow',
      picked_up: 'Your package has been picked up',
      in_transit: 'Your package is on the way',
      delivered: 'Your package has been delivered!',
    };

    const templateData = {
      reskflow: {
        trackingNumber: reskflow.trackingNumber,
        id: reskflow.id,
        status: reskflow.status,
        estimatedDelivery: reskflow.estimatedDelivery,
        driver: reskflow.driver,
        price: reskflow.price,
      },
      sender: reskflow.sender,
      recipient: reskflow.recipient,
      pickupAddress: reskflow.pickupAddress,
      reskflowAddress: reskflow.reskflowAddress,
      packageDetails: reskflow.packageDetails,
      currentLocation: reskflow.currentLocation,
      statusMessage: this.getStatusMessage(type),
    };

    await this.sendEmail({
      to: recipient,
      subject: subjects[type],
      templateName: 'reskflow-status',
      templateData,
    });
  }

  private getStatusMessage(type: string): string {
    const messages = {
      created: 'Your reskflow request has been received and is being processed.',
      assigned: 'A driver has been assigned and will pick up your package soon.',
      picked_up: 'Your package has been picked up and is on its way.',
      in_transit: 'Your package is currently in transit to the destination.',
      delivered: 'Your package has been successfully delivered!',
    };

    return messages[type as keyof typeof messages] || '';
  }

  async sendInvoice(recipient: string, invoice: any): Promise<void> {
    const templateData = {
      invoice: {
        number: invoice.number,
        date: invoice.date,
        dueDate: invoice.dueDate,
        items: invoice.items,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
      },
      customer: invoice.customer,
      company: {
        name: 'ReskFlow Inc.',
        address: '123 Main St, City, State 12345',
        email: 'billing@reskflow.com',
        phone: '+1 (555) 123-4567',
      },
    };

    // Generate PDF invoice
    const pdfBuffer = await this.generateInvoicePDF(invoice);

    await this.sendEmail({
      to: recipient,
      subject: `Invoice #${invoice.number}`,
      templateName: 'invoice',
      templateData,
      attachments: [
        {
          content: pdfBuffer.toString('base64'),
          filename: `invoice-${invoice.number}.pdf`,
          type: 'application/pdf',
          disposition: 'attachment',
        },
      ],
    });
  }

  private async generateInvoicePDF(invoice: any): Promise<Buffer> {
    // In production, use a PDF generation library like puppeteer or pdfkit
    // This is a placeholder
    return Buffer.from('PDF content');
  }
}