import { prisma, logger } from '@reskflow/shared';
import { DocumentScanService } from './DocumentScanService';
import dayjs from 'dayjs';

interface AgeVerificationResult {
  isVerified: boolean;
  age?: number;
  dateOfBirth?: Date;
  minimumAgeMet: boolean;
  verificationMethod: string;
}

interface AgeRequirement {
  productType: string;
  minimumAge: number;
  strictVerification: boolean;
}

export class AgeVerificationService {
  private ageRequirements: Map<string, AgeRequirement> = new Map([
    ['alcohol', { productType: 'alcohol', minimumAge: 21, strictVerification: true }],
    ['tobacco', { productType: 'tobacco', minimumAge: 21, strictVerification: true }],
    ['cannabis', { productType: 'cannabis', minimumAge: 21, strictVerification: true }],
    ['vape', { productType: 'vape', minimumAge: 21, strictVerification: true }],
    ['lottery', { productType: 'lottery', minimumAge: 18, strictVerification: true }],
    ['mature_content', { productType: 'mature_content', minimumAge: 18, strictVerification: false }],
  ]);

  constructor(private documentScanService: DocumentScanService) {}

  async verifyAge(params: {
    customerId: string;
    dateOfBirth: string;
    productType: string;
  }): Promise<AgeVerificationResult> {
    const requirement = this.ageRequirements.get(params.productType) || {
      productType: params.productType,
      minimumAge: 18,
      strictVerification: false,
    };

    const dob = dayjs(params.dateOfBirth);
    const age = dayjs().diff(dob, 'year');
    const minimumAgeMet = age >= requirement.minimumAge;

    // Log verification attempt
    await prisma.ageVerification.create({
      data: {
        customer_id: params.customerId,
        date_of_birth: dob.toDate(),
        calculated_age: age,
        product_type: params.productType,
        minimum_age_required: requirement.minimumAge,
        verification_passed: minimumAgeMet,
        verification_method: 'manual_entry',
      },
    });

    return {
      isVerified: minimumAgeMet,
      age,
      dateOfBirth: dob.toDate(),
      minimumAgeMet,
      verificationMethod: 'manual_entry',
    };
  }

  async verifyFromDocument(params: {
    documentId: string;
    extractedData: any;
    productType: string;
  }): Promise<AgeVerificationResult> {
    const requirement = this.ageRequirements.get(params.productType) || {
      productType: params.productType,
      minimumAge: 18,
      strictVerification: false,
    };

    // Extract date of birth from document data
    const dobString = params.extractedData.dateOfBirth || params.extractedData.dob;
    if (!dobString) {
      throw new Error('Date of birth not found in document');
    }

    const dob = dayjs(dobString);
    const age = dayjs().diff(dob, 'year');
    const minimumAgeMet = age >= requirement.minimumAge;

    // Verify document authenticity
    const isAuthentic = await this.verifyDocumentAuthenticity(params.extractedData);

    // Create verification record
    await prisma.ageVerification.create({
      data: {
        document_id: params.documentId,
        date_of_birth: dob.toDate(),
        calculated_age: age,
        product_type: params.productType,
        minimum_age_required: requirement.minimumAge,
        verification_passed: minimumAgeMet && isAuthentic,
        verification_method: 'document_scan',
        document_authentic: isAuthentic,
      },
    });

    return {
      isVerified: minimumAgeMet && isAuthentic,
      age,
      dateOfBirth: dob.toDate(),
      minimumAgeMet,
      verificationMethod: 'document_scan',
    };
  }

  async getAgeRequirement(productType: string): Promise<AgeRequirement> {
    return this.ageRequirements.get(productType) || {
      productType,
      minimumAge: 18,
      strictVerification: false,
    };
  }

  async checkItemRestrictions(items: any[]): Promise<{
    requiresAgeVerification: boolean;
    minimumAge: number;
    restrictedItems: string[];
  }> {
    let requiresAgeVerification = false;
    let minimumAge = 0;
    const restrictedItems: string[] = [];

    for (const item of items) {
      if (item.age_restricted) {
        requiresAgeVerification = true;
        const itemMinAge = item.minimum_age || 21;
        minimumAge = Math.max(minimumAge, itemMinAge);
        restrictedItems.push(item.id);
      }
    }

    return {
      requiresAgeVerification,
      minimumAge,
      restrictedItems,
    };
  }

  async validateAgainstState(params: {
    state: string;
    productType: string;
    age: number;
  }): Promise<{
    isValid: boolean;
    stateMinimumAge: number;
    reason?: string;
  }> {
    // Get state-specific requirements
    const stateRequirement = await prisma.stateAgeRequirement.findFirst({
      where: {
        state: params.state,
        product_type: params.productType,
      },
    });

    if (!stateRequirement) {
      // Use default requirement
      const defaultReq = this.ageRequirements.get(params.productType);
      return {
        isValid: params.age >= (defaultReq?.minimumAge || 21),
        stateMinimumAge: defaultReq?.minimumAge || 21,
      };
    }

    const isValid = params.age >= stateRequirement.minimum_age;
    return {
      isValid,
      stateMinimumAge: stateRequirement.minimum_age,
      reason: !isValid ? `Must be ${stateRequirement.minimum_age} or older in ${params.state}` : undefined,
    };
  }

  async createAgeVerificationChallenge(customerId: string): Promise<{
    challengeId: string;
    questions: Array<{
      id: string;
      question: string;
      options: string[];
    }>;
  }> {
    // Create knowledge-based authentication questions
    const questions = [
      {
        id: 'q1',
        question: 'What year were you born?',
        options: this.generateYearOptions(),
      },
      {
        id: 'q2',
        question: 'What month were you born?',
        options: [
          'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'
        ],
      },
    ];

    const challenge = await prisma.ageVerificationChallenge.create({
      data: {
        customer_id: customerId,
        questions: questions,
        expires_at: dayjs().add(5, 'minute').toDate(),
      },
    });

    return {
      challengeId: challenge.id,
      questions,
    };
  }

  async verifyChallenge(params: {
    challengeId: string;
    answers: Record<string, string>;
  }): Promise<boolean> {
    const challenge = await prisma.ageVerificationChallenge.findUnique({
      where: { id: params.challengeId },
      include: { customer: true },
    });

    if (!challenge || dayjs().isAfter(challenge.expires_at)) {
      throw new Error('Challenge expired or not found');
    }

    // Verify answers match customer data
    const yearAnswer = params.answers['q1'];
    const monthAnswer = params.answers['q2'];

    if (!yearAnswer || !monthAnswer) {
      return false;
    }

    // Compare with customer's actual DOB if available
    const customer = challenge.customer;
    if (customer.date_of_birth) {
      const actualYear = dayjs(customer.date_of_birth).year();
      const actualMonth = dayjs(customer.date_of_birth).format('MMMM');
      
      return yearAnswer === actualYear.toString() && monthAnswer === actualMonth;
    }

    // If no DOB on file, accept the answers and calculate age
    const providedYear = parseInt(yearAnswer);
    const age = dayjs().year() - providedYear;
    
    return age >= 21;
  }

  private async verifyDocumentAuthenticity(extractedData: any): Promise<boolean> {
    // Check for security features
    const securityFeatures = [
      extractedData.hasHologram,
      extractedData.hasUVFeatures,
      extractedData.hasMicroprint,
      extractedData.hasRaisedText,
    ];

    const authenticFeatures = securityFeatures.filter(f => f === true).length;
    
    // Check expiration
    if (extractedData.expirationDate) {
      const isExpired = dayjs().isAfter(extractedData.expirationDate);
      if (isExpired) {
        return false;
      }
    }

    // Check document number format
    if (extractedData.documentNumber && !this.isValidDocumentNumber(extractedData.documentNumber)) {
      return false;
    }

    // Document is considered authentic if it has at least 2 security features
    return authenticFeatures >= 2;
  }

  private isValidDocumentNumber(documentNumber: string): boolean {
    // Basic validation - check format
    const validFormat = /^[A-Z0-9]{6,12}$/.test(documentNumber);
    return validFormat;
  }

  private generateYearOptions(): string[] {
    const currentYear = dayjs().year();
    const years: string[] = [];
    
    // Generate years from 100 years ago to 18 years ago
    for (let year = currentYear - 100; year <= currentYear - 18; year++) {
      years.push(year.toString());
    }
    
    return years.reverse();
  }

  async logAgeVerification(params: {
    customerId: string;
    orderId: string;
    verified: boolean;
    method: string;
    age?: number;
  }): Promise<void> {
    await prisma.ageVerificationLog.create({
      data: {
        customer_id: params.customerId,
        order_id: params.orderId,
        verification_passed: params.verified,
        verification_method: params.method,
        customer_age: params.age,
        verified_at: new Date(),
      },
    });

    logger.info('Age verification logged:', {
      customerId: params.customerId,
      orderId: params.orderId,
      verified: params.verified,
      method: params.method,
    });
  }
}