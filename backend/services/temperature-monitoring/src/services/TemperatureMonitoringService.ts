import Bull from 'bull';
import { Server } from 'socket.io';
import { prisma, logger } from '@reskflow/shared';
import { DeviceManager } from './DeviceManager';
import { AlertService } from './AlertService';
import { TemperatureZoneService } from './TemperatureZoneService';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface TemperatureReading {
  id: string;
  deviceId: string;
  orderId?: string;
  temperature: number;
  humidity?: number;
  batteryLevel?: number;
  location?: {
    latitude: number;
    longitude: number;
  };
  timestamp: Date;
}

interface TemperatureThreshold {
  min: number;
  max: number;
  criticalMin: number;
  criticalMax: number;
}

interface TemperatureHistory {
  orderId: string;
  readings: TemperatureReading[];
  averageTemp: number;
  minTemp: number;
  maxTemp: number;
  outOfRangeCount: number;
  complianceRate: number;
}

interface TemperatureAnalytics {
  totalReadings: number;
  averageTemperature: number;
  complianceRate: number;
  violationsByHour: Array<{ hour: number; count: number }>;
  criticalEvents: number;
  devicePerformance: Array<{
    deviceId: string;
    reliability: number;
    averageTemp: number;
  }>;
}

export class TemperatureMonitoringService {
  private thresholds: Map<string, TemperatureThreshold> = new Map([
    ['frozen', { min: -25, max: -15, criticalMin: -30, criticalMax: -10 }],
    ['refrigerated', { min: 0, max: 5, criticalMin: -2, criticalMax: 8 }],
    ['cold', { min: 2, max: 8, criticalMin: 0, criticalMax: 10 }],
    ['cool', { min: 8, max: 15, criticalMin: 5, criticalMax: 20 }],
    ['ambient', { min: 15, max: 25, criticalMin: 10, criticalMax: 30 }],
    ['hot', { min: 60, max: 80, criticalMin: 55, criticalMax: 85 }],
  ]);

  constructor(
    private deviceManager: DeviceManager,
    private alertService: AlertService,
    private temperatureZoneService: TemperatureZoneService,
    private temperatureQueue: Bull.Queue,
    private io: Server
  ) {}

  async recordReading(params: {
    deviceId: string;
    temperature: number;
    humidity?: number;
    batteryLevel?: number;
    location?: { latitude: number; longitude: number };
    timestamp: Date;
  }): Promise<TemperatureReading> {
    // Validate device
    const device = await this.deviceManager.getDevice(params.deviceId);
    if (!device || !device.is_active) {
      throw new Error('Invalid or inactive device');
    }

    // Get associated order
    const activeDelivery = await prisma.reskflow.findFirst({
      where: {
        vehicle_id: device.vehicle_id,
        status: { in: ['assigned', 'picked_up', 'in_transit'] },
      },
      include: {
        order: {
          include: {
            orderItems: {
              include: { item: true },
            },
          },
        },
      },
    });

    // Create reading
    const reading = await prisma.temperatureReading.create({
      data: {
        id: uuidv4(),
        device_id: params.deviceId,
        order_id: activeDelivery?.order_id,
        reskflow_id: activeDelivery?.id,
        temperature: params.temperature,
        humidity: params.humidity,
        battery_level: params.batteryLevel,
        latitude: params.location?.latitude,
        longitude: params.location?.longitude,
        recorded_at: params.timestamp,
      },
    });

    // Update device status
    await this.deviceManager.updateDeviceStatus(params.deviceId, {
      lastReading: params.timestamp,
      batteryLevel: params.batteryLevel,
      location: params.location,
    });

    // Queue for analysis
    await this.temperatureQueue.add('analyze-reading', {
      readingId: reading.id,
      orderId: activeDelivery?.order_id,
    });

    // Broadcast real-time update
    if (activeDelivery) {
      this.broadcastTemperatureUpdate(activeDelivery.order_id, {
        temperature: params.temperature,
        humidity: params.humidity,
        timestamp: params.timestamp,
      });
    }

    return this.mapToTemperatureReading(reading);
  }

  async analyzeReading(data: { readingId: string; orderId?: string }): Promise<void> {
    const reading = await prisma.temperatureReading.findUnique({
      where: { id: data.readingId },
      include: {
        order: {
          include: {
            orderItems: {
              include: { item: true },
            },
          },
        },
      },
    });

    if (!reading || !reading.order) {
      return;
    }

    // Determine temperature requirements
    const requirements = await this.temperatureZoneService.getOrderRequirements(
      reading.order_id!
    );

    const threshold = this.thresholds.get(requirements.zone) || this.thresholds.get('ambient')!;

    // Check if temperature is out of range
    const isOutOfRange = reading.temperature < threshold.min || reading.temperature > threshold.max;
    const isCritical = reading.temperature < threshold.criticalMin || reading.temperature > threshold.criticalMax;

    if (isOutOfRange) {
      // Create violation record
      await prisma.temperatureViolation.create({
        data: {
          reading_id: reading.id,
          order_id: reading.order_id,
          temperature: reading.temperature,
          expected_min: threshold.min,
          expected_max: threshold.max,
          severity: isCritical ? 'critical' : 'warning',
          duration: 0, // Will be updated if violation continues
        },
      });

      // Create alert
      await this.alertService.createAlert({
        type: 'temperature_violation',
        severity: isCritical ? 'critical' : 'warning',
        orderId: reading.order_id!,
        deviceId: reading.device_id,
        message: `Temperature ${reading.temperature}°C is ${isOutOfRange ? 'out of range' : 'critical'} for ${requirements.zone} items`,
        data: {
          temperature: reading.temperature,
          threshold,
          zone: requirements.zone,
        },
      });
    }

    // Check for trends
    await this.checkTemperatureTrends(reading.order_id!);
  }

  async getTemperatureHistory(params: {
    orderId: string;
    startTime?: string;
    endTime?: string;
  }): Promise<TemperatureHistory> {
    const where: any = { order_id: params.orderId };
    
    if (params.startTime || params.endTime) {
      where.recorded_at = {};
      if (params.startTime) {
        where.recorded_at.gte = new Date(params.startTime);
      }
      if (params.endTime) {
        where.recorded_at.lte = new Date(params.endTime);
      }
    }

    const readings = await prisma.temperatureReading.findMany({
      where,
      orderBy: { recorded_at: 'asc' },
    });

    if (readings.length === 0) {
      return {
        orderId: params.orderId,
        readings: [],
        averageTemp: 0,
        minTemp: 0,
        maxTemp: 0,
        outOfRangeCount: 0,
        complianceRate: 100,
      };
    }

    // Get temperature requirements
    const requirements = await this.temperatureZoneService.getOrderRequirements(params.orderId);
    const threshold = this.thresholds.get(requirements.zone) || this.thresholds.get('ambient')!;

    // Calculate statistics
    const temperatures = readings.map(r => r.temperature);
    const averageTemp = temperatures.reduce((a, b) => a + b, 0) / temperatures.length;
    const minTemp = Math.min(...temperatures);
    const maxTemp = Math.max(...temperatures);

    const outOfRangeCount = readings.filter(r => 
      r.temperature < threshold.min || r.temperature > threshold.max
    ).length;

    const complianceRate = ((readings.length - outOfRangeCount) / readings.length) * 100;

    return {
      orderId: params.orderId,
      readings: readings.map(r => this.mapToTemperatureReading(r)),
      averageTemp: Math.round(averageTemp * 10) / 10,
      minTemp,
      maxTemp,
      outOfRangeCount,
      complianceRate: Math.round(complianceRate * 10) / 10,
    };
  }

  async getCurrentTemperature(orderId: string): Promise<{
    temperature?: number;
    humidity?: number;
    lastUpdate?: Date;
    isInRange: boolean;
    zone: string;
  }> {
    const latestReading = await prisma.temperatureReading.findFirst({
      where: { order_id: orderId },
      orderBy: { recorded_at: 'desc' },
    });

    if (!latestReading) {
      return {
        isInRange: true,
        zone: 'ambient',
      };
    }

    const requirements = await this.temperatureZoneService.getOrderRequirements(orderId);
    const threshold = this.thresholds.get(requirements.zone) || this.thresholds.get('ambient')!;

    const isInRange = latestReading.temperature >= threshold.min && 
                     latestReading.temperature <= threshold.max;

    return {
      temperature: latestReading.temperature,
      humidity: latestReading.humidity || undefined,
      lastUpdate: latestReading.recorded_at,
      isInRange,
      zone: requirements.zone,
    };
  }

  async getTemperatureAnalytics(
    merchantId: string,
    period: string = '7d'
  ): Promise<TemperatureAnalytics> {
    const days = parseInt(period) || 7;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all readings for merchant orders
    const readings = await prisma.$queryRaw`
      SELECT 
        tr.*,
        o.merchant_id
      FROM temperature_readings tr
      JOIN orders o ON tr.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND tr.recorded_at >= ${startDate}
    ` as any[];

    const totalReadings = readings.length;
    const averageTemperature = totalReadings > 0
      ? readings.reduce((sum, r) => sum + r.temperature, 0) / totalReadings
      : 0;

    // Calculate compliance
    const violations = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM temperature_violations tv
      JOIN orders o ON tv.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND tv.created_at >= ${startDate}
    ` as any[];

    const violationCount = violations[0]?.count || 0;
    const complianceRate = totalReadings > 0
      ? ((totalReadings - violationCount) / totalReadings) * 100
      : 100;

    // Violations by hour
    const violationsByHour = await prisma.$queryRaw`
      SELECT 
        EXTRACT(HOUR FROM tv.created_at) as hour,
        COUNT(*) as count
      FROM temperature_violations tv
      JOIN orders o ON tv.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND tv.created_at >= ${startDate}
      GROUP BY hour
      ORDER BY hour
    ` as any[];

    // Critical events
    const criticalEvents = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM temperature_violations tv
      JOIN orders o ON tv.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND tv.severity = 'critical'
        AND tv.created_at >= ${startDate}
    ` as any[];

    // Device performance
    const devicePerformance = await prisma.$queryRaw`
      SELECT 
        tr.device_id,
        COUNT(*) as reading_count,
        AVG(tr.temperature) as avg_temp,
        COUNT(tv.id) as violation_count
      FROM temperature_readings tr
      LEFT JOIN temperature_violations tv ON tr.id = tv.reading_id
      JOIN orders o ON tr.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND tr.recorded_at >= ${startDate}
      GROUP BY tr.device_id
    ` as any[];

    const deviceStats = devicePerformance.map(d => ({
      deviceId: d.device_id,
      reliability: d.reading_count > 0 
        ? ((d.reading_count - d.violation_count) / d.reading_count) * 100 
        : 0,
      averageTemp: Math.round(d.avg_temp * 10) / 10,
    }));

    return {
      totalReadings,
      averageTemperature: Math.round(averageTemperature * 10) / 10,
      complianceRate: Math.round(complianceRate * 10) / 10,
      violationsByHour: violationsByHour.map(v => ({
        hour: parseInt(v.hour),
        count: parseInt(v.count),
      })),
      criticalEvents: criticalEvents[0]?.count || 0,
      devicePerformance: deviceStats,
    };
  }

  async cleanupOldData(retentionDays: number = 90): Promise<void> {
    const cutoffDate = dayjs().subtract(retentionDays, 'day').toDate();
    
    // Delete old readings
    const deleted = await prisma.temperatureReading.deleteMany({
      where: {
        recorded_at: { lt: cutoffDate },
      },
    });

    logger.info(`Cleaned up ${deleted.count} old temperature readings`);

    // Archive violations before deletion
    const violations = await prisma.temperatureViolation.findMany({
      where: {
        created_at: { lt: cutoffDate },
      },
    });

    if (violations.length > 0) {
      // Archive to long-term storage
      await this.archiveViolations(violations);
      
      // Delete archived violations
      await prisma.temperatureViolation.deleteMany({
        where: {
          id: { in: violations.map(v => v.id) },
        },
      });
    }
  }

  private async checkTemperatureTrends(orderId: string): Promise<void> {
    // Get recent readings (last 30 minutes)
    const recentReadings = await prisma.temperatureReading.findMany({
      where: {
        order_id: orderId,
        recorded_at: { gte: dayjs().subtract(30, 'minute').toDate() },
      },
      orderBy: { recorded_at: 'asc' },
    });

    if (recentReadings.length < 5) {
      return; // Not enough data for trend analysis
    }

    // Calculate trend
    const temperatures = recentReadings.map(r => r.temperature);
    const avgTemp = temperatures.reduce((a, b) => a + b, 0) / temperatures.length;
    
    // Simple linear regression to detect trend
    const n = temperatures.length;
    const indices = Array.from({ length: n }, (_, i) => i);
    
    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = temperatures.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * temperatures[i], 0);
    const sumX2 = indices.reduce((sum, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const rateOfChange = slope * 60; // Rate per hour

    // Alert if significant trend detected
    if (Math.abs(rateOfChange) > 2) {
      await this.alertService.createAlert({
        type: 'temperature_trend',
        severity: 'warning',
        orderId,
        message: `Temperature is ${rateOfChange > 0 ? 'rising' : 'falling'} at ${Math.abs(rateOfChange).toFixed(1)}°C per hour`,
        data: {
          trend: rateOfChange > 0 ? 'rising' : 'falling',
          ratePerHour: rateOfChange,
          currentTemp: temperatures[temperatures.length - 1],
        },
      });
    }
  }

  private broadcastTemperatureUpdate(orderId: string, data: any): void {
    this.io.to(`order:${orderId}`).emit('temperature:update', {
      orderId,
      ...data,
      timestamp: new Date(),
    });
  }

  private async archiveViolations(violations: any[]): Promise<void> {
    // In production, this would upload to S3 or similar
    logger.info(`Archiving ${violations.length} temperature violations`);
  }

  private mapToTemperatureReading(reading: any): TemperatureReading {
    return {
      id: reading.id,
      deviceId: reading.device_id,
      orderId: reading.order_id,
      temperature: reading.temperature,
      humidity: reading.humidity,
      batteryLevel: reading.battery_level,
      location: reading.latitude && reading.longitude ? {
        latitude: reading.latitude,
        longitude: reading.longitude,
      } : undefined,
      timestamp: reading.recorded_at,
    };
  }
}