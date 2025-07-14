import { prisma, logger } from '@reskflow/shared';
import dayjs from 'dayjs';

interface TemperaturePrediction {
  timestamp: Date;
  predictedTemp: number;
  confidence: number;
  riskLevel: 'low' | 'medium' | 'high';
  recommendations: string[];
}

interface EquipmentFailurePrediction {
  deviceId: string;
  failureProbability: number;
  estimatedTimeToFailure?: number; // hours
  maintenanceRecommended: boolean;
  indicators: string[];
}

interface DriverPerformance {
  driverId: string;
  complianceScore: number;
  averageTemperatureControl: number;
  violationRate: number;
  strengths: string[];
  improvementAreas: string[];
  trainingRecommended: boolean;
}

interface RouteOptimization {
  routeId: string;
  estimatedTemperatureRisk: number;
  recommendedDepartureTime: Date;
  recommendedRoute: any[];
  estimatedComplianceRate: number;
}

export class PredictiveAnalyticsService {
  private readonly TEMP_HISTORY_DAYS = 30;
  private readonly PREDICTION_HORIZON_HOURS = 4;

  constructor() {}

  async predictTemperatureIssues(vehicleId: string): Promise<TemperaturePrediction[]> {
    // Get historical temperature data
    const historicalData = await this.getHistoricalTemperatureData(vehicleId);
    
    if (historicalData.length < 10) {
      return []; // Not enough data for prediction
    }

    // Analyze patterns
    const patterns = this.analyzeTemperaturePatterns(historicalData);
    
    // Generate predictions
    const predictions: TemperaturePrediction[] = [];
    const now = dayjs();

    for (let hour = 1; hour <= this.PREDICTION_HORIZON_HOURS; hour++) {
      const futureTime = now.add(hour, 'hour');
      const prediction = this.generateTemperaturePrediction(
        futureTime.toDate(),
        patterns,
        historicalData
      );
      predictions.push(prediction);
    }

    return predictions;
  }

  async predictEquipmentFailure(data: {
    deviceId: string;
    recentReadings: any[];
  }): Promise<EquipmentFailurePrediction> {
    const device = await prisma.temperatureDevice.findUnique({
      where: { id: data.deviceId },
      include: {
        calibrations: {
          orderBy: { calibrated_at: 'desc' },
          take: 5,
        },
        errorLogs: {
          where: {
            created_at: { gte: dayjs().subtract(7, 'day').toDate() },
          },
        },
      },
    });

    if (!device) {
      throw new Error('Device not found');
    }

    const indicators: string[] = [];
    let failureScore = 0;

    // Check battery degradation
    const batteryTrend = this.analyzeBatteryTrend(data.recentReadings);
    if (batteryTrend.degradationRate > 0.5) {
      indicators.push('Rapid battery degradation detected');
      failureScore += 20;
    }

    // Check calibration drift
    const calibrationDrift = this.analyzeCalibrationDrift(device.calibrations);
    if (calibrationDrift > 0.5) {
      indicators.push('Significant calibration drift');
      failureScore += 25;
    }

    // Check error frequency
    const errorRate = device.errorLogs.length / 7; // Errors per day
    if (errorRate > 5) {
      indicators.push('High error frequency');
      failureScore += 30;
    }

    // Check reading consistency
    const inconsistency = this.analyzeReadingConsistency(data.recentReadings);
    if (inconsistency > 0.3) {
      indicators.push('Inconsistent temperature readings');
      failureScore += 25;
    }

    // Calculate failure probability
    const failureProbability = Math.min(failureScore, 100) / 100;
    
    // Estimate time to failure
    let estimatedTimeToFailure: number | undefined;
    if (failureProbability > 0.5) {
      estimatedTimeToFailure = Math.max(24, (1 - failureProbability) * 168); // 24-168 hours
    }

    return {
      deviceId: data.deviceId,
      failureProbability,
      estimatedTimeToFailure,
      maintenanceRecommended: failureProbability > 0.3,
      indicators,
    };
  }

  async analyzeDriverPerformance(
    driverId: string,
    period: string = '30d'
  ): Promise<DriverPerformance> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get driver's deliveries
    const deliveries = await prisma.reskflow.findMany({
      where: {
        driver_id: driverId,
        delivered_at: { gte: startDate },
      },
      include: {
        order: {
          include: {
            temperatureReadings: true,
            temperatureViolations: true,
          },
        },
      },
    });

    if (deliveries.length === 0) {
      return {
        driverId,
        complianceScore: 100,
        averageTemperatureControl: 0,
        violationRate: 0,
        strengths: ['No deliveries in period'],
        improvementAreas: [],
        trainingRecommended: false,
      };
    }

    // Calculate metrics
    let totalReadings = 0;
    let totalViolations = 0;
    let temperatureDeviations: number[] = [];
    const violationTypes = new Map<string, number>();

    for (const reskflow of deliveries) {
      const readings = reskflow.order.temperatureReadings;
      const violations = reskflow.order.temperatureViolations;
      
      totalReadings += readings.length;
      totalViolations += violations.length;

      // Analyze temperature control
      for (const reading of readings) {
        // Calculate deviation from optimal
        const optimalTemp = this.getOptimalTemperature(reskflow.order);
        const deviation = Math.abs(reading.temperature - optimalTemp);
        temperatureDeviations.push(deviation);
      }

      // Categorize violations
      for (const violation of violations) {
        const type = violation.severity;
        violationTypes.set(type, (violationTypes.get(type) || 0) + 1);
      }
    }

    // Calculate scores
    const violationRate = totalReadings > 0 ? (totalViolations / totalReadings) * 100 : 0;
    const avgTempControl = temperatureDeviations.length > 0
      ? temperatureDeviations.reduce((a, b) => a + b, 0) / temperatureDeviations.length
      : 0;
    const complianceScore = Math.max(0, 100 - violationRate * 2 - avgTempControl * 5);

    // Identify strengths and improvement areas
    const strengths: string[] = [];
    const improvementAreas: string[] = [];

    if (violationRate < 2) {
      strengths.push('Excellent violation prevention');
    }
    if (avgTempControl < 1) {
      strengths.push('Superior temperature control');
    }
    if (violationTypes.get('critical') === undefined) {
      strengths.push('No critical violations');
    }

    if (violationRate > 5) {
      improvementAreas.push('Reduce temperature violations');
    }
    if (avgTempControl > 2) {
      improvementAreas.push('Improve temperature stability');
    }
    if (violationTypes.has('critical')) {
      improvementAreas.push('Prevent critical temperature events');
    }

    return {
      driverId,
      complianceScore: Math.round(complianceScore),
      averageTemperatureControl: Math.round(avgTempControl * 10) / 10,
      violationRate: Math.round(violationRate * 10) / 10,
      strengths,
      improvementAreas,
      trainingRecommended: complianceScore < 80 || violationTypes.has('critical'),
    };
  }

  async optimizeDeliveryRoute(params: {
    orderId: string;
    vehicleId: string;
    destinationCount: number;
  }): Promise<RouteOptimization> {
    // Get order requirements
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        orderItems: { include: { item: true } },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Analyze weather impact
    const weatherImpact = await this.analyzeWeatherImpact(order.reskflow_address);
    
    // Get vehicle performance data
    const vehiclePerformance = await this.getVehiclePerformanceMetrics(params.vehicleId);
    
    // Calculate optimal departure time
    const optimalDeparture = this.calculateOptimalDepartureTime(
      weatherImpact,
      params.destinationCount,
      vehiclePerformance
    );

    // Estimate temperature risk
    const temperatureRisk = this.estimateRouteTemperatureRisk(
      weatherImpact,
      params.destinationCount,
      vehiclePerformance
    );

    // Generate route recommendations
    const recommendedRoute = this.generateOptimalRoute(
      order,
      weatherImpact,
      params.destinationCount
    );

    return {
      routeId: `route-${params.orderId}`,
      estimatedTemperatureRisk: temperatureRisk,
      recommendedDepartureTime: optimalDeparture,
      recommendedRoute,
      estimatedComplianceRate: Math.max(0, 100 - temperatureRisk),
    };
  }

  async generateMaintenancePredictions(merchantId: string): Promise<{
    devices: EquipmentFailurePrediction[];
    maintenanceSchedule: Array<{
      deviceId: string;
      recommendedDate: Date;
      maintenanceType: string;
      priority: string;
    }>;
  }> {
    // Get all active devices for merchant
    const devices = await prisma.temperatureDevice.findMany({
      where: {
        owner_id: merchantId,
        is_active: true,
      },
    });

    const predictions: EquipmentFailurePrediction[] = [];
    const maintenanceSchedule: any[] = [];

    for (const device of devices) {
      // Get recent readings
      const recentReadings = await prisma.temperatureReading.findMany({
        where: {
          device_id: device.id,
          recorded_at: { gte: dayjs().subtract(7, 'day').toDate() },
        },
        orderBy: { recorded_at: 'desc' },
      });

      const prediction = await this.predictEquipmentFailure({
        deviceId: device.id,
        recentReadings,
      });

      predictions.push(prediction);

      // Generate maintenance schedule
      if (prediction.maintenanceRecommended) {
        const priority = prediction.failureProbability > 0.7 ? 'high' :
                       prediction.failureProbability > 0.4 ? 'medium' : 'low';
        
        const recommendedDate = prediction.estimatedTimeToFailure
          ? dayjs().add(prediction.estimatedTimeToFailure / 2, 'hour').toDate()
          : dayjs().add(7, 'day').toDate();

        maintenanceSchedule.push({
          deviceId: device.id,
          recommendedDate,
          maintenanceType: this.determineMaintenanceType(prediction),
          priority,
        });
      }
    }

    // Sort schedule by priority and date
    maintenanceSchedule.sort((a, b) => {
      if (a.priority !== b.priority) {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority as keyof typeof priorityOrder] - 
               priorityOrder[b.priority as keyof typeof priorityOrder];
      }
      return a.recommendedDate.getTime() - b.recommendedDate.getTime();
    });

    return { devices: predictions, maintenanceSchedule };
  }

  private async getHistoricalTemperatureData(vehicleId: string): Promise<any[]> {
    return await prisma.temperatureReading.findMany({
      where: {
        device: { vehicle_id: vehicleId },
        recorded_at: { gte: dayjs().subtract(this.TEMP_HISTORY_DAYS, 'day').toDate() },
      },
      orderBy: { recorded_at: 'asc' },
    });
  }

  private analyzeTemperaturePatterns(data: any[]): {
    averageTemp: number;
    stdDeviation: number;
    trendSlope: number;
    seasonalPattern: Map<number, number>;
  } {
    const temperatures = data.map(d => d.temperature);
    const n = temperatures.length;

    // Calculate average
    const averageTemp = temperatures.reduce((a, b) => a + b, 0) / n;

    // Calculate standard deviation
    const variance = temperatures.reduce((sum, temp) => sum + Math.pow(temp - averageTemp, 2), 0) / n;
    const stdDeviation = Math.sqrt(variance);

    // Calculate trend (simple linear regression)
    const indices = Array.from({ length: n }, (_, i) => i);
    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = temperatures.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * temperatures[i], 0);
    const sumX2 = indices.reduce((sum, x) => sum + x * x, 0);
    const trendSlope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

    // Analyze hourly patterns
    const seasonalPattern = new Map<number, number>();
    data.forEach(d => {
      const hour = dayjs(d.recorded_at).hour();
      const temps = seasonalPattern.get(hour) || [];
      temps.push(d.temperature);
      seasonalPattern.set(hour, temps);
    });

    // Average by hour
    seasonalPattern.forEach((temps, hour) => {
      const avg = temps.reduce((a: number, b: number) => a + b, 0) / temps.length;
      seasonalPattern.set(hour, avg);
    });

    return { averageTemp, stdDeviation, trendSlope, seasonalPattern };
  }

  private generateTemperaturePrediction(
    timestamp: Date,
    patterns: any,
    historicalData: any[]
  ): TemperaturePrediction {
    const hour = dayjs(timestamp).hour();
    const baseTemp = patterns.seasonalPattern.get(hour) || patterns.averageTemp;
    
    // Add trend component
    const hoursFromNow = dayjs(timestamp).diff(dayjs(), 'hour');
    const trendComponent = patterns.trendSlope * hoursFromNow;
    
    // Add random variation
    const randomVariation = (Math.random() - 0.5) * patterns.stdDeviation * 0.5;
    
    const predictedTemp = baseTemp + trendComponent + randomVariation;
    
    // Calculate confidence based on data availability
    const dataPoints = historicalData.filter(d => 
      dayjs(d.recorded_at).hour() === hour
    ).length;
    const confidence = Math.min(dataPoints / 10, 1) * 0.8 + 0.2;
    
    // Determine risk level
    let riskLevel: 'low' | 'medium' | 'high' = 'low';
    const recommendations: string[] = [];
    
    if (Math.abs(predictedTemp - patterns.averageTemp) > patterns.stdDeviation * 2) {
      riskLevel = 'high';
      recommendations.push('Significant temperature deviation expected');
      recommendations.push('Consider rescheduling reskflow');
    } else if (Math.abs(predictedTemp - patterns.averageTemp) > patterns.stdDeviation) {
      riskLevel = 'medium';
      recommendations.push('Monitor temperature closely');
      recommendations.push('Ensure device calibration is current');
    }

    return {
      timestamp,
      predictedTemp: Math.round(predictedTemp * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      riskLevel,
      recommendations,
    };
  }

  private analyzeBatteryTrend(readings: any[]): { degradationRate: number } {
    if (readings.length < 2) {
      return { degradationRate: 0 };
    }

    const batteryLevels = readings
      .filter(r => r.battery_level !== null)
      .map(r => ({ time: r.recorded_at, level: r.battery_level }));

    if (batteryLevels.length < 2) {
      return { degradationRate: 0 };
    }

    // Calculate degradation rate (% per hour)
    const firstReading = batteryLevels[0];
    const lastReading = batteryLevels[batteryLevels.length - 1];
    const hoursDiff = dayjs(lastReading.time).diff(firstReading.time, 'hour');
    
    if (hoursDiff === 0) {
      return { degradationRate: 0 };
    }

    const degradationRate = (firstReading.level - lastReading.level) / hoursDiff;
    return { degradationRate: Math.max(0, degradationRate) };
  }

  private analyzeCalibrationDrift(calibrations: any[]): number {
    if (calibrations.length < 2) {
      return 0;
    }

    // Calculate drift between calibrations
    let totalDrift = 0;
    for (let i = 1; i < calibrations.length; i++) {
      const drift = Math.abs(calibrations[i].offset - calibrations[i - 1].offset);
      totalDrift += drift;
    }

    return totalDrift / (calibrations.length - 1);
  }

  private analyzeReadingConsistency(readings: any[]): number {
    if (readings.length < 3) {
      return 0;
    }

    // Calculate variance in consecutive readings
    let totalVariance = 0;
    for (let i = 1; i < readings.length; i++) {
      const diff = Math.abs(readings[i].temperature - readings[i - 1].temperature);
      totalVariance += diff;
    }

    const avgVariance = totalVariance / (readings.length - 1);
    return avgVariance / 10; // Normalize to 0-1 scale
  }

  private getOptimalTemperature(order: any): number {
    // Determine optimal temperature based on order items
    // This is simplified - in reality would check each item's requirements
    return 3; // Default refrigerated temperature
  }

  private async analyzeWeatherImpact(address: string): Promise<{
    temperature: number;
    humidity: number;
    risk: number;
  }> {
    // In production, this would call a weather API
    return {
      temperature: 25,
      humidity: 60,
      risk: 0.2,
    };
  }

  private async getVehiclePerformanceMetrics(vehicleId: string): Promise<{
    coolingEfficiency: number;
    insulationQuality: number;
    maintenanceScore: number;
  }> {
    // Analyze vehicle's temperature control performance
    return {
      coolingEfficiency: 0.85,
      insulationQuality: 0.9,
      maintenanceScore: 0.8,
    };
  }

  private calculateOptimalDepartureTime(
    weatherImpact: any,
    destinationCount: number,
    vehiclePerformance: any
  ): Date {
    // Calculate based on various factors
    const baseDelay = destinationCount * 15; // 15 minutes per stop
    const weatherDelay = weatherImpact.risk * 30; // Up to 30 minutes for weather
    const performanceAdjustment = (1 - vehiclePerformance.coolingEfficiency) * 20;
    
    const totalDelay = baseDelay + weatherDelay + performanceAdjustment;
    
    return dayjs().add(totalDelay, 'minute').toDate();
  }

  private estimateRouteTemperatureRisk(
    weatherImpact: any,
    destinationCount: number,
    vehiclePerformance: any
  ): number {
    const baseRisk = destinationCount * 2; // 2% per stop
    const weatherRisk = weatherImpact.risk * 20;
    const vehicleRisk = (1 - vehiclePerformance.insulationQuality) * 30;
    
    return Math.min(baseRisk + weatherRisk + vehicleRisk, 100);
  }

  private generateOptimalRoute(
    order: any,
    weatherImpact: any,
    destinationCount: number
  ): any[] {
    // Generate optimized route
    // In production, this would use actual routing algorithms
    return [
      { stop: 1, address: order.reskflow_address, estimatedTime: '10:00 AM' },
    ];
  }

  private determineMaintenanceType(prediction: EquipmentFailurePrediction): string {
    if (prediction.indicators.includes('Rapid battery degradation detected')) {
      return 'battery_replacement';
    }
    if (prediction.indicators.includes('Significant calibration drift')) {
      return 'calibration';
    }
    if (prediction.indicators.includes('High error frequency')) {
      return 'diagnostic_check';
    }
    return 'general_maintenance';
  }
}