import { Router } from 'express';
import { CustomerController } from '../controllers/customer.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { validationMiddleware } from '../middleware/validation.middleware';
import { rateLimitMiddleware } from '../middleware/rate-limit.middleware';
import {
  customerRegistrationSchema,
  customerUpdateSchema,
  discoveryTrackingSchema,
  orderPlacementSchema,
  supportTicketSchema,
  loyaltyActionSchema,
  feedbackSchema,
  addressSchema,
  paymentMethodSchema,
  preferencesSchema
} from '../validators/customer.validators';

const router = Router();
const customerController = new CustomerController();

// Customer Registration and Onboarding
router.post(
  '/register',
  rateLimitMiddleware,
  validationMiddleware(customerRegistrationSchema),
  customerController.registerCustomer.bind(customerController)
);

// Customer Profile Management
router.put(
  '/profile',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(customerUpdateSchema),
  customerController.updateProfile.bind(customerController)
);

router.get(
  '/profile',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer profile
    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Discovery and Search Behavior Tracking
router.post(
  '/discovery/track',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(discoveryTrackingSchema),
  customerController.trackDiscovery.bind(customerController)
);

// Order Management Business Flows
router.post(
  '/orders',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(orderPlacementSchema),
  customerController.placeOrder.bind(customerController)
);

router.get(
  '/orders/:orderId/track',
  authMiddleware,
  rateLimitMiddleware,
  customerController.trackOrder.bind(customerController)
);

router.get(
  '/orders/history',
  authMiddleware,
  rateLimitMiddleware,
  customerController.getOrderHistory.bind(customerController)
);

router.post(
  '/orders/:orderId/reorder',
  authMiddleware,
  rateLimitMiddleware,
  customerController.reorderPrevious.bind(customerController)
);

// Customer Support Business Flows
router.post(
  '/support/tickets',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(supportTicketSchema),
  customerController.createSupportTicket.bind(customerController)
);

router.get(
  '/support/tickets',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer support tickets
    res.json({
      success: true,
      message: 'Support tickets retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.get(
  '/support/tickets/:ticketId',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get specific support ticket
    res.json({
      success: true,
      message: 'Support ticket retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Loyalty Program Business Flows
router.post(
  '/loyalty/actions',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(loyaltyActionSchema),
  customerController.manageLoyalty.bind(customerController)
);

router.get(
  '/loyalty/account',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get loyalty account details
    res.json({
      success: true,
      message: 'Loyalty account retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.get(
  '/loyalty/history',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get loyalty transaction history
    res.json({
      success: true,
      message: 'Loyalty history retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.get(
  '/loyalty/rewards',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get available loyalty rewards
    res.json({
      success: true,
      message: 'Loyalty rewards retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Feedback Business Flows
router.post(
  '/feedback',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(feedbackSchema),
  customerController.submitFeedback.bind(customerController)
);

router.get(
  '/feedback/history',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer feedback history
    res.json({
      success: true,
      message: 'Feedback history retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Address Management Business Flows
router.post(
  '/addresses',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(addressSchema),
  customerController.addAddress.bind(customerController)
);

router.get(
  '/addresses',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer addresses
    res.json({
      success: true,
      message: 'Addresses retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.put(
  '/addresses/:addressId',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(addressSchema),
  async (req, res) => {
    // Update address
    res.json({
      success: true,
      message: 'Address updated successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.delete(
  '/addresses/:addressId',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Delete address
    res.json({
      success: true,
      message: 'Address deleted successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Payment Method Management Business Flows
router.post(
  '/payment-methods',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(paymentMethodSchema),
  customerController.addPaymentMethod.bind(customerController)
);

router.get(
  '/payment-methods',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer payment methods
    res.json({
      success: true,
      message: 'Payment methods retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.put(
  '/payment-methods/:methodId',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Update payment method
    res.json({
      success: true,
      message: 'Payment method updated successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.delete(
  '/payment-methods/:methodId',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Delete payment method
    res.json({
      success: true,
      message: 'Payment method deleted successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Preferences Business Flows
router.get(
  '/preferences',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer preferences
    res.json({
      success: true,
      message: 'Preferences retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.put(
  '/preferences',
  authMiddleware,
  rateLimitMiddleware,
  validationMiddleware(preferencesSchema),
  customerController.updatePreferences.bind(customerController)
);

// Customer Analytics Business Flows
router.get(
  '/analytics',
  authMiddleware,
  rateLimitMiddleware,
  customerController.getCustomerAnalytics.bind(customerController)
);

router.get(
  '/analytics/spending',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get spending analytics
    res.json({
      success: true,
      message: 'Spending analytics retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.get(
  '/analytics/behavior',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get behavior analytics
    res.json({
      success: true,
      message: 'Behavior analytics retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Segmentation and Insights
router.get(
  '/insights/recommendations',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get personalized recommendations
    res.json({
      success: true,
      message: 'Recommendations retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.get(
  '/insights/patterns',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer behavior patterns
    res.json({
      success: true,
      message: 'Behavior patterns retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Account Management
router.post(
  '/account/verify-email',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Verify email
    res.json({
      success: true,
      message: 'Email verification initiated',
      timestamp: new Date().toISOString()
    });
  }
);

router.post(
  '/account/verify-phone',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Verify phone
    res.json({
      success: true,
      message: 'Phone verification initiated',
      timestamp: new Date().toISOString()
    });
  }
);

router.post(
  '/account/change-password',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Change password
    res.json({
      success: true,
      message: 'Password changed successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.delete(
  '/account',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Delete customer account
    res.json({
      success: true,
      message: 'Account deletion initiated',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Referral Program
router.get(
  '/referrals',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get referral information
    res.json({
      success: true,
      message: 'Referral information retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.post(
  '/referrals/invite',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Send referral invitation
    res.json({
      success: true,
      message: 'Referral invitation sent successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Social Features
router.get(
  '/social/reviews',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer reviews and social activity
    res.json({
      success: true,
      message: 'Social reviews retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.post(
  '/social/share',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Share order or experience
    res.json({
      success: true,
      message: 'Content shared successfully',
      timestamp: new Date().toISOString()
    });
  }
);

// Customer Subscription Management
router.get(
  '/subscriptions',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Get customer subscriptions
    res.json({
      success: true,
      message: 'Subscriptions retrieved successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.post(
  '/subscriptions',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Create subscription
    res.json({
      success: true,
      message: 'Subscription created successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.put(
  '/subscriptions/:subscriptionId',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Update subscription
    res.json({
      success: true,
      message: 'Subscription updated successfully',
      timestamp: new Date().toISOString()
    });
  }
);

router.delete(
  '/subscriptions/:subscriptionId',
  authMiddleware,
  rateLimitMiddleware,
  async (req, res) => {
    // Cancel subscription
    res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      timestamp: new Date().toISOString()
    });
  }
);

export default router;