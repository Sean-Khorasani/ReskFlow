import { NotificationTemplate, NotificationChannel, NotificationType } from '../types/notification.types';

export class TemplateService {
  private templates: Map<string, NotificationTemplate> = new Map();
  
  constructor() {
    this.loadTemplates();
  }
  
  private loadTemplates() {
    // Email templates
    this.addTemplate({
      id: 'email-order-placed',
      type: NotificationType.ORDER_PLACED,
      channel: NotificationChannel.EMAIL,
      subject: 'Order Confirmation - #{{orderId}}',
      template: `
        <h2>Thank you for your order!</h2>
        <p>Hi {{customerName}},</p>
        <p>Your order #{{orderId}} has been placed successfully.</p>
        <h3>Order Details:</h3>
        <p>Restaurant: {{restaurantName}}</p>
        <p>Total: ${{total}}</p>
        <p>Estimated reskflow time: {{estimatedTime}}</p>
        <p>Track your order in the app!</p>
      `,
      variables: ['orderId', 'customerName', 'restaurantName', 'total', 'estimatedTime']
    });
    
    this.addTemplate({
      id: 'email-order-delivered',
      type: NotificationType.ORDER_DELIVERED,
      channel: NotificationChannel.EMAIL,
      subject: 'Your order has been delivered!',
      template: `
        <h2>Order Delivered!</h2>
        <p>Hi {{customerName}},</p>
        <p>Your order #{{orderId}} has been delivered.</p>
        <p>We hope you enjoy your meal!</p>
        <p>Please rate your experience in the app.</p>
      `,
      variables: ['orderId', 'customerName']
    });
    
    // SMS templates
    this.addTemplate({
      id: 'sms-order-placed',
      type: NotificationType.ORDER_PLACED,
      channel: NotificationChannel.SMS,
      template: 'ReskFlow: Order #{{orderId}} confirmed! ETA: {{estimatedTime}}. Track: {{trackingUrl}}',
      variables: ['orderId', 'estimatedTime', 'trackingUrl']
    });
    
    this.addTemplate({
      id: 'sms-reskflow-nearby',
      type: NotificationType.DELIVERY_NEARBY,
      channel: NotificationChannel.SMS,
      template: 'ReskFlow: Your driver is nearby! Order #{{orderId}} will arrive in {{minutes}} minutes.',
      variables: ['orderId', 'minutes']
    });
    
    this.addTemplate({
      id: 'sms-two-factor',
      type: NotificationType.TWO_FACTOR_CODE,
      channel: NotificationChannel.SMS,
      template: 'ReskFlow: Your verification code is {{code}}. Valid for 5 minutes.',
      variables: ['code']
    });
    
    // Push templates
    this.addTemplate({
      id: 'push-order-accepted',
      type: NotificationType.ORDER_ACCEPTED,
      channel: NotificationChannel.PUSH,
      subject: 'Order Accepted!',
      template: 'Your order #{{orderId}} has been accepted by {{restaurantName}}',
      variables: ['orderId', 'restaurantName']
    });
    
    this.addTemplate({
      id: 'push-reskflow-started',
      type: NotificationType.DELIVERY_STARTED,
      channel: NotificationChannel.PUSH,
      subject: 'Driver on the way!',
      template: '{{driverName}} is on the way with your order #{{orderId}}',
      variables: ['driverName', 'orderId']
    });
  }
  
  private addTemplate(template: NotificationTemplate) {
    const key = `${template.type}-${template.channel}`;
    this.templates.set(key, template);
  }
  
  async getTemplate(
    type: NotificationType,
    channel: NotificationChannel
  ): Promise<NotificationTemplate | null> {
    const key = `${type}-${channel}`;
    return this.templates.get(key) || null;
  }
  
  render(
    template: NotificationTemplate,
    data: Record<string, any>
  ): { subject?: string; content: string } {
    let content = template.template;
    let subject = template.subject;
    
    // Replace variables
    for (const variable of template.variables) {
      const value = data[variable] || '';
      const regex = new RegExp(`{{${variable}}}`, 'g');
      
      content = content.replace(regex, value);
      if (subject) {
        subject = subject.replace(regex, value);
      }
    }
    
    return { subject, content };
  }
}