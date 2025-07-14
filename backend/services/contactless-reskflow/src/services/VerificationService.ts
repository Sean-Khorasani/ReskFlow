import { prisma, logger, redis } from '@reskflow/shared';
import QRCode from 'qrcode';
import crypto from 'crypto';
import dayjs from 'dayjs';

interface VerificationCode {
  code: string;
  type: 'reskflow' | 'pickup' | 'signature';
  orderId: string;
  expiresAt: Date;
  used: boolean;
  metadata?: any;
}

interface QRCodeData {
  orderId: string;
  code: string;
  type: string;
  timestamp: number;
  signature: string;
}

export class VerificationService {
  private readonly CODE_EXPIRY_MINUTES = 30;
  private readonly SECRET_KEY = process.env.VERIFICATION_SECRET || 'default-secret';

  async generateVerificationCode(params: {
    orderId: string;
    type: 'reskflow' | 'pickup' | 'signature';
    metadata?: any;
  }): Promise<VerificationCode> {
    const code = this.generateSecureCode();
    const expiresAt = dayjs().add(this.CODE_EXPIRY_MINUTES, 'minute').toDate();

    // Store in database
    await prisma.verificationCode.create({
      data: {
        code,
        type: params.type,
        order_id: params.orderId,
        expires_at: expiresAt,
        metadata: params.metadata || {},
      },
    });

    // Cache for quick lookup
    await redis.setex(
      `verification:${code}`,
      this.CODE_EXPIRY_MINUTES * 60,
      JSON.stringify({
        orderId: params.orderId,
        type: params.type,
        metadata: params.metadata,
      })
    );

    return {
      code,
      type: params.type,
      orderId: params.orderId,
      expiresAt,
      used: false,
      metadata: params.metadata,
    };
  }

  async verifyCode(code: string): Promise<{
    valid: boolean;
    orderId?: string;
    type?: string;
    metadata?: any;
    error?: string;
  }> {
    // Check cache first
    const cached = await redis.get(`verification:${code}`);
    if (cached) {
      const data = JSON.parse(cached);
      
      // Mark as used
      await prisma.verificationCode.update({
        where: { code },
        data: { 
          used: true,
          used_at: new Date(),
        },
      });

      // Remove from cache
      await redis.del(`verification:${code}`);

      return {
        valid: true,
        orderId: data.orderId,
        type: data.type,
        metadata: data.metadata,
      };
    }

    // Check database
    const verificationCode = await prisma.verificationCode.findFirst({
      where: {
        code,
        used: false,
        expires_at: { gt: new Date() },
      },
    });

    if (!verificationCode) {
      return {
        valid: false,
        error: 'Invalid or expired code',
      };
    }

    // Mark as used
    await prisma.verificationCode.update({
      where: { id: verificationCode.id },
      data: { 
        used: true,
        used_at: new Date(),
      },
    });

    return {
      valid: true,
      orderId: verificationCode.order_id,
      type: verificationCode.type,
      metadata: verificationCode.metadata,
    };
  }

  async generateQRCode(params: {
    orderId: string;
    code: string;
    type?: string;
  }): Promise<string> {
    const data: QRCodeData = {
      orderId: params.orderId,
      code: params.code,
      type: params.type || 'reskflow',
      timestamp: Date.now(),
      signature: '',
    };

    // Sign the data
    data.signature = this.signData(data);

    // Generate QR code
    const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(data), {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      width: 256,
    });

    return qrCodeUrl;
  }

  async verifyQRCode(qrData: string): Promise<{
    valid: boolean;
    orderId?: string;
    code?: string;
    error?: string;
  }> {
    try {
      const data: QRCodeData = JSON.parse(qrData);

      // Verify signature
      const signature = data.signature;
      data.signature = '';
      const expectedSignature = this.signData(data);

      if (signature !== expectedSignature) {
        return {
          valid: false,
          error: 'Invalid QR code signature',
        };
      }

      // Check timestamp (valid for 1 hour)
      const ageMinutes = (Date.now() - data.timestamp) / 1000 / 60;
      if (ageMinutes > 60) {
        return {
          valid: false,
          error: 'QR code expired',
        };
      }

      // Verify the code
      const verificationResult = await this.verifyCode(data.code);

      if (!verificationResult.valid) {
        return {
          valid: false,
          error: verificationResult.error,
        };
      }

      return {
        valid: true,
        orderId: data.orderId,
        code: data.code,
      };
    } catch (error) {
      logger.error('Error verifying QR code:', error);
      return {
        valid: false,
        error: 'Invalid QR code format',
      };
    }
  }

  async generateSignatureToken(orderId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = dayjs().add(15, 'minute').toDate();

    // Store token
    await redis.setex(
      `signature-token:${token}`,
      15 * 60,
      JSON.stringify({
        orderId,
        expiresAt,
      })
    );

    return token;
  }

  async verifySignatureToken(token: string): Promise<{
    valid: boolean;
    orderId?: string;
  }> {
    const data = await redis.get(`signature-token:${token}`);
    
    if (!data) {
      return { valid: false };
    }

    const parsed = JSON.parse(data);
    await redis.del(`signature-token:${token}`);

    return {
      valid: true,
      orderId: parsed.orderId,
    };
  }

  async sendVerificationCode(params: {
    orderId: string;
    method: 'sms' | 'email';
    recipient: string;
    code: string;
  }): Promise<void> {
    // This would integrate with SMS/Email service
    logger.info(`Sending verification code ${params.code} to ${params.recipient} via ${params.method}`);
    
    // Store send attempt
    await prisma.verificationAttempt.create({
      data: {
        order_id: params.orderId,
        method: params.method,
        recipient: params.recipient,
        code: params.code,
        sent_at: new Date(),
      },
    });
  }

  async cleanupExpiredCodes(): Promise<void> {
    const result = await prisma.verificationCode.deleteMany({
      where: {
        OR: [
          { expires_at: { lt: new Date() } },
          { 
            used: true,
            used_at: { lt: dayjs().subtract(1, 'day').toDate() },
          },
        ],
      },
    });

    logger.info(`Cleaned up ${result.count} expired verification codes`);
  }

  private generateSecureCode(): string {
    // Generate 6-character alphanumeric code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    
    for (let i = 0; i < 6; i++) {
      const randomIndex = crypto.randomInt(0, chars.length);
      code += chars[randomIndex];
    }
    
    return code;
  }

  private signData(data: any): string {
    const hmac = crypto.createHmac('sha256', this.SECRET_KEY);
    hmac.update(JSON.stringify(data));
    return hmac.digest('hex');
  }
}