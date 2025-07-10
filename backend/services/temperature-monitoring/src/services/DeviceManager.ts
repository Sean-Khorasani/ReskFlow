import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface Device {
  id: string;
  serialNumber: string;
  deviceType: string;
  vehicleId?: string;
  ownerId: string;
  isActive: boolean;
  lastCalibration?: Date;
  batteryLevel?: number;
  firmwareVersion: string;
  status: string;
}

interface DeviceStatus {
  deviceId: string;
  isOnline: boolean;
  batteryLevel?: number;
  signalStrength?: number;
  lastReading?: Date;
  location?: {
    latitude: number;
    longitude: number;
  };
  errors: string[];
}

interface CalibrationData {
  referenceTemp: number;
  measuredTemp: number;
  offset: number;
  timestamp: Date;
}

interface DeviceHealth {
  deviceId: string;
  healthScore: number;
  issues: string[];
  recommendations: string[];
  nextMaintenanceDate?: Date;
}

export class DeviceManager {
  private deviceCache: Map<string, Device> = new Map();
  private connectionPool: Map<string, any> = new Map();

  constructor() {
    this.initializeDeviceCache();
  }

  private async initializeDeviceCache(): Promise<void> {
    const devices = await prisma.temperatureDevice.findMany({
      where: { is_active: true },
    });

    devices.forEach(device => {
      this.deviceCache.set(device.id, this.mapToDevice(device));
    });

    logger.info(`Initialized device cache with ${devices.length} devices`);
  }

  async registerDevice(params: {
    deviceType: string;
    serialNumber: string;
    vehicleId?: string;
    ownerId: string;
  }): Promise<Device> {
    // Check if device already exists
    const existing = await prisma.temperatureDevice.findFirst({
      where: { serial_number: params.serialNumber },
    });

    if (existing) {
      throw new Error('Device already registered');
    }

    // Create device record
    const device = await prisma.temperatureDevice.create({
      data: {
        id: uuidv4(),
        device_type: params.deviceType,
        serial_number: params.serialNumber,
        vehicle_id: params.vehicleId,
        owner_id: params.ownerId,
        firmware_version: '1.0.0',
        status: 'active',
        is_active: true,
        registered_at: new Date(),
      },
    });

    const mappedDevice = this.mapToDevice(device);
    this.deviceCache.set(device.id, mappedDevice);

    // Initialize device connection
    await this.initializeDeviceConnection(device.id);

    return mappedDevice;
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    // Check cache first
    if (this.deviceCache.has(deviceId)) {
      return this.deviceCache.get(deviceId)!;
    }

    // Fetch from database
    const device = await prisma.temperatureDevice.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      return null;
    }

    const mappedDevice = this.mapToDevice(device);
    this.deviceCache.set(deviceId, mappedDevice);
    
    return mappedDevice;
  }

  async calibrateDevice(
    deviceId: string,
    calibrationData: CalibrationData
  ): Promise<{ success: boolean; message: string }> {
    const device = await this.getDevice(deviceId);
    if (!device) {
      throw new Error('Device not found');
    }

    // Calculate calibration offset
    const offset = calibrationData.referenceTemp - calibrationData.measuredTemp;

    // Update device calibration
    await prisma.temperatureDevice.update({
      where: { id: deviceId },
      data: {
        calibration_offset: offset,
        last_calibration: new Date(),
      },
    });

    // Create calibration record
    await prisma.deviceCalibration.create({
      data: {
        device_id: deviceId,
        reference_temp: calibrationData.referenceTemp,
        measured_temp: calibrationData.measuredTemp,
        offset,
        calibrated_by: device.ownerId,
        calibrated_at: calibrationData.timestamp,
      },
    });

    // Update cache
    device.lastCalibration = calibrationData.timestamp;
    this.deviceCache.set(deviceId, device);

    // Apply calibration to device
    await this.applyCalibrationToDevice(deviceId, offset);

    return {
      success: true,
      message: `Device calibrated with offset: ${offset.toFixed(2)}°C`,
    };
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    const device = await this.getDevice(deviceId);
    if (!device) {
      throw new Error('Device not found');
    }

    // Get latest reading
    const latestReading = await prisma.temperatureReading.findFirst({
      where: { device_id: deviceId },
      orderBy: { recorded_at: 'desc' },
    });

    // Check device connection
    const isOnline = this.isDeviceOnline(deviceId);

    // Get device errors
    const errors = await this.getDeviceErrors(deviceId);

    return {
      deviceId,
      isOnline,
      batteryLevel: latestReading?.battery_level || device.batteryLevel,
      signalStrength: await this.getSignalStrength(deviceId),
      lastReading: latestReading?.recorded_at,
      location: latestReading?.latitude && latestReading?.longitude ? {
        latitude: latestReading.latitude,
        longitude: latestReading.longitude,
      } : undefined,
      errors,
    };
  }

  async updateDeviceStatus(
    deviceId: string,
    status: {
      lastReading?: Date;
      batteryLevel?: number;
      location?: { latitude: number; longitude: number };
    }
  ): Promise<void> {
    const updates: any = {};

    if (status.batteryLevel !== undefined) {
      updates.battery_level = status.batteryLevel;
    }
    if (status.location) {
      updates.last_latitude = status.location.latitude;
      updates.last_longitude = status.location.longitude;
    }
    if (status.lastReading) {
      updates.last_reading_at = status.lastReading;
    }

    await prisma.temperatureDevice.update({
      where: { id: deviceId },
      data: updates,
    });

    // Update cache
    const device = this.deviceCache.get(deviceId);
    if (device) {
      if (status.batteryLevel !== undefined) {
        device.batteryLevel = status.batteryLevel;
      }
      this.deviceCache.set(deviceId, device);
    }
  }

  async getDevicesByVehicle(vehicleId: string): Promise<Device[]> {
    const devices = await prisma.temperatureDevice.findMany({
      where: {
        vehicle_id: vehicleId,
        is_active: true,
      },
    });

    return devices.map(d => this.mapToDevice(d));
  }

  async checkAllDeviceHealth(): Promise<void> {
    const devices = await prisma.temperatureDevice.findMany({
      where: { is_active: true },
    });

    for (const device of devices) {
      try {
        const health = await this.checkDeviceHealth(device.id);
        
        if (health.healthScore < 70) {
          // Create maintenance alert
          await this.createMaintenanceAlert(device.id, health);
        }

        // Update device health status
        await prisma.temperatureDevice.update({
          where: { id: device.id },
          data: {
            health_score: health.healthScore,
            health_checked_at: new Date(),
          },
        });
      } catch (error) {
        logger.error(`Error checking health for device ${device.id}:`, error);
      }
    }
  }

  async checkDeviceHealth(deviceId: string): Promise<DeviceHealth> {
    const device = await this.getDevice(deviceId);
    if (!device) {
      throw new Error('Device not found');
    }

    const issues: string[] = [];
    const recommendations: string[] = [];
    let healthScore = 100;

    // Check battery level
    if (device.batteryLevel !== undefined && device.batteryLevel < 20) {
      issues.push('Low battery level');
      recommendations.push('Replace or recharge battery soon');
      healthScore -= 20;
    }

    // Check calibration
    const daysSinceCalibration = device.lastCalibration
      ? dayjs().diff(device.lastCalibration, 'day')
      : 999;

    if (daysSinceCalibration > 30) {
      issues.push('Calibration overdue');
      recommendations.push('Calibrate device to ensure accuracy');
      healthScore -= 15;
    }

    // Check reading frequency
    const recentReadings = await prisma.temperatureReading.count({
      where: {
        device_id: deviceId,
        recorded_at: { gte: dayjs().subtract(1, 'hour').toDate() },
      },
    });

    if (recentReadings < 6) { // Less than one reading per 10 minutes
      issues.push('Infrequent readings');
      recommendations.push('Check device connectivity');
      healthScore -= 10;
    }

    // Check error rate
    const errorRate = await this.calculateErrorRate(deviceId);
    if (errorRate > 0.05) { // More than 5% error rate
      issues.push('High error rate');
      recommendations.push('Device may need servicing');
      healthScore -= 20;
    }

    // Calculate next maintenance date
    const nextMaintenanceDate = device.lastCalibration
      ? dayjs(device.lastCalibration).add(45, 'day').toDate()
      : dayjs().add(7, 'day').toDate();

    return {
      deviceId,
      healthScore: Math.max(0, healthScore),
      issues,
      recommendations,
      nextMaintenanceDate,
    };
  }

  async deactivateDevice(deviceId: string, reason: string): Promise<void> {
    await prisma.temperatureDevice.update({
      where: { id: deviceId },
      data: {
        is_active: false,
        status: 'inactive',
        deactivated_at: new Date(),
        deactivation_reason: reason,
      },
    });

    // Remove from cache
    this.deviceCache.delete(deviceId);
    
    // Close device connection
    this.closeDeviceConnection(deviceId);
  }

  async updateFirmware(
    deviceId: string,
    firmwareVersion: string
  ): Promise<{ success: boolean; message: string }> {
    const device = await this.getDevice(deviceId);
    if (!device) {
      throw new Error('Device not found');
    }

    // Simulate firmware update process
    logger.info(`Updating device ${deviceId} to firmware ${firmwareVersion}`);

    // Update database
    await prisma.temperatureDevice.update({
      where: { id: deviceId },
      data: {
        firmware_version: firmwareVersion,
        firmware_updated_at: new Date(),
      },
    });

    // Update cache
    device.firmwareVersion = firmwareVersion;
    this.deviceCache.set(deviceId, device);

    return {
      success: true,
      message: `Device firmware updated to version ${firmwareVersion}`,
    };
  }

  private async initializeDeviceConnection(deviceId: string): Promise<void> {
    // Initialize connection to physical device
    // This would connect to the actual IoT device
    const connection = {
      deviceId,
      connected: true,
      lastPing: new Date(),
    };

    this.connectionPool.set(deviceId, connection);
  }

  private closeDeviceConnection(deviceId: string): void {
    const connection = this.connectionPool.get(deviceId);
    if (connection) {
      // Close actual connection
      this.connectionPool.delete(deviceId);
    }
  }

  private isDeviceOnline(deviceId: string): boolean {
    const connection = this.connectionPool.get(deviceId);
    if (!connection) return false;

    // Check if last ping was within 5 minutes
    const lastPing = dayjs(connection.lastPing);
    return dayjs().diff(lastPing, 'minute') < 5;
  }

  private async getSignalStrength(deviceId: string): Promise<number | undefined> {
    const connection = this.connectionPool.get(deviceId);
    if (!connection) return undefined;

    // In real implementation, this would query the device
    return Math.random() * 100; // Mock signal strength
  }

  private async getDeviceErrors(deviceId: string): Promise<string[]> {
    const errors: string[] = [];

    // Check recent error logs
    const errorLogs = await prisma.deviceErrorLog.findMany({
      where: {
        device_id: deviceId,
        created_at: { gte: dayjs().subtract(1, 'hour').toDate() },
      },
      orderBy: { created_at: 'desc' },
      take: 10,
    });

    errorLogs.forEach(log => {
      if (!errors.includes(log.error_type)) {
        errors.push(log.error_type);
      }
    });

    return errors;
  }

  private async calculateErrorRate(deviceId: string): Promise<number> {
    const hourAgo = dayjs().subtract(1, 'hour').toDate();

    const [totalReadings, errorCount] = await Promise.all([
      prisma.temperatureReading.count({
        where: {
          device_id: deviceId,
          recorded_at: { gte: hourAgo },
        },
      }),
      prisma.deviceErrorLog.count({
        where: {
          device_id: deviceId,
          created_at: { gte: hourAgo },
        },
      }),
    ]);

    return totalReadings > 0 ? errorCount / totalReadings : 0;
  }

  private async applyCalibrationToDevice(deviceId: string, offset: number): Promise<void> {
    // Send calibration command to device
    const connection = this.connectionPool.get(deviceId);
    if (connection) {
      // In real implementation, this would send command to device
      logger.info(`Applied calibration offset ${offset} to device ${deviceId}`);
    }
  }

  private async createMaintenanceAlert(deviceId: string, health: DeviceHealth): Promise<void> {
    await prisma.maintenanceAlert.create({
      data: {
        device_id: deviceId,
        alert_type: 'health_check',
        severity: health.healthScore < 50 ? 'critical' : 'warning',
        message: `Device health score: ${health.healthScore}%`,
        issues: health.issues,
        recommendations: health.recommendations,
        created_at: new Date(),
      },
    });
  }

  private mapToDevice(dbDevice: any): Device {
    return {
      id: dbDevice.id,
      serialNumber: dbDevice.serial_number,
      deviceType: dbDevice.device_type,
      vehicleId: dbDevice.vehicle_id,
      ownerId: dbDevice.owner_id,
      isActive: dbDevice.is_active,
      lastCalibration: dbDevice.last_calibration,
      batteryLevel: dbDevice.battery_level,
      firmwareVersion: dbDevice.firmware_version,
      status: dbDevice.status,
    };
  }
}