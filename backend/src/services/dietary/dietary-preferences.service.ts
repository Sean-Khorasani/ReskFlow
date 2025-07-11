/**
 * Dietary Preferences & Allergen Alerts Service
 * Manages customer dietary restrictions, preferences, and allergen warnings
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();

interface DietaryProfile {
  id: string;
  customerId: string;
  dietaryRestrictions: DietaryRestriction[];
  allergens: Allergen[];
  preferences: FoodPreference[];
  healthConditions: HealthCondition[];
  calorieTarget?: number;
  nutritionGoals?: NutritionGoals;
  strictnessLevel: 'flexible' | 'moderate' | 'strict';
  notificationSettings: {
    allergenAlerts: boolean;
    nutritionInfo: boolean;
    alternativeSuggestions: boolean;
  };
}

interface DietaryRestriction {
  type: 'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'gluten_free' | 'dairy_free' | 'keto' | 'paleo' | 'low_carb' | 'pescatarian';
  strictness: 'avoid' | 'never';
}

interface Allergen {
  name: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
  symptoms?: string[];
  medication?: string;
}

interface FoodPreference {
  type: 'dislike' | 'avoid' | 'prefer';
  items: string[];
}

interface HealthCondition {
  condition: 'diabetes' | 'hypertension' | 'celiac' | 'lactose_intolerant' | 'nut_allergy' | 'shellfish_allergy' | 'other';
  details?: string;
  managementNotes?: string;
}

interface NutritionGoals {
  dailyCalories?: number;
  maxSodium?: number;
  maxSugar?: number;
  minProtein?: number;
  maxFat?: number;
  maxCarbs?: number;
}

interface ProductAnalysis {
  product: any;
  isSafe: boolean;
  warnings: Warning[];
  alternatives: any[];
  nutritionScore: number;
  matchScore: number;
}

interface Warning {
  type: 'allergen' | 'restriction' | 'preference' | 'nutrition';
  severity: 'info' | 'warning' | 'danger';
  message: string;
  details?: string;
  ingredient?: string;
}

export class DietaryPreferencesService extends EventEmitter {
  // Common allergens database
  private commonAllergens = [
    'milk', 'eggs', 'fish', 'shellfish', 'tree nuts', 'peanuts', 'wheat', 'soybeans', 'sesame'
  ];

  // Ingredient mappings for restrictions
  private restrictionIngredients = {
    vegan: ['meat', 'poultry', 'fish', 'dairy', 'eggs', 'honey', 'gelatin'],
    vegetarian: ['meat', 'poultry', 'fish', 'gelatin'],
    gluten_free: ['wheat', 'barley', 'rye', 'malt', 'brewer\'s yeast'],
    dairy_free: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'whey', 'casein', 'lactose'],
    halal: ['pork', 'alcohol', 'non-halal meat'],
    kosher: ['pork', 'shellfish', 'mixing meat and dairy'],
  };

  constructor() {
    super();
  }

  /**
   * Create or update dietary profile
   */
  async updateDietaryProfile(customerId: string, profileData: Partial<DietaryProfile>): Promise<DietaryProfile> {
    try {
      const existingProfile = await prisma.dietaryProfile.findUnique({
        where: { customerId },
      });

      let profile;
      if (existingProfile) {
        profile = await prisma.dietaryProfile.update({
          where: { customerId },
          data: {
            ...profileData,
            updatedAt: new Date(),
          },
        });
      } else {
        profile = await prisma.dietaryProfile.create({
          data: {
            customerId,
            strictnessLevel: 'moderate',
            notificationSettings: {
              allergenAlerts: true,
              nutritionInfo: true,
              alternativeSuggestions: true,
            },
            ...profileData,
          },
        });
      }

      // Emit event
      this.emit('dietary_profile:updated', {
        customerId,
        profile,
      });

      logger.info(`Dietary profile updated for customer ${customerId}`);

      return profile;

    } catch (error) {
      logger.error('Failed to update dietary profile', error);
      throw error;
    }
  }

  /**
   * Analyze product for dietary compatibility
   */
  async analyzeProduct(productId: string, customerId: string): Promise<ProductAnalysis> {
    try {
      const [product, profile] = await Promise.all([
        prisma.product.findUnique({
          where: { id: productId },
          include: {
            ingredients: true,
            nutritionInfo: true,
            category: true,
          },
        }),
        prisma.dietaryProfile.findUnique({
          where: { customerId },
        }),
      ]);

      if (!product) {
        throw new Error('Product not found');
      }

      if (!profile) {
        // No dietary profile, product is safe
        return {
          product,
          isSafe: true,
          warnings: [],
          alternatives: [],
          nutritionScore: 100,
          matchScore: 100,
        };
      }

      const warnings: Warning[] = [];
      let isSafe = true;
      let matchScore = 100;

      // Check allergens
      const allergenWarnings = this.checkAllergens(product, profile);
      warnings.push(...allergenWarnings);
      if (allergenWarnings.some(w => w.severity === 'danger')) {
        isSafe = false;
        matchScore = 0;
      }

      // Check dietary restrictions
      const restrictionWarnings = this.checkDietaryRestrictions(product, profile);
      warnings.push(...restrictionWarnings);
      if (restrictionWarnings.some(w => w.severity === 'danger')) {
        isSafe = false;
        matchScore = Math.min(matchScore, 20);
      }

      // Check preferences
      const preferenceWarnings = this.checkPreferences(product, profile);
      warnings.push(...preferenceWarnings);
      matchScore -= preferenceWarnings.length * 10;

      // Check nutrition goals
      const nutritionWarnings = this.checkNutritionGoals(product, profile);
      warnings.push(...nutritionWarnings);
      
      // Calculate nutrition score
      const nutritionScore = this.calculateNutritionScore(product, profile);

      // Find alternatives if product is not safe
      let alternatives = [];
      if (!isSafe || matchScore < 50) {
        alternatives = await this.findAlternatives(product, profile);
      }

      return {
        product,
        isSafe,
        warnings,
        alternatives,
        nutritionScore,
        matchScore: Math.max(0, matchScore),
      };

    } catch (error) {
      logger.error('Failed to analyze product', error);
      throw error;
    }
  }

  /**
   * Analyze entire order
   */
  async analyzeOrder(orderId: string, customerId: string): Promise<{
    safeItems: any[];
    unsafeItems: any[];
    warnings: Warning[];
    suggestions: any[];
    totalCalories: number;
    nutritionSummary: any;
  }> {
    try {
      const [order, profile] = await Promise.all([
        prisma.order.findUnique({
          where: { id: orderId },
          include: {
            items: {
              include: {
                product: {
                  include: {
                    ingredients: true,
                    nutritionInfo: true,
                  },
                },
              },
            },
          },
        }),
        prisma.dietaryProfile.findUnique({
          where: { customerId },
        }),
      ]);

      if (!order || order.customerId !== customerId) {
        throw new Error('Order not found');
      }

      if (!profile) {
        // No dietary profile
        return {
          safeItems: order.items,
          unsafeItems: [],
          warnings: [],
          suggestions: [],
          totalCalories: 0,
          nutritionSummary: {},
        };
      }

      const safeItems = [];
      const unsafeItems = [];
      const allWarnings: Warning[] = [];
      let totalCalories = 0;
      const nutritionTotals = {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        sodium: 0,
        sugar: 0,
      };

      // Analyze each item
      for (const item of order.items) {
        const analysis = await this.analyzeProduct(item.productId, customerId);
        
        if (analysis.isSafe) {
          safeItems.push(item);
        } else {
          unsafeItems.push({
            ...item,
            warnings: analysis.warnings,
            alternatives: analysis.alternatives,
          });
        }

        allWarnings.push(...analysis.warnings);

        // Add nutrition info
        if (item.product.nutritionInfo) {
          const nutrition = item.product.nutritionInfo;
          const quantity = item.quantity;
          
          nutritionTotals.calories += (nutrition.calories || 0) * quantity;
          nutritionTotals.protein += (nutrition.protein || 0) * quantity;
          nutritionTotals.carbs += (nutrition.carbs || 0) * quantity;
          nutritionTotals.fat += (nutrition.fat || 0) * quantity;
          nutritionTotals.sodium += (nutrition.sodium || 0) * quantity;
          nutritionTotals.sugar += (nutrition.sugar || 0) * quantity;
        }
      }

      totalCalories = nutritionTotals.calories;

      // Generate suggestions
      const suggestions = await this.generateOrderSuggestions(order, profile, unsafeItems);

      // Send alerts if needed
      if (unsafeItems.length > 0 && profile.notificationSettings.allergenAlerts) {
        await this.sendDietaryAlert(customerId, orderId, unsafeItems, allWarnings);
      }

      return {
        safeItems,
        unsafeItems,
        warnings: allWarnings,
        suggestions,
        totalCalories,
        nutritionSummary: nutritionTotals,
      };

    } catch (error) {
      logger.error('Failed to analyze order', error);
      throw error;
    }
  }

  /**
   * Check for allergens
   */
  private checkAllergens(product: any, profile: DietaryProfile): Warning[] {
    const warnings: Warning[] = [];

    if (!product.ingredients || product.ingredients.length === 0) {
      // No ingredient info available
      if (profile.allergens.length > 0) {
        warnings.push({
          type: 'allergen',
          severity: 'warning',
          message: 'Ingredient information not available',
          details: 'Cannot verify allergen safety for this product',
        });
      }
      return warnings;
    }

    for (const allergen of profile.allergens) {
      const found = product.ingredients.some(ing => 
        ing.name.toLowerCase().includes(allergen.name.toLowerCase()) ||
        ing.contains?.some(c => c.toLowerCase().includes(allergen.name.toLowerCase()))
      );

      if (found) {
        warnings.push({
          type: 'allergen',
          severity: allergen.severity === 'life_threatening' ? 'danger' : 'warning',
          message: `Contains ${allergen.name}`,
          details: allergen.severity === 'life_threatening' 
            ? 'SEVERE ALLERGY WARNING: This product contains a life-threatening allergen'
            : `This product contains ${allergen.name} which you are allergic to`,
          ingredient: allergen.name,
        });
      }
    }

    // Check for cross-contamination warnings
    if (product.allergenInfo?.mayContain) {
      for (const allergen of profile.allergens) {
        if (product.allergenInfo.mayContain.includes(allergen.name)) {
          warnings.push({
            type: 'allergen',
            severity: 'warning',
            message: `May contain ${allergen.name}`,
            details: 'Product is made in a facility that also processes this allergen',
            ingredient: allergen.name,
          });
        }
      }
    }

    return warnings;
  }

  /**
   * Check dietary restrictions
   */
  private checkDietaryRestrictions(product: any, profile: DietaryProfile): Warning[] {
    const warnings: Warning[] = [];

    for (const restriction of profile.dietaryRestrictions) {
      const restrictedIngredients = this.restrictionIngredients[restriction.type] || [];
      
      if (product.ingredients) {
        for (const restricted of restrictedIngredients) {
          const found = product.ingredients.some(ing => 
            ing.name.toLowerCase().includes(restricted.toLowerCase())
          );

          if (found) {
            warnings.push({
              type: 'restriction',
              severity: restriction.strictness === 'never' ? 'danger' : 'warning',
              message: `Not ${restriction.type}`,
              details: `Contains ${restricted} which violates ${restriction.type} diet`,
              ingredient: restricted,
            });
          }
        }
      }

      // Check product tags
      if (product.tags) {
        const hasTag = product.tags.includes(restriction.type);
        if (!hasTag && restriction.strictness === 'never') {
          warnings.push({
            type: 'restriction',
            severity: 'warning',
            message: `Not certified ${restriction.type}`,
            details: `Product is not marked as ${restriction.type}`,
          });
        }
      }
    }

    return warnings;
  }

  /**
   * Check food preferences
   */
  private checkPreferences(product: any, profile: DietaryProfile): Warning[] {
    const warnings: Warning[] = [];

    for (const pref of profile.preferences) {
      if (pref.type === 'avoid' || pref.type === 'dislike') {
        for (const item of pref.items) {
          if (product.name.toLowerCase().includes(item.toLowerCase()) ||
              product.description?.toLowerCase().includes(item.toLowerCase())) {
            warnings.push({
              type: 'preference',
              severity: 'info',
              message: `Contains ${item}`,
              details: `You prefer to ${pref.type} ${item}`,
            });
          }
        }
      }
    }

    return warnings;
  }

  /**
   * Check nutrition goals
   */
  private checkNutritionGoals(product: any, profile: DietaryProfile): Warning[] {
    const warnings: Warning[] = [];

    if (!profile.nutritionGoals || !product.nutritionInfo) {
      return warnings;
    }

    const nutrition = product.nutritionInfo;
    const goals = profile.nutritionGoals;

    if (goals.maxCalories && nutrition.calories > goals.maxCalories) {
      warnings.push({
        type: 'nutrition',
        severity: 'info',
        message: `High calorie: ${nutrition.calories} cal`,
        details: `Exceeds your meal calorie target of ${goals.maxCalories}`,
      });
    }

    if (goals.maxSodium && nutrition.sodium > goals.maxSodium) {
      warnings.push({
        type: 'nutrition',
        severity: 'warning',
        message: `High sodium: ${nutrition.sodium}mg`,
        details: `Exceeds your sodium limit of ${goals.maxSodium}mg`,
      });
    }

    if (goals.maxSugar && nutrition.sugar > goals.maxSugar) {
      warnings.push({
        type: 'nutrition',
        severity: 'info',
        message: `High sugar: ${nutrition.sugar}g`,
        details: `Exceeds your sugar limit of ${goals.maxSugar}g`,
      });
    }

    return warnings;
  }

  /**
   * Calculate nutrition score
   */
  private calculateNutritionScore(product: any, profile: DietaryProfile): number {
    if (!product.nutritionInfo) {
      return 50; // Unknown nutrition
    }

    let score = 100;
    const nutrition = product.nutritionInfo;

    // Penalize high calories
    if (nutrition.calories > 800) score -= 10;
    if (nutrition.calories > 1000) score -= 10;

    // Penalize high sodium
    if (nutrition.sodium > 1000) score -= 15;
    if (nutrition.sodium > 1500) score -= 15;

    // Penalize high sugar
    if (nutrition.sugar > 20) score -= 10;
    if (nutrition.sugar > 40) score -= 10;

    // Penalize high saturated fat
    if (nutrition.saturatedFat > 10) score -= 10;
    if (nutrition.saturatedFat > 20) score -= 10;

    // Bonus for protein
    if (nutrition.protein > 20) score += 10;

    // Bonus for fiber
    if (nutrition.fiber > 5) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Find alternative products
   */
  private async findAlternatives(product: any, profile: DietaryProfile): Promise<any[]> {
    // Find products in same category that are safe
    const alternatives = await prisma.product.findMany({
      where: {
        merchantId: product.merchantId,
        categoryId: product.categoryId,
        id: { not: product.id },
        isAvailable: true,
      },
      include: {
        ingredients: true,
        nutritionInfo: true,
      },
      take: 5,
    });

    // Filter and score alternatives
    const scoredAlternatives = [];
    for (const alt of alternatives) {
      const analysis = await this.analyzeProduct(alt.id, profile.customerId);
      if (analysis.isSafe && analysis.matchScore > 70) {
        scoredAlternatives.push({
          ...alt,
          matchScore: analysis.matchScore,
          nutritionScore: analysis.nutritionScore,
        });
      }
    }

    // Sort by match score
    return scoredAlternatives.sort((a, b) => b.matchScore - a.matchScore);
  }

  /**
   * Generate order suggestions
   */
  private async generateOrderSuggestions(order: any, profile: DietaryProfile, unsafeItems: any[]): Promise<any[]> {
    const suggestions = [];

    // Suggest alternatives for unsafe items
    for (const item of unsafeItems) {
      if (item.alternatives && item.alternatives.length > 0) {
        suggestions.push({
          type: 'alternative',
          message: `Replace ${item.product.name} with ${item.alternatives[0].name}`,
          item: item.alternatives[0],
          reason: item.warnings[0]?.message,
        });
      }
    }

    // Nutrition balance suggestions
    if (profile.nutritionGoals) {
      // Suggest adding protein if low
      // Suggest adding vegetables if missing
      // etc.
    }

    return suggestions;
  }

  /**
   * Send dietary alert
   */
  private async sendDietaryAlert(customerId: string, orderId: string, unsafeItems: any[], warnings: Warning[]): Promise<void> {
    const dangerWarnings = warnings.filter(w => w.severity === 'danger');
    
    if (dangerWarnings.length > 0) {
      // Critical alert
      await notificationService.sendPushNotification(
        customerId,
        '⚠️ ALLERGEN ALERT',
        `Your order contains ${dangerWarnings.length} items with severe allergens!`,
        {
          type: 'dietary_alert',
          severity: 'critical',
          orderId,
          warnings: dangerWarnings,
        }
      );
    } else {
      // Regular alert
      await notificationService.sendPushNotification(
        customerId,
        'Dietary Warning',
        `${unsafeItems.length} items in your order don't match your dietary preferences`,
        {
          type: 'dietary_alert',
          severity: 'warning',
          orderId,
          itemCount: unsafeItems.length,
        }
      );
    }
  }

  /**
   * Get dietary-safe restaurants
   */
  async getSafeRestaurants(customerId: string, location?: { lat: number; lng: number }): Promise<any[]> {
    const profile = await prisma.dietaryProfile.findUnique({
      where: { customerId },
    });

    if (!profile) {
      // No dietary restrictions
      return [];
    }

    // Find restaurants with matching dietary options
    const restaurants = await prisma.merchant.findMany({
      where: {
        isOpen: true,
        OR: [
          {
            tags: {
              hasSome: profile.dietaryRestrictions.map(r => r.type),
            },
          },
          {
            specializations: {
              hasSome: profile.dietaryRestrictions.map(r => r.type),
            },
          },
        ],
      },
      include: {
        cuisine: true,
        ratings: true,
      },
    });

    // Score restaurants based on dietary match
    const scoredRestaurants = restaurants.map(restaurant => {
      let score = 0;
      
      // Check tags match
      for (const restriction of profile.dietaryRestrictions) {
        if (restaurant.tags?.includes(restriction.type)) {
          score += 20;
        }
      }

      // Check for allergen-free options
      if (restaurant.features?.includes('allergen_menu')) {
        score += 10;
      }

      // Check for nutrition info availability
      if (restaurant.features?.includes('nutrition_info')) {
        score += 10;
      }

      return {
        ...restaurant,
        dietaryScore: score,
        averageRating: restaurant.ratings.length > 0
          ? restaurant.ratings.reduce((sum, r) => sum + r.rating, 0) / restaurant.ratings.length
          : 0,
      };
    });

    // Sort by dietary score and rating
    return scoredRestaurants.sort((a, b) => {
      if (b.dietaryScore !== a.dietaryScore) {
        return b.dietaryScore - a.dietaryScore;
      }
      return b.averageRating - a.averageRating;
    });
  }

  /**
   * Get dietary statistics
   */
  async getDietaryStats(customerId: string, period: 'week' | 'month' | 'year'): Promise<any> {
    const profile = await prisma.dietaryProfile.findUnique({
      where: { customerId },
    });

    if (!profile) {
      return null;
    }

    const startDate = this.getStartDate(period);
    
    // Get orders in period
    const orders = await prisma.order.findMany({
      where: {
        customerId,
        createdAt: { gte: startDate },
        status: 'delivered',
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                nutritionInfo: true,
              },
            },
          },
        },
      },
    });

    // Calculate statistics
    const stats = {
      totalOrders: orders.length,
      dietaryCompliance: 0,
      averageCalories: 0,
      nutritionBreakdown: {
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
      },
      allergenExposures: 0,
      restrictionViolations: 0,
    };

    let totalCalories = 0;
    let compliantOrders = 0;

    for (const order of orders) {
      const analysis = await this.analyzeOrder(order.id, customerId);
      
      if (analysis.unsafeItems.length === 0) {
        compliantOrders++;
      }

      stats.allergenExposures += analysis.warnings.filter(w => w.type === 'allergen').length;
      stats.restrictionViolations += analysis.warnings.filter(w => w.type === 'restriction').length;

      totalCalories += analysis.totalCalories;
      
      // Add nutrition totals
      if (analysis.nutritionSummary) {
        stats.nutritionBreakdown.protein += analysis.nutritionSummary.protein || 0;
        stats.nutritionBreakdown.carbs += analysis.nutritionSummary.carbs || 0;
        stats.nutritionBreakdown.fat += analysis.nutritionSummary.fat || 0;
        stats.nutritionBreakdown.fiber += analysis.nutritionSummary.fiber || 0;
      }
    }

    stats.dietaryCompliance = orders.length > 0 
      ? Math.round((compliantOrders / orders.length) * 100)
      : 100;
    
    stats.averageCalories = orders.length > 0
      ? Math.round(totalCalories / orders.length)
      : 0;

    // Average out nutrition
    if (orders.length > 0) {
      stats.nutritionBreakdown.protein = Math.round(stats.nutritionBreakdown.protein / orders.length);
      stats.nutritionBreakdown.carbs = Math.round(stats.nutritionBreakdown.carbs / orders.length);
      stats.nutritionBreakdown.fat = Math.round(stats.nutritionBreakdown.fat / orders.length);
      stats.nutritionBreakdown.fiber = Math.round(stats.nutritionBreakdown.fiber / orders.length);
    }

    return stats;
  }

  /**
   * Get start date for period
   */
  private getStartDate(period: string): Date {
    const now = new Date();
    switch (period) {
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'year':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Import dietary profile from health apps
   */
  async importFromHealthApp(customerId: string, source: 'apple_health' | 'google_fit', data: any): Promise<void> {
    // Parse health data and update profile
    // This would integrate with health app APIs
    logger.info(`Importing dietary data from ${source} for customer ${customerId}`);
  }

  /**
   * Get allergen information for menu
   */
  async getMenuAllergenInfo(merchantId: string): Promise<any> {
    const products = await prisma.product.findMany({
      where: {
        merchantId,
        isAvailable: true,
      },
      include: {
        ingredients: true,
        allergenInfo: true,
      },
    });

    // Group by allergens
    const allergenMap = new Map<string, any[]>();
    
    for (const product of products) {
      if (product.allergenInfo?.contains) {
        for (const allergen of product.allergenInfo.contains) {
          if (!allergenMap.has(allergen)) {
            allergenMap.set(allergen, []);
          }
          allergenMap.get(allergen)!.push(product);
        }
      }
    }

    return {
      allergens: Array.from(allergenMap.entries()).map(([allergen, products]) => ({
        name: allergen,
        productCount: products.length,
        products: products.map(p => ({ id: p.id, name: p.name })),
      })),
      totalProducts: products.length,
      productsWithAllergenInfo: products.filter(p => p.allergenInfo).length,
    };
  }
}

// Export singleton instance
export const dietaryPreferencesService = new DietaryPreferencesService();