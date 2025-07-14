import { prisma, logger } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import { DocumentScanService } from './DocumentScanService';

interface PrescriptionData {
  id: string;
  patientName: string;
  prescribedBy: string;
  prescriptionDate: Date;
  expiryDate: Date;
  medications: Array<{
    name: string;
    dosage: string;
    quantity: number;
    refills: number;
  }>;
  verified: boolean;
}

interface VerificationResult {
  isValid: boolean;
  prescription: PrescriptionData;
  failureReasons?: string[];
}

export class PrescriptionVerificationService {
  constructor() {}

  async uploadPrescription(params: {
    orderId: string;
    customerId: string;
    file: Express.Multer.File;
    prescribedBy: string;
    expiryDate: string;
  }): Promise<{
    prescriptionId: string;
    status: string;
    message: string;
  }> {
    // Create prescription record
    const prescription = await prisma.prescription.create({
      data: {
        id: uuidv4(),
        order_id: params.orderId,
        customer_id: params.customerId,
        prescribed_by: params.prescribedBy,
        expiry_date: new Date(params.expiryDate),
        status: 'pending_verification',
        uploaded_at: new Date(),
      },
    });

    // Store file reference
    await prisma.prescriptionDocument.create({
      data: {
        prescription_id: prescription.id,
        file_name: params.file.originalname,
        file_size: params.file.size,
        mime_type: params.file.mimetype,
        storage_path: `prescriptions/${prescription.id}/${params.file.originalname}`,
      },
    });

    return {
      prescriptionId: prescription.id,
      status: 'pending_verification',
      message: 'Prescription uploaded successfully',
    };
  }

  async verifyPrescription(prescriptionId: string, orderId: string): Promise<VerificationResult> {
    const prescription = await prisma.prescription.findUnique({
      where: { id: prescriptionId },
      include: {
        documents: true,
        customer: true,
      },
    });

    if (!prescription) {
      throw new Error('Prescription not found');
    }

    const failureReasons: string[] = [];
    let isValid = true;

    // Check expiry
    if (dayjs().isAfter(prescription.expiry_date)) {
      isValid = false;
      failureReasons.push('Prescription has expired');
    }

    // Verify prescription matches order
    const orderMatches = await this.verifyPrescriptionMatchesOrder(prescription, orderId);
    if (!orderMatches.isValid) {
      isValid = false;
      failureReasons.push(...orderMatches.reasons);
    }

    // Check prescription authenticity
    const isAuthentic = await this.verifyPrescriptionAuthenticity(prescription);
    if (!isAuthentic) {
      isValid = false;
      failureReasons.push('Prescription authenticity could not be verified');
    }

    // Check prescriber validity
    const prescriberValid = await this.verifyPrescriber(prescription.prescribed_by);
    if (!prescriberValid) {
      isValid = false;
      failureReasons.push('Prescriber verification failed');
    }

    // Update prescription status
    await prisma.prescription.update({
      where: { id: prescriptionId },
      data: {
        status: isValid ? 'verified' : 'rejected',
        verified_at: new Date(),
        rejection_reasons: failureReasons.length > 0 ? failureReasons : undefined,
      },
    });

    // Log verification
    await this.logVerification({
      prescriptionId,
      orderId,
      verified: isValid,
      failureReasons,
    });

    return {
      isValid,
      prescription: this.mapToPrescriptionData(prescription),
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
    };
  }

  async validatePrescription(documentId: string, orderId: string): Promise<boolean> {
    try {
      const document = await prisma.verificationDocument.findUnique({
        where: { id: documentId },
        include: {
          session: {
            include: {
              order: {
                include: {
                  orderItems: {
                    include: { item: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!document || document.type !== 'prescription') {
        return false;
      }

      // Extract prescription data from document
      const prescriptionData = document.extracted_data;
      if (!prescriptionData) {
        return false;
      }

      // Verify medications match order items
      const orderMedications = document.session.order.orderItems
        .filter(item => item.item.requires_prescription)
        .map(item => item.item.name.toLowerCase());

      const prescribedMedications = (prescriptionData.medications || [])
        .map((med: any) => med.name.toLowerCase());

      // All ordered medications must be in prescription
      const allMedicationsPresent = orderMedications.every(med =>
        prescribedMedications.some((prescribed: string) => prescribed.includes(med))
      );

      if (!allMedicationsPresent) {
        return false;
      }

      // Check prescription is not expired
      if (prescriptionData.expiryDate && dayjs().isAfter(prescriptionData.expiryDate)) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error validating prescription:', error);
      return false;
    }
  }

  async checkRefillEligibility(params: {
    prescriptionId: string;
    medicationName: string;
  }): Promise<{
    eligible: boolean;
    remainingRefills: number;
    lastFillDate?: Date;
    nextEligibleDate?: Date;
  }> {
    const prescription = await prisma.prescription.findUnique({
      where: { id: params.prescriptionId },
      include: {
        refills: {
          where: { medication_name: params.medicationName },
          orderBy: { filled_at: 'desc' },
        },
      },
    });

    if (!prescription) {
      throw new Error('Prescription not found');
    }

    // Get medication details from prescription
    const medicationData = prescription.medication_data as any;
    const medication = medicationData?.medications?.find(
      (med: any) => med.name === params.medicationName
    );

    if (!medication) {
      throw new Error('Medication not found in prescription');
    }

    const totalRefills = medication.refills || 0;
    const usedRefills = prescription.refills.length;
    const remainingRefills = totalRefills - usedRefills;

    if (remainingRefills <= 0) {
      return {
        eligible: false,
        remainingRefills: 0,
      };
    }

    // Check refill timing restrictions
    const lastRefill = prescription.refills[0];
    if (lastRefill) {
      const daysSinceLastFill = dayjs().diff(lastRefill.filled_at, 'day');
      const minimumDaysBetweenRefills = this.getRefillInterval(medication);

      if (daysSinceLastFill < minimumDaysBetweenRefills) {
        const nextEligibleDate = dayjs(lastRefill.filled_at)
          .add(minimumDaysBetweenRefills, 'day')
          .toDate();

        return {
          eligible: false,
          remainingRefills,
          lastFillDate: lastRefill.filled_at,
          nextEligibleDate,
        };
      }
    }

    return {
      eligible: true,
      remainingRefills,
      lastFillDate: lastRefill?.filled_at,
    };
  }

  async recordRefill(params: {
    prescriptionId: string;
    orderId: string;
    medicationName: string;
    quantity: number;
  }): Promise<void> {
    await prisma.prescriptionRefill.create({
      data: {
        prescription_id: params.prescriptionId,
        order_id: params.orderId,
        medication_name: params.medicationName,
        quantity: params.quantity,
        filled_at: new Date(),
      },
    });

    logger.info('Prescription refill recorded:', params);
  }

  async getPrescriberInfo(prescriberId: string): Promise<{
    isValid: boolean;
    prescriber?: {
      name: string;
      licenseNumber: string;
      state: string;
      speciality: string;
    };
  }> {
    const prescriber = await prisma.prescriber.findUnique({
      where: { id: prescriberId },
    });

    if (!prescriber || !prescriber.is_active) {
      return { isValid: false };
    }

    // Check license validity
    if (prescriber.license_expiry && dayjs().isAfter(prescriber.license_expiry)) {
      return { isValid: false };
    }

    return {
      isValid: true,
      prescriber: {
        name: prescriber.name,
        licenseNumber: prescriber.license_number,
        state: prescriber.state,
        speciality: prescriber.speciality,
      },
    };
  }

  async createControlledSubstanceLog(params: {
    prescriptionId: string;
    orderId: string;
    customerId: string;
    medicationName: string;
    quantity: number;
    scheduleClass: string;
  }): Promise<void> {
    await prisma.controlledSubstanceLog.create({
      data: {
        prescription_id: params.prescriptionId,
        order_id: params.orderId,
        customer_id: params.customerId,
        medication_name: params.medicationName,
        quantity: params.quantity,
        schedule_class: params.scheduleClass,
        dispensed_at: new Date(),
      },
    });

    // Report to relevant authorities if required
    if (this.requiresReporting(params.scheduleClass)) {
      await this.reportToAuthorities(params);
    }
  }

  private async verifyPrescriptionMatchesOrder(
    prescription: any,
    orderId: string
  ): Promise<{ isValid: boolean; reasons: string[] }> {
    const reasons: string[] = [];
    let isValid = true;

    // Get order items
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
    });

    if (!order) {
      return { isValid: false, reasons: ['Order not found'] };
    }

    // Get prescription items requiring prescription
    const prescriptionItems = order.orderItems.filter(
      item => item.item.requires_prescription
    );

    if (prescriptionItems.length === 0) {
      return { isValid: false, reasons: ['No prescription items in order'] };
    }

    // Verify customer matches
    if (prescription.customer_id !== order.customer_id) {
      isValid = false;
      reasons.push('Prescription customer does not match order');
    }

    return { isValid, reasons };
  }

  private async verifyPrescriptionAuthenticity(prescription: any): Promise<boolean> {
    // Check for security features
    // In real implementation, this would verify:
    // - DEA number validity
    // - Prescriber signature
    // - Security paper features
    // - Prescription pad number
    
    // For now, basic checks
    if (!prescription.prescribed_by || !prescription.documents.length) {
      return false;
    }

    return true;
  }

  private async verifyPrescriber(prescriberInfo: string): Promise<boolean> {
    // In real implementation, this would check:
    // - State medical board database
    // - DEA registration
    // - License status
    
    // For now, check if prescriber exists in our database
    const prescriber = await prisma.prescriber.findFirst({
      where: {
        OR: [
          { name: prescriberInfo },
          { license_number: prescriberInfo },
        ],
        is_active: true,
      },
    });

    return !!prescriber;
  }

  private getRefillInterval(medication: any): number {
    // Controlled substances have different refill intervals
    const controlledIntervals: Record<string, number> = {
      'schedule_ii': 0, // No refills allowed
      'schedule_iii': 30, // 30 days minimum
      'schedule_iv': 30, // 30 days minimum
      'schedule_v': 15, // 15 days minimum
    };

    if (medication.schedule && controlledIntervals[medication.schedule]) {
      return controlledIntervals[medication.schedule];
    }

    // Default interval for non-controlled substances
    return medication.supplyDays || 30;
  }

  private requiresReporting(scheduleClass: string): boolean {
    return ['schedule_ii', 'schedule_iii'].includes(scheduleClass.toLowerCase());
  }

  private async reportToAuthorities(params: any): Promise<void> {
    // In real implementation, this would:
    // - Submit to state PDMP (Prescription Drug Monitoring Program)
    // - Report to DEA if required
    // - Update internal compliance records
    
    logger.info('Controlled substance dispensing reported:', {
      medicationName: params.medicationName,
      scheduleClass: params.scheduleClass,
      quantity: params.quantity,
    });
  }

  private mapToPrescriptionData(prescription: any): PrescriptionData {
    return {
      id: prescription.id,
      patientName: prescription.customer?.name || 'Unknown',
      prescribedBy: prescription.prescribed_by,
      prescriptionDate: prescription.prescription_date,
      expiryDate: prescription.expiry_date,
      medications: prescription.medication_data?.medications || [],
      verified: prescription.status === 'verified',
    };
  }

  private async logVerification(params: {
    prescriptionId: string;
    orderId: string;
    verified: boolean;
    failureReasons?: string[];
  }): Promise<void> {
    await prisma.prescriptionVerificationLog.create({
      data: {
        prescription_id: params.prescriptionId,
        order_id: params.orderId,
        verification_result: params.verified,
        failure_reasons: params.failureReasons,
        verified_at: new Date(),
      },
    });
  }
}