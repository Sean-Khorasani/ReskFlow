/**
 * Ingredient Tracking Service
 * Manages ingredient inventory, recipe management, and automated stock depletion
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { inventoryManagementService } from './inventory-management.service';

const prisma = new PrismaClient();

interface Ingredient {
  id: string;
  merchantId: string;
  name: string;
  category: 'protein' | 'vegetable' | 'dairy' | 'grain' | 'spice' | 'condiment' | 'oil' | 'other';
  unit: 'g' | 'kg' | 'ml' | 'l' | 'piece' | 'tbsp' | 'tsp' | 'cup';
  currentStock: number;
  reservedStock: number;
  minimumStock: number;
  cost: number; // Cost per unit
  supplier?: {
    id: string;
    name: string;
    productCode: string;
  };
  nutritionalInfo?: NutritionalInfo;
  allergens: string[];
  storage: {
    location: string;
    temperature: 'frozen' | 'refrigerated' | 'room_temp';
    shelfLife: number; // days
  };
  lastUpdated: Date;
}

interface NutritionalInfo {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number;
  sugar: number;
}

interface Recipe {
  id: string;
  merchantId: string;
  menuItemId: string;
  name: string;
  servingSize: number;
  preparationTime: number; // minutes
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  yield: number; // Number of servings
  costPerServing: number;
  nutritionalInfo?: NutritionalInfo;
  allergenInfo: string[];
  lastUpdated: Date;
}

interface RecipeIngredient {
  ingredientId: string;
  quantity: number;
  unit: string;
  isOptional: boolean;
  substitutes?: Array<{
    ingredientId: string;
    quantity: number;
    unit: string;
  }>;
}

interface RecipeStep {
  order: number;
  instruction: string;
  duration: number; // minutes
  temperature?: number;
  equipment?: string[];
}

interface IngredientUsage {
  id: string;
  ingredientId: string;
  recipeId: string;
  orderId: string;
  quantity: number;
  timestamp: Date;
  wastage?: number;
  reason?: 'order' | 'waste' | 'expired' | 'quality_control';
}

interface BatchTracking {
  id: string;
  ingredientId: string;
  batchNumber: string;
  quantity: number;
  receivedDate: Date;
  expiryDate: Date;
  status: 'active' | 'depleted' | 'expired' | 'recalled';
  remainingQuantity: number;
  qualityChecks: QualityCheck[];
}

interface QualityCheck {
  id: string;
  timestamp: Date;
  checkedBy: string;
  status: 'pass' | 'fail' | 'warning';
  notes?: string;
  temperature?: number;
  appearance?: string;
}

interface IngredientForecast {
  ingredientId: string;
  period: { start: Date; end: Date };
  expectedUsage: number;
  currentStock: number;
  daysUntilStockout: number;
  recommendedOrderQuantity: number;
  confidence: number; // 0-1
}

interface MenuItemIngredientMapping {
  menuItemId: string;
  recipeId: string;
  autoDeduct: boolean;
  customizations: Array<{
    customizationId: string;
    ingredientAdjustments: Array<{
      ingredientId: string;
      quantityChange: number; // positive for add, negative for remove
    }>;
  }>;
}

export class IngredientTrackingService extends EventEmitter {
  private recipeCache: Map<string, Recipe> = new Map();
  private batchTracker: Map<string, BatchTracking[]> = new Map();
  private forecastJob: CronJob;

  constructor() {
    super();
    this.initializeService();
  }

  /**
   * Initialize the service
   */
  private initializeService() {
    // Load recipes into cache
    this.loadRecipes();

    // Setup daily forecast job
    this.forecastJob = new CronJob('0 2 * * *', async () => {
      await this.generateIngredientForecasts();
    });
    this.forecastJob.start();

    // Check for expiring ingredients daily
    const expiryCheckJob = new CronJob('0 8 * * *', async () => {
      await this.checkExpiringIngredients();
    });
    expiryCheckJob.start();
  }

  /**
   * Create or update ingredient
   */
  async upsertIngredient(
    merchantId: string,
    ingredient: Omit<Ingredient, 'id' | 'lastUpdated'>
  ): Promise<Ingredient> {
    try {
      const existingIngredient = await prisma.ingredient.findFirst({
        where: {
          merchantId,
          name: ingredient.name,
        },
      });

      if (existingIngredient) {
        // Update existing
        const updated = await prisma.ingredient.update({
          where: { id: existingIngredient.id },
          data: {
            ...ingredient,
            lastUpdated: new Date(),
          },
        });

        this.emit('ingredient:updated', {
          ingredientId: updated.id,
          merchantId,
        });

        return updated;
      } else {
        // Create new
        const created = await prisma.ingredient.create({
          data: {
            id: `ing_${Date.now()}`,
            ...ingredient,
            merchantId,
            lastUpdated: new Date(),
          },
        });

        this.emit('ingredient:created', {
          ingredientId: created.id,
          merchantId,
        });

        return created;
      }

    } catch (error) {
      logger.error('Failed to upsert ingredient', error);
      throw error;
    }
  }

  /**
   * Create or update recipe
   */
  async upsertRecipe(
    merchantId: string,
    recipe: Omit<Recipe, 'id' | 'lastUpdated' | 'costPerServing' | 'nutritionalInfo' | 'allergenInfo'>
  ): Promise<Recipe> {
    try {
      // Calculate cost per serving
      const costPerServing = await this.calculateRecipeCost(recipe.ingredients);

      // Calculate nutritional info
      const nutritionalInfo = await this.calculateNutritionalInfo(recipe.ingredients);

      // Determine allergens
      const allergenInfo = await this.determineAllergens(recipe.ingredients);

      const recipeData: Recipe = {
        id: `recipe_${Date.now()}`,
        ...recipe,
        merchantId,
        costPerServing,
        nutritionalInfo,
        allergenInfo,
        lastUpdated: new Date(),
      };

      // Save to database
      await prisma.recipe.create({
        data: recipeData,
      });

      // Update cache
      this.recipeCache.set(recipeData.id, recipeData);

      // Link to menu item
      await this.linkRecipeToMenuItem(recipeData.menuItemId, recipeData.id);

      this.emit('recipe:created', {
        recipeId: recipeData.id,
        merchantId,
        menuItemId: recipe.menuItemId,
      });

      return recipeData;

    } catch (error) {
      logger.error('Failed to create recipe', error);
      throw error;
    }
  }

  /**
   * Track ingredient usage for an order
   */
  async trackOrderIngredients(
    orderId: string,
    orderItems: Array<{
      menuItemId: string;
      quantity: number;
      customizations?: Array<{ id: string; selected: boolean }>;
    }>
  ): Promise<void> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { merchant: true },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      for (const item of orderItems) {
        // Get recipe for menu item
        const mapping = await prisma.menuItemIngredientMapping.findUnique({
          where: { menuItemId: item.menuItemId },
        });

        if (!mapping || !mapping.autoDeduct) continue;

        const recipe = this.recipeCache.get(mapping.recipeId);
        if (!recipe) continue;

        // Calculate ingredient quantities
        const ingredientUsages: IngredientUsage[] = [];

        for (const recipeIngredient of recipe.ingredients) {
          let quantity = recipeIngredient.quantity * item.quantity;

          // Adjust for customizations
          if (item.customizations && mapping.customizations) {
            for (const customization of item.customizations) {
              const customMapping = mapping.customizations.find(
                c => c.customizationId === customization.id
              );

              if (customMapping && customization.selected) {
                const adjustment = customMapping.ingredientAdjustments.find(
                  a => a.ingredientId === recipeIngredient.ingredientId
                );

                if (adjustment) {
                  quantity += adjustment.quantityChange * item.quantity;
                }
              }
            }
          }

          if (quantity > 0) {
            // Deduct from inventory
            await this.deductIngredient(
              recipeIngredient.ingredientId,
              quantity,
              'order',
              orderId
            );

            ingredientUsages.push({
              id: `usage_${Date.now()}`,
              ingredientId: recipeIngredient.ingredientId,
              recipeId: recipe.id,
              orderId,
              quantity,
              timestamp: new Date(),
              reason: 'order',
            });
          }
        }

        // Save usage records
        if (ingredientUsages.length > 0) {
          await prisma.ingredientUsage.createMany({
            data: ingredientUsages,
          });
        }
      }

      this.emit('ingredients:tracked', {
        orderId,
        merchantId: order.merchantId,
      });

    } catch (error) {
      logger.error('Failed to track order ingredients', error);
      throw error;
    }
  }

  /**
   * Add batch to inventory
   */
  async addBatch(
    ingredientId: string,
    batch: {
      batchNumber: string;
      quantity: number;
      expiryDate: Date;
      cost?: number;
    }
  ): Promise<BatchTracking> {
    try {
      const batchData: BatchTracking = {
        id: `batch_${Date.now()}`,
        ingredientId,
        batchNumber: batch.batchNumber,
        quantity: batch.quantity,
        receivedDate: new Date(),
        expiryDate: batch.expiryDate,
        status: 'active',
        remainingQuantity: batch.quantity,
        qualityChecks: [],
      };

      // Save to database
      await prisma.batchTracking.create({
        data: batchData,
      });

      // Update ingredient stock
      await prisma.ingredient.update({
        where: { id: ingredientId },
        data: {
          currentStock: { increment: batch.quantity },
        },
      });

      // Update batch cache
      if (!this.batchTracker.has(ingredientId)) {
        this.batchTracker.set(ingredientId, []);
      }
      this.batchTracker.get(ingredientId)!.push(batchData);

      // Create inventory movement record
      await inventoryManagementService.recordStockMovement({
        inventoryItemId: ingredientId,
        type: 'in',
        quantity: batch.quantity,
        reason: `Batch received: ${batch.batchNumber}`,
        reference: batchData.id,
        cost: batch.cost,
      });

      this.emit('batch:added', {
        batchId: batchData.id,
        ingredientId,
      });

      return batchData;

    } catch (error) {
      logger.error('Failed to add batch', error);
      throw error;
    }
  }

  /**
   * Record quality check
   */
  async recordQualityCheck(
    batchId: string,
    check: Omit<QualityCheck, 'id' | 'timestamp'>
  ): Promise<void> {
    try {
      const batch = await prisma.batchTracking.findUnique({
        where: { id: batchId },
      });

      if (!batch) {
        throw new Error('Batch not found');
      }

      const qualityCheck: QualityCheck = {
        id: `qc_${Date.now()}`,
        timestamp: new Date(),
        ...check,
      };

      // Update batch with quality check
      batch.qualityChecks.push(qualityCheck);

      await prisma.batchTracking.update({
        where: { id: batchId },
        data: {
          qualityChecks: batch.qualityChecks,
        },
      });

      // Handle failed quality checks
      if (check.status === 'fail') {
        await this.handleFailedQualityCheck(batch);
      }

    } catch (error) {
      logger.error('Failed to record quality check', error);
      throw error;
    }
  }

  /**
   * Get ingredient forecast
   */
  async getIngredientForecast(
    merchantId: string,
    days: number = 7
  ): Promise<IngredientForecast[]> {
    try {
      const startDate = new Date();
      const endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

      // Get merchant ingredients
      const ingredients = await prisma.ingredient.findMany({
        where: { merchantId },
      });

      const forecasts: IngredientForecast[] = [];

      for (const ingredient of ingredients) {
        // Get historical usage
        const historicalUsage = await this.getHistoricalUsage(
          ingredient.id,
          30 // Last 30 days
        );

        // Calculate average daily usage
        const avgDailyUsage = historicalUsage.reduce((sum, usage) => 
          sum + usage.quantity, 0
        ) / 30;

        // Project future usage
        const expectedUsage = avgDailyUsage * days;

        // Calculate days until stockout
        const availableStock = ingredient.currentStock - ingredient.reservedStock;
        const daysUntilStockout = avgDailyUsage > 0 ? 
          Math.floor(availableStock / avgDailyUsage) : 999;

        // Calculate recommended order quantity
        const recommendedOrderQuantity = this.calculateReorderQuantity(
          ingredient,
          avgDailyUsage,
          daysUntilStockout
        );

        // Calculate confidence based on usage variance
        const confidence = this.calculateForecastConfidence(historicalUsage);

        forecasts.push({
          ingredientId: ingredient.id,
          period: { start: startDate, end: endDate },
          expectedUsage,
          currentStock: ingredient.currentStock,
          daysUntilStockout,
          recommendedOrderQuantity,
          confidence,
        });
      }

      return forecasts;

    } catch (error) {
      logger.error('Failed to get ingredient forecast', error);
      throw error;
    }
  }

  /**
   * Get recipe suggestions based on available ingredients
   */
  async getRecipeSuggestions(merchantId: string): Promise<{
    canMakeNow: Recipe[];
    canMakeWithMinimalPurchase: Array<{
      recipe: Recipe;
      missingIngredients: Array<{
        ingredient: Ingredient;
        quantityNeeded: number;
      }>;
    }>;
    expiringSoonRecipes: Recipe[];
  }> {
    try {
      const [recipes, ingredients] = await Promise.all([
        prisma.recipe.findMany({ where: { merchantId } }),
        prisma.ingredient.findMany({ where: { merchantId } }),
      ]);

      const ingredientMap = new Map(ingredients.map(i => [i.id, i]));

      const canMakeNow: Recipe[] = [];
      const canMakeWithMinimalPurchase: Array<{
        recipe: Recipe;
        missingIngredients: Array<{
          ingredient: Ingredient;
          quantityNeeded: number;
        }>;
      }> = [];
      const expiringSoonRecipes: Recipe[] = [];

      // Check expiring ingredients
      const expiringIngredients = await this.getExpiringIngredients(merchantId, 3);

      for (const recipe of recipes) {
        const missingIngredients: Array<{
          ingredient: Ingredient;
          quantityNeeded: number;
        }> = [];

        let canMake = true;
        let usesExpiringIngredients = false;

        for (const recipeIngredient of recipe.ingredients) {
          const ingredient = ingredientMap.get(recipeIngredient.ingredientId);
          if (!ingredient) {
            canMake = false;
            continue;
          }

          const availableQuantity = ingredient.currentStock - ingredient.reservedStock;
          
          if (availableQuantity < recipeIngredient.quantity) {
            canMake = false;
            missingIngredients.push({
              ingredient,
              quantityNeeded: recipeIngredient.quantity - availableQuantity,
            });
          }

          // Check if uses expiring ingredients
          if (expiringIngredients.some(e => e.id === ingredient.id)) {
            usesExpiringIngredients = true;
          }
        }

        if (canMake) {
          canMakeNow.push(recipe);
          if (usesExpiringIngredients) {
            expiringSoonRecipes.push(recipe);
          }
        } else if (missingIngredients.length <= 3) {
          // Can make with minimal purchase (3 or fewer missing ingredients)
          canMakeWithMinimalPurchase.push({
            recipe,
            missingIngredients,
          });
        }
      }

      return {
        canMakeNow,
        canMakeWithMinimalPurchase,
        expiringSoonRecipes,
      };

    } catch (error) {
      logger.error('Failed to get recipe suggestions', error);
      throw error;
    }
  }

  /**
   * Generate ingredient report
   */
  async generateIngredientReport(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    summary: {
      totalIngredients: number;
      totalValue: number;
      lowStockItems: number;
      expiringItems: number;
      wasteValue: number;
    };
    topUsedIngredients: Array<{
      ingredient: Ingredient;
      totalUsed: number;
      totalCost: number;
      usageCount: number;
    }>;
    wastageReport: Array<{
      ingredient: Ingredient;
      wastedQuantity: number;
      wastedValue: number;
      reasons: Record<string, number>;
    }>;
    costAnalysis: {
      totalCost: number;
      byCategory: Record<string, number>;
      trend: Array<{ date: Date; cost: number }>;
    };
  }> {
    try {
      const ingredients = await prisma.ingredient.findMany({
        where: { merchantId },
      });

      // Get usage data
      const usageData = await prisma.ingredientUsage.findMany({
        where: {
          ingredientId: { in: ingredients.map(i => i.id) },
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      // Calculate summary
      const totalValue = ingredients.reduce((sum, ing) => 
        sum + (ing.currentStock * ing.cost), 0
      );

      const lowStockItems = ingredients.filter(ing => 
        ing.currentStock <= ing.minimumStock
      ).length;

      const expiringItems = await this.getExpiringIngredients(merchantId, 7);

      const wasteData = usageData.filter(u => 
        u.reason === 'waste' || u.reason === 'expired'
      );

      const wasteValue = wasteData.reduce((sum, waste) => {
        const ingredient = ingredients.find(i => i.id === waste.ingredientId);
        return sum + ((waste.quantity * (ingredient?.cost || 0)) + (waste.wastage || 0) * (ingredient?.cost || 0));
      }, 0);

      // Calculate top used ingredients
      const usageByIngredient = new Map<string, {
        totalUsed: number;
        totalCost: number;
        usageCount: number;
      }>();

      for (const usage of usageData) {
        const ingredient = ingredients.find(i => i.id === usage.ingredientId);
        if (!ingredient) continue;

        const existing = usageByIngredient.get(usage.ingredientId) || {
          totalUsed: 0,
          totalCost: 0,
          usageCount: 0,
        };

        existing.totalUsed += usage.quantity;
        existing.totalCost += usage.quantity * ingredient.cost;
        existing.usageCount += 1;

        usageByIngredient.set(usage.ingredientId, existing);
      }

      const topUsedIngredients = Array.from(usageByIngredient.entries())
        .map(([ingredientId, data]) => ({
          ingredient: ingredients.find(i => i.id === ingredientId)!,
          ...data,
        }))
        .sort((a, b) => b.totalCost - a.totalCost)
        .slice(0, 10);

      // Calculate wastage report
      const wastageByIngredient = new Map<string, {
        wastedQuantity: number;
        wastedValue: number;
        reasons: Record<string, number>;
      }>();

      for (const waste of wasteData) {
        const ingredient = ingredients.find(i => i.id === waste.ingredientId);
        if (!ingredient) continue;

        const existing = wastageByIngredient.get(waste.ingredientId) || {
          wastedQuantity: 0,
          wastedValue: 0,
          reasons: {},
        };

        existing.wastedQuantity += waste.quantity + (waste.wastage || 0);
        existing.wastedValue += (waste.quantity + (waste.wastage || 0)) * ingredient.cost;
        existing.reasons[waste.reason || 'unknown'] = 
          (existing.reasons[waste.reason || 'unknown'] || 0) + 1;

        wastageByIngredient.set(waste.ingredientId, existing);
      }

      const wastageReport = Array.from(wastageByIngredient.entries())
        .map(([ingredientId, data]) => ({
          ingredient: ingredients.find(i => i.id === ingredientId)!,
          ...data,
        }))
        .sort((a, b) => b.wastedValue - a.wastedValue);

      // Cost analysis
      const costByCategory: Record<string, number> = {};
      const dailyCosts: Map<string, number> = new Map();

      for (const usage of usageData) {
        const ingredient = ingredients.find(i => i.id === usage.ingredientId);
        if (!ingredient) continue;

        const cost = usage.quantity * ingredient.cost;
        costByCategory[ingredient.category] = 
          (costByCategory[ingredient.category] || 0) + cost;

        const dateKey = usage.timestamp.toISOString().split('T')[0];
        dailyCosts.set(dateKey, (dailyCosts.get(dateKey) || 0) + cost);
      }

      const trend = Array.from(dailyCosts.entries())
        .map(([date, cost]) => ({
          date: new Date(date),
          cost,
        }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      return {
        summary: {
          totalIngredients: ingredients.length,
          totalValue,
          lowStockItems,
          expiringItems: expiringItems.length,
          wasteValue,
        },
        topUsedIngredients,
        wastageReport,
        costAnalysis: {
          totalCost: usageData.reduce((sum, usage) => {
            const ingredient = ingredients.find(i => i.id === usage.ingredientId);
            return sum + (usage.quantity * (ingredient?.cost || 0));
          }, 0),
          byCategory: costByCategory,
          trend,
        },
      };

    } catch (error) {
      logger.error('Failed to generate ingredient report', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async loadRecipes(): Promise<void> {
    const recipes = await prisma.recipe.findMany();
    recipes.forEach(recipe => {
      this.recipeCache.set(recipe.id, recipe);
    });
  }

  private async calculateRecipeCost(ingredients: RecipeIngredient[]): Promise<number> {
    let totalCost = 0;

    for (const recipeIngredient of ingredients) {
      const ingredient = await prisma.ingredient.findUnique({
        where: { id: recipeIngredient.ingredientId },
      });

      if (ingredient) {
        totalCost += recipeIngredient.quantity * ingredient.cost;
      }
    }

    return totalCost;
  }

  private async calculateNutritionalInfo(
    ingredients: RecipeIngredient[]
  ): Promise<NutritionalInfo | undefined> {
    const totals: NutritionalInfo = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sodium: 0,
      sugar: 0,
    };

    let hasNutritionalData = false;

    for (const recipeIngredient of ingredients) {
      const ingredient = await prisma.ingredient.findUnique({
        where: { id: recipeIngredient.ingredientId },
      });

      if (ingredient?.nutritionalInfo) {
        hasNutritionalData = true;
        const ratio = recipeIngredient.quantity / 100; // Assuming nutritional info is per 100g

        totals.calories += ingredient.nutritionalInfo.calories * ratio;
        totals.protein += ingredient.nutritionalInfo.protein * ratio;
        totals.carbs += ingredient.nutritionalInfo.carbs * ratio;
        totals.fat += ingredient.nutritionalInfo.fat * ratio;
        totals.fiber += ingredient.nutritionalInfo.fiber * ratio;
        totals.sodium += ingredient.nutritionalInfo.sodium * ratio;
        totals.sugar += ingredient.nutritionalInfo.sugar * ratio;
      }
    }

    return hasNutritionalData ? totals : undefined;
  }

  private async determineAllergens(ingredients: RecipeIngredient[]): Promise<string[]> {
    const allergenSet = new Set<string>();

    for (const recipeIngredient of ingredients) {
      const ingredient = await prisma.ingredient.findUnique({
        where: { id: recipeIngredient.ingredientId },
      });

      if (ingredient?.allergens) {
        ingredient.allergens.forEach(allergen => allergenSet.add(allergen));
      }
    }

    return Array.from(allergenSet);
  }

  private async linkRecipeToMenuItem(menuItemId: string, recipeId: string): Promise<void> {
    await prisma.menuItemIngredientMapping.upsert({
      where: { menuItemId },
      create: {
        menuItemId,
        recipeId,
        autoDeduct: true,
        customizations: [],
      },
      update: {
        recipeId,
      },
    });
  }

  private async deductIngredient(
    ingredientId: string,
    quantity: number,
    reason: string,
    reference?: string
  ): Promise<void> {
    // Use FIFO to deduct from batches
    const batches = await prisma.batchTracking.findMany({
      where: {
        ingredientId,
        status: 'active',
        remainingQuantity: { gt: 0 },
      },
      orderBy: { receivedDate: 'asc' },
    });

    let remainingToDeduct = quantity;

    for (const batch of batches) {
      if (remainingToDeduct <= 0) break;

      const deductFromBatch = Math.min(batch.remainingQuantity, remainingToDeduct);
      
      await prisma.batchTracking.update({
        where: { id: batch.id },
        data: {
          remainingQuantity: { decrement: deductFromBatch },
          status: batch.remainingQuantity - deductFromBatch <= 0 ? 'depleted' : 'active',
        },
      });

      remainingToDeduct -= deductFromBatch;
    }

    // Update ingredient stock
    await prisma.ingredient.update({
      where: { id: ingredientId },
      data: {
        currentStock: { decrement: quantity },
      },
    });

    // Create inventory movement record
    await inventoryManagementService.recordStockMovement({
      inventoryItemId: ingredientId,
      type: 'out',
      quantity,
      reason,
      reference,
    });
  }

  private async getHistoricalUsage(
    ingredientId: string,
    days: number
  ): Promise<IngredientUsage[]> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return await prisma.ingredientUsage.findMany({
      where: {
        ingredientId,
        timestamp: { gte: startDate },
        reason: 'order',
      },
    });
  }

  private calculateReorderQuantity(
    ingredient: Ingredient,
    avgDailyUsage: number,
    daysUntilStockout: number
  ): number {
    // Lead time in days (simplified - would come from supplier data)
    const leadTime = 3;

    // Safety stock (simplified - would use more complex calculation)
    const safetyStock = avgDailyUsage * 2;

    // Reorder point
    const reorderPoint = (avgDailyUsage * leadTime) + safetyStock;

    // If we're below reorder point, calculate order quantity
    if (ingredient.currentStock <= reorderPoint) {
      // Order enough for 2 weeks plus safety stock
      const orderQuantity = (avgDailyUsage * 14) + safetyStock - ingredient.currentStock;
      return Math.max(0, Math.ceil(orderQuantity));
    }

    return 0;
  }

  private calculateForecastConfidence(historicalUsage: IngredientUsage[]): number {
    if (historicalUsage.length < 7) return 0.5; // Low confidence with little data

    // Calculate coefficient of variation
    const quantities = historicalUsage.map(u => u.quantity);
    const mean = quantities.reduce((sum, q) => sum + q, 0) / quantities.length;
    
    if (mean === 0) return 0.5;

    const variance = quantities.reduce((sum, q) => 
      sum + Math.pow(q - mean, 2), 0
    ) / quantities.length;
    
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    // Lower CV means higher confidence
    return Math.max(0.3, Math.min(0.95, 1 - cv));
  }

  private async generateIngredientForecasts(): Promise<void> {
    try {
      const merchants = await prisma.merchant.findMany({
        where: { isActive: true },
      });

      for (const merchant of merchants) {
        const forecasts = await this.getIngredientForecast(merchant.id, 7);

        // Alert on low stock predictions
        const criticalForecasts = forecasts.filter(f => 
          f.daysUntilStockout <= 3 && f.confidence > 0.7
        );

        if (criticalForecasts.length > 0) {
          await notificationService.sendMerchantNotification(
            merchant.id,
            'Low Stock Alert',
            `${criticalForecasts.length} ingredients predicted to run out within 3 days`,
            {
              type: 'ingredient_forecast_alert',
              forecasts: criticalForecasts,
            }
          );
        }
      }

    } catch (error) {
      logger.error('Failed to generate ingredient forecasts', error);
    }
  }

  private async checkExpiringIngredients(): Promise<void> {
    try {
      const merchants = await prisma.merchant.findMany({
        where: { isActive: true },
      });

      for (const merchant of merchants) {
        const expiringIngredients = await this.getExpiringIngredients(merchant.id, 3);

        if (expiringIngredients.length > 0) {
          // Get recipe suggestions for expiring ingredients
          const suggestions = await this.getRecipeSuggestions(merchant.id);

          await notificationService.sendMerchantNotification(
            merchant.id,
            'Expiring Ingredients Alert',
            `${expiringIngredients.length} ingredients expiring in next 3 days. ${suggestions.expiringSoonRecipes.length} recipes can help use them.`,
            {
              type: 'expiring_ingredients_alert',
              ingredients: expiringIngredients,
              suggestedRecipes: suggestions.expiringSoonRecipes,
            }
          );
        }
      }

    } catch (error) {
      logger.error('Failed to check expiring ingredients', error);
    }
  }

  private async getExpiringIngredients(
    merchantId: string,
    days: number
  ): Promise<Ingredient[]> {
    const expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const expiringBatches = await prisma.batchTracking.findMany({
      where: {
        ingredient: { merchantId },
        expiryDate: { lte: expiryDate },
        status: 'active',
        remainingQuantity: { gt: 0 },
      },
      include: { ingredient: true },
    });

    const uniqueIngredients = new Map<string, Ingredient>();
    expiringBatches.forEach(batch => {
      uniqueIngredients.set(batch.ingredientId, batch.ingredient);
    });

    return Array.from(uniqueIngredients.values());
  }

  private async handleFailedQualityCheck(batch: BatchTracking): Promise<void> {
    // Mark batch as recalled
    await prisma.batchTracking.update({
      where: { id: batch.id },
      data: { status: 'recalled' },
    });

    // Update ingredient stock
    await prisma.ingredient.update({
      where: { id: batch.ingredientId },
      data: {
        currentStock: { decrement: batch.remainingQuantity },
      },
    });

    // Notify merchant
    const ingredient = await prisma.ingredient.findUnique({
      where: { id: batch.ingredientId },
    });

    if (ingredient) {
      await notificationService.sendMerchantNotification(
        ingredient.merchantId,
        'Quality Check Failed',
        `Batch ${batch.batchNumber} of ${ingredient.name} failed quality check and has been recalled`,
        {
          type: 'quality_check_failed',
          batchId: batch.id,
          ingredientId: ingredient.id,
        }
      );
    }
  }
}

// Export singleton instance
export const ingredientTrackingService = new IngredientTrackingService();