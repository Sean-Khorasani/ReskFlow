import { prisma, logger } from '@reskflow/shared';

interface DietaryFilter {
  id: string;
  name: string;
  description: string;
  icon: string;
  incompatibleWith?: string[];
  requiresAll?: string[];
}

interface Allergen {
  id: string;
  name: string;
  description: string;
  severity: 'mild' | 'moderate' | 'severe';
  commonSources: string[];
}

interface DietaryAnalysis {
  itemId: string;
  compatible: boolean;
  dietaryTags: string[];
  allergens: string[];
  warnings: string[];
  alternatives?: Array<{
    itemId: string;
    name: string;
    reason: string;
  }>;
}

export class DietaryFilterService {
  private dietaryFilters: Map<string, DietaryFilter>;
  private allergens: Map<string, Allergen>;

  constructor() {
    this.dietaryFilters = new Map();
    this.allergens = new Map();
    this.initializeFilters();
    this.initializeAllergens();
  }

  private initializeFilters(): void {
    const filters: DietaryFilter[] = [
      {
        id: 'vegetarian',
        name: 'Vegetarian',
        description: 'No meat or fish',
        icon: '🥗',
        incompatibleWith: ['meat', 'poultry', 'fish', 'seafood'],
      },
      {
        id: 'vegan',
        name: 'Vegan',
        description: 'No animal products',
        icon: '🌱',
        incompatibleWith: ['meat', 'poultry', 'fish', 'seafood', 'dairy', 'eggs', 'honey'],
        requiresAll: ['plant-based'],
      },
      {
        id: 'gluten-free',
        name: 'Gluten Free',
        description: 'No wheat, barley, or rye',
        icon: '🌾',
        incompatibleWith: ['wheat', 'barley', 'rye', 'gluten'],
      },
      {
        id: 'dairy-free',
        name: 'Dairy Free',
        description: 'No milk products',
        icon: '🥛',
        incompatibleWith: ['milk', 'cheese', 'butter', 'cream', 'yogurt', 'dairy'],
      },
      {
        id: 'keto',
        name: 'Keto',
        description: 'Low carb, high fat',
        icon: '🥑',
        requiresAll: ['low-carb', 'high-fat'],
        incompatibleWith: ['high-carb', 'sugar', 'grains'],
      },
      {
        id: 'paleo',
        name: 'Paleo',
        description: 'No processed foods, grains, or dairy',
        icon: '🍖',
        incompatibleWith: ['grains', 'dairy', 'processed', 'legumes', 'sugar'],
      },
      {
        id: 'halal',
        name: 'Halal',
        description: 'Prepared according to Islamic law',
        icon: '☪️',
        incompatibleWith: ['pork', 'alcohol', 'non-halal-meat'],
        requiresAll: ['halal-certified'],
      },
      {
        id: 'kosher',
        name: 'Kosher',
        description: 'Prepared according to Jewish law',
        icon: '✡️',
        incompatibleWith: ['pork', 'shellfish', 'meat-dairy-mix'],
        requiresAll: ['kosher-certified'],
      },
      {
        id: 'low-sodium',
        name: 'Low Sodium',
        description: 'Reduced salt content',
        icon: '🧂',
        requiresAll: ['low-sodium'],
      },
      {
        id: 'sugar-free',
        name: 'Sugar Free',
        description: 'No added sugars',
        icon: '🍬',
        incompatibleWith: ['sugar', 'honey', 'syrup'],
      },
      {
        id: 'nut-free',
        name: 'Nut Free',
        description: 'No tree nuts or peanuts',
        icon: '🥜',
        incompatibleWith: ['nuts', 'peanuts', 'tree-nuts'],
      },
      {
        id: 'soy-free',
        name: 'Soy Free',
        description: 'No soy products',
        icon: '🌱',
        incompatibleWith: ['soy', 'tofu', 'soy-sauce', 'edamame'],
      },
    ];

    filters.forEach(filter => this.dietaryFilters.set(filter.id, filter));
  }

  private initializeAllergens(): void {
    const allergenList: Allergen[] = [
      {
        id: 'milk',
        name: 'Milk',
        description: 'Dairy products',
        severity: 'moderate',
        commonSources: ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'ice cream'],
      },
      {
        id: 'eggs',
        name: 'Eggs',
        description: 'Chicken eggs and egg products',
        severity: 'moderate',
        commonSources: ['eggs', 'mayonnaise', 'meringue', 'baked goods'],
      },
      {
        id: 'fish',
        name: 'Fish',
        description: 'All types of fish',
        severity: 'severe',
        commonSources: ['salmon', 'tuna', 'cod', 'fish sauce', 'worcestershire'],
      },
      {
        id: 'shellfish',
        name: 'Shellfish',
        description: 'Crustaceans and mollusks',
        severity: 'severe',
        commonSources: ['shrimp', 'crab', 'lobster', 'oysters', 'clams', 'mussels'],
      },
      {
        id: 'tree-nuts',
        name: 'Tree Nuts',
        description: 'All tree nuts',
        severity: 'severe',
        commonSources: ['almonds', 'cashews', 'pecans', 'walnuts', 'pistachios'],
      },
      {
        id: 'peanuts',
        name: 'Peanuts',
        description: 'Peanuts and peanut products',
        severity: 'severe',
        commonSources: ['peanuts', 'peanut butter', 'peanut oil'],
      },
      {
        id: 'wheat',
        name: 'Wheat',
        description: 'Wheat and wheat products',
        severity: 'moderate',
        commonSources: ['bread', 'pasta', 'flour', 'cereal', 'crackers'],
      },
      {
        id: 'soy',
        name: 'Soy',
        description: 'Soybeans and soy products',
        severity: 'moderate',
        commonSources: ['soy sauce', 'tofu', 'edamame', 'soy milk', 'tempeh'],
      },
      {
        id: 'sesame',
        name: 'Sesame',
        description: 'Sesame seeds and oil',
        severity: 'moderate',
        commonSources: ['sesame seeds', 'sesame oil', 'tahini', 'hummus'],
      },
    ];

    allergenList.forEach(allergen => this.allergens.set(allergen.id, allergen));
  }

  async getAvailableFilters(): Promise<DietaryFilter[]> {
    return Array.from(this.dietaryFilters.values());
  }

  async getAllergens(): Promise<Allergen[]> {
    return Array.from(this.allergens.values());
  }

  async checkCompatibility(
    itemTags: string[],
    userRequirements: string[]
  ): Promise<boolean> {
    for (const requirement of userRequirements) {
      const filter = this.dietaryFilters.get(requirement);
      if (!filter) continue;

      // Check incompatible ingredients
      if (filter.incompatibleWith) {
        const hasIncompatible = filter.incompatibleWith.some(incompatible =>
          itemTags.some(tag => tag.toLowerCase().includes(incompatible))
        );
        if (hasIncompatible) return false;
      }

      // Check required tags
      if (filter.requiresAll) {
        const hasAllRequired = filter.requiresAll.every(required =>
          itemTags.some(tag => tag.toLowerCase().includes(required))
        );
        if (!hasAllRequired) return false;
      }
    }

    return true;
  }

  async checkAllergens(
    itemAllergens: string[],
    userAllergens: string[]
  ): Promise<boolean> {
    // Returns true if item contains any of the user's allergens
    return userAllergens.some(allergen =>
      itemAllergens.some(itemAllergen => 
        itemAllergen.toLowerCase().includes(allergen.toLowerCase())
      )
    );
  }

  async analyzeItemCompatibility(
    itemId: string,
    userId: string
  ): Promise<DietaryAnalysis> {
    // Get item details
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        dietary_info: true,
        ingredients: true,
      },
    });

    if (!item) {
      throw new Error('Item not found');
    }

    // Get user preferences
    const userPrefs = await prisma.userPreferences.findUnique({
      where: { user_id: userId },
    });

    const warnings: string[] = [];
    let compatible = true;

    // Check dietary compatibility
    if (userPrefs?.dietary_restrictions) {
      const isCompatible = await this.checkCompatibility(
        item.dietary_info?.tags || [],
        userPrefs.dietary_restrictions
      );
      
      if (!isCompatible) {
        compatible = false;
        warnings.push('Item contains ingredients incompatible with your dietary restrictions');
      }
    }

    // Check allergens
    if (userPrefs?.allergens) {
      const hasAllergens = await this.checkAllergens(
        item.dietary_info?.allergens || [],
        userPrefs.allergens
      );
      
      if (hasAllergens) {
        compatible = false;
        const foundAllergens = userPrefs.allergens.filter(allergen =>
          item.dietary_info?.allergens.some(a => 
            a.toLowerCase().includes(allergen.toLowerCase())
          )
        );
        warnings.push(`Contains allergens: ${foundAllergens.join(', ')}`);
      }
    }

    // Find alternatives if not compatible
    let alternatives;
    if (!compatible) {
      alternatives = await this.findAlternatives(item, userPrefs);
    }

    return {
      itemId,
      compatible,
      dietaryTags: item.dietary_info?.tags || [],
      allergens: item.dietary_info?.allergens || [],
      warnings,
      alternatives,
    };
  }

  async filterItemsByDietary(
    items: any[],
    requirements: {
      dietary?: string[];
      allergens?: string[];
    }
  ): Promise<any[]> {
    const filteredItems = [];

    for (const item of items) {
      let include = true;

      // Check dietary requirements
      if (requirements.dietary && requirements.dietary.length > 0) {
        const compatible = await this.checkCompatibility(
          item.dietary_tags || [],
          requirements.dietary
        );
        if (!compatible) include = false;
      }

      // Check allergens
      if (include && requirements.allergens && requirements.allergens.length > 0) {
        const hasAllergens = await this.checkAllergens(
          item.allergens || [],
          requirements.allergens
        );
        if (hasAllergens) include = false;
      }

      if (include) {
        filteredItems.push(item);
      }
    }

    return filteredItems;
  }

  async getDietaryBreakdown(itemId: string): Promise<{
    nutritionInfo?: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
      fiber: number;
      sodium: number;
    };
    dietaryBadges: string[];
    healthScore: number;
    warnings: string[];
  }> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        dietary_info: true,
        nutrition_info: true,
      },
    });

    if (!item) {
      throw new Error('Item not found');
    }

    const dietaryBadges: string[] = [];
    const warnings: string[] = [];
    let healthScore = 50; // Base score

    // Check dietary badges
    const itemTags = item.dietary_info?.tags || [];
    
    for (const [filterId, filter] of this.dietaryFilters) {
      if (filter.requiresAll) {
        const hasAll = filter.requiresAll.every(req =>
          itemTags.some(tag => tag.includes(req))
        );
        if (hasAll) dietaryBadges.push(filter.name);
      } else if (filter.incompatibleWith) {
        const hasNone = !filter.incompatibleWith.some(inc =>
          itemTags.some(tag => tag.includes(inc))
        );
        if (hasNone && itemTags.includes(filterId)) {
          dietaryBadges.push(filter.name);
        }
      }
    }

    // Calculate health score based on nutrition
    if (item.nutrition_info) {
      const nutrition = item.nutrition_info;
      
      // Positive factors
      if (nutrition.protein > 20) healthScore += 10;
      if (nutrition.fiber > 5) healthScore += 10;
      
      // Negative factors
      if (nutrition.calories > 800) healthScore -= 10;
      if (nutrition.sodium > 1000) {
        healthScore -= 15;
        warnings.push('High sodium content');
      }
      if (nutrition.saturated_fat > 10) {
        healthScore -= 10;
        warnings.push('High saturated fat');
      }
    }

    // Bonus for special diets
    if (dietaryBadges.includes('Vegan')) healthScore += 10;
    if (dietaryBadges.includes('Gluten Free')) healthScore += 5;

    return {
      nutritionInfo: item.nutrition_info ? {
        calories: item.nutrition_info.calories,
        protein: item.nutrition_info.protein,
        carbs: item.nutrition_info.carbohydrates,
        fat: item.nutrition_info.total_fat,
        fiber: item.nutrition_info.fiber,
        sodium: item.nutrition_info.sodium,
      } : undefined,
      dietaryBadges,
      healthScore: Math.max(0, Math.min(100, healthScore)),
      warnings,
    };
  }

  async suggestModifications(
    itemId: string,
    targetDietary: string[]
  ): Promise<{
    modifications: Array<{
      ingredient: string;
      action: 'remove' | 'replace';
      replacement?: string;
      reason: string;
    }>;
    feasible: boolean;
  }> {
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        ingredients: true,
      },
    });

    if (!item) {
      throw new Error('Item not found');
    }

    const modifications: any[] = [];
    let feasible = true;

    for (const dietary of targetDietary) {
      const filter = this.dietaryFilters.get(dietary);
      if (!filter) continue;

      // Check each ingredient
      for (const ingredient of item.ingredients || []) {
        if (filter.incompatibleWith) {
          const isIncompatible = filter.incompatibleWith.some(inc =>
            ingredient.name.toLowerCase().includes(inc)
          );

          if (isIncompatible) {
            const replacement = this.suggestReplacement(ingredient.name, dietary);
            
            modifications.push({
              ingredient: ingredient.name,
              action: replacement ? 'replace' : 'remove',
              replacement,
              reason: `Not compatible with ${filter.name} diet`,
            });

            // Check if modification makes item unfeasible
            if (!replacement && ingredient.is_essential) {
              feasible = false;
            }
          }
        }
      }
    }

    return { modifications, feasible };
  }

  private async findAlternatives(
    item: any,
    userPrefs: any
  ): Promise<any[]> {
    // Find similar items that match user's dietary requirements
    const alternatives = await prisma.item.findMany({
      where: {
        merchant_id: item.merchant_id,
        category: item.category,
        id: { not: item.id },
        is_available: true,
      },
      include: {
        dietary_info: true,
      },
      take: 3,
    });

    const compatibleAlternatives = [];

    for (const alt of alternatives) {
      const compatible = await this.checkCompatibility(
        alt.dietary_info?.tags || [],
        userPrefs.dietary_restrictions || []
      );

      const hasAllergens = await this.checkAllergens(
        alt.dietary_info?.allergens || [],
        userPrefs.allergens || []
      );

      if (compatible && !hasAllergens) {
        compatibleAlternatives.push({
          itemId: alt.id,
          name: alt.name,
          reason: 'Matches your dietary preferences',
        });
      }
    }

    return compatibleAlternatives;
  }

  private suggestReplacement(ingredient: string, dietary: string): string | null {
    const replacements: Record<string, Record<string, string>> = {
      vegan: {
        'milk': 'oat milk',
        'butter': 'vegan butter',
        'cheese': 'cashew cheese',
        'eggs': 'flax eggs',
        'honey': 'maple syrup',
        'meat': 'plant-based protein',
      },
      'gluten-free': {
        'flour': 'almond flour',
        'bread': 'gluten-free bread',
        'pasta': 'rice noodles',
        'soy sauce': 'tamari',
      },
      'dairy-free': {
        'milk': 'almond milk',
        'cheese': 'nutritional yeast',
        'butter': 'olive oil',
        'cream': 'coconut cream',
      },
    };

    const dietaryReplacements = replacements[dietary];
    if (!dietaryReplacements) return null;

    for (const [original, replacement] of Object.entries(dietaryReplacements)) {
      if (ingredient.toLowerCase().includes(original)) {
        return replacement;
      }
    }

    return null;
  }
}