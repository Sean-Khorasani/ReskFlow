import { Router } from 'express';
import { SecurityController } from '../controllers/security.controller';
import { 
  auditMiddleware,
  criticalAuditMiddleware,
  dataAccessAuditMiddleware,
  adminAuditMiddleware,
  authAuditMiddleware 
} from '../middleware/audit';
import {
  rateLimitMiddleware,
  authRateLimitMiddleware,
  requestSizeLimitMiddleware,
  threatDetectionMiddleware,
  contentTypeValidationMiddleware,
  securityHeadersMiddleware,
  requestValidationMiddleware
} from '../middleware/security';

export function createSecurityRoutes(securityController: SecurityController): Router {
  const router = Router();

  // Apply global middleware
  router.use(securityHeadersMiddleware);
  router.use(requestValidationMiddleware);
  router.use(threatDetectionMiddleware);
  router.use(auditMiddleware);

  // Health and status endpoints (minimal restrictions)
  router.get('/health', 
    securityController.healthCheck.bind(securityController)
  );

  router.get('/status',
    rateLimitMiddleware,
    securityController.getSecurityStatus.bind(securityController)
  );

  // Configuration validation (admin only)
  router.get('/validate',
    rateLimitMiddleware,
    adminAuditMiddleware,
    securityController.validateConfiguration.bind(securityController)
  );

  // Encryption endpoints
  router.post('/encrypt',
    rateLimitMiddleware,
    requestSizeLimitMiddleware(1024 * 1024), // 1MB limit for encryption
    contentTypeValidationMiddleware(['application/json']),
    securityController.encryptData.bind(securityController)
  );

  router.post('/decrypt',
    rateLimitMiddleware,
    requestSizeLimitMiddleware(1024 * 1024), // 1MB limit for decryption
    contentTypeValidationMiddleware(['application/json']),
    criticalAuditMiddleware,
    securityController.decryptData.bind(securityController)
  );

  router.post('/token/generate',
    rateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    securityController.generateToken.bind(securityController)
  );

  // Password management endpoints
  router.post('/password/hash',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    authAuditMiddleware,
    securityController.hashPassword.bind(securityController)
  );

  router.post('/password/verify',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    authAuditMiddleware,
    securityController.verifyPassword.bind(securityController)
  );

  // MFA endpoints
  router.post('/mfa/generate',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    authAuditMiddleware,
    securityController.generateMFASecret.bind(securityController)
  );

  router.post('/mfa/verify',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    authAuditMiddleware,
    securityController.verifyMFAToken.bind(securityController)
  );

  // Threat detection endpoints
  router.post('/scan',
    rateLimitMiddleware,
    requestSizeLimitMiddleware(5 * 1024 * 1024), // 5MB limit for scanning
    contentTypeValidationMiddleware(['application/json']),
    securityController.scanForThreats.bind(securityController)
  );

  router.get('/metrics',
    rateLimitMiddleware,
    adminAuditMiddleware,
    securityController.getSecurityMetrics.bind(securityController)
  );

  // Audit endpoints
  router.get('/audit/logs',
    rateLimitMiddleware,
    adminAuditMiddleware,
    dataAccessAuditMiddleware('audit_logs'),
    securityController.getAuditLogs.bind(securityController)
  );

  // GDPR compliance endpoints
  router.get('/gdpr/export/:userId',
    rateLimitMiddleware,
    adminAuditMiddleware,
    dataAccessAuditMiddleware('personal_data'),
    securityController.exportPersonalData.bind(securityController)
  );

  router.delete('/gdpr/delete/:userId',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    criticalAuditMiddleware,
    dataAccessAuditMiddleware('personal_data'),
    securityController.deletePersonalData.bind(securityController)
  );

  // Key management endpoints (critical security operations)
  router.post('/keys/generate',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    criticalAuditMiddleware,
    adminAuditMiddleware,
    securityController.generateKey.bind(securityController)
  );

  router.post('/keys/:keyId/rotate',
    authRateLimitMiddleware,
    criticalAuditMiddleware,
    adminAuditMiddleware,
    securityController.rotateKey.bind(securityController)
  );

  router.delete('/keys/:keyId/revoke',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    criticalAuditMiddleware,
    adminAuditMiddleware,
    securityController.revokeKey.bind(securityController)
  );

  // Emergency endpoints (highest security)
  router.post('/emergency/lockdown',
    authRateLimitMiddleware,
    contentTypeValidationMiddleware(['application/json']),
    criticalAuditMiddleware,
    adminAuditMiddleware,
    securityController.emergencyLockdown.bind(securityController)
  );

  return router;
}

// Create separate router for administrative functions
export function createAdminSecurityRoutes(securityController: SecurityController): Router {
  const router = Router();

  // Apply strict middleware for admin routes
  router.use(securityHeadersMiddleware);
  router.use(requestValidationMiddleware);
  router.use(threatDetectionMiddleware);
  router.use(authRateLimitMiddleware); // Stricter rate limiting
  router.use(adminAuditMiddleware);
  router.use(criticalAuditMiddleware);

  // Admin-only endpoints
  router.get('/system/status',
    securityController.getSecurityStatus.bind(securityController)
  );

  router.get('/system/validate',
    securityController.validateConfiguration.bind(securityController)
  );

  router.get('/system/metrics',
    securityController.getSecurityMetrics.bind(securityController)
  );

  router.get('/audit/logs',
    dataAccessAuditMiddleware('audit_logs'),
    securityController.getAuditLogs.bind(securityController)
  );

  return router;
}

// Create router for internal service-to-service communication
export function createInternalSecurityRoutes(securityController: SecurityController): Router {
  const router = Router();

  // Apply minimal middleware for internal routes
  router.use(securityHeadersMiddleware);
  router.use(requestValidationMiddleware);
  router.use(auditMiddleware);

  // Internal-only endpoints (no rate limiting for service communication)
  router.post('/internal/encrypt',
    contentTypeValidationMiddleware(['application/json']),
    securityController.encryptData.bind(securityController)
  );

  router.post('/internal/decrypt',
    contentTypeValidationMiddleware(['application/json']),
    securityController.decryptData.bind(securityController)
  );

  router.post('/internal/password/hash',
    contentTypeValidationMiddleware(['application/json']),
    securityController.hashPassword.bind(securityController)
  );

  router.post('/internal/password/verify',
    contentTypeValidationMiddleware(['application/json']),
    securityController.verifyPassword.bind(securityController)
  );

  router.post('/internal/mfa/verify',
    contentTypeValidationMiddleware(['application/json']),
    securityController.verifyMFAToken.bind(securityController)
  );

  router.post('/internal/scan',
    contentTypeValidationMiddleware(['application/json']),
    securityController.scanForThreats.bind(securityController)
  );

  router.get('/internal/health',
    securityController.healthCheck.bind(securityController)
  );

  return router;
}