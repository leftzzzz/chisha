/**
 * LLM 测试
 *
 * 测试 fallbackParse 函数的需求解析逻辑
 */

import { fallbackParse } from '@/lib/llm';

describe('fallbackParse', () => {
  describe('subcategory keywords', () => {
    it('should detect subcategory keywords and set empty cuisineTypes', () => {
      const result = fallbackParse('我想喝奶茶');

      expect(result.keywords).toContain('奶茶');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should detect multiple subcategory keywords', () => {
      const result = fallbackParse('想要咖啡和披萨');

      expect(result.keywords).toContain('咖啡');
      expect(result.keywords).toContain('披萨');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should detect 寿司 as subcategory', () => {
      const result = fallbackParse('附近有寿司吗');

      expect(result.keywords).toContain('寿司');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should detect 汉堡 as subcategory', () => {
      const result = fallbackParse('我要吃汉堡');

      expect(result.keywords).toContain('汉堡');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should detect 蛋糕 as subcategory', () => {
      const result = fallbackParse('买个蛋糕');

      expect(result.keywords).toContain('蛋糕');
      expect(result.cuisineTypes).toEqual([]);
    });
  });

  describe('taste preference expansion', () => {
    it('should expand "清淡" to specific keywords', () => {
      const result = fallbackParse('我想吃清淡的');

      expect(result.keywords).toContain('粤菜');
      expect(result.keywords).toContain('江浙菜');
      expect(result.keywords).toContain('日料');
      expect(result.keywords).toContain('轻食');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should expand "辣" to specific keywords', () => {
      const result = fallbackParse('想吃辣的');

      expect(result.keywords).toContain('川菜');
      expect(result.keywords).toContain('湘菜');
      expect(result.keywords).toContain('火锅');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should expand "健康" to specific keywords', () => {
      const result = fallbackParse('健康养生的餐厅');

      expect(result.keywords).toContain('轻食');
      expect(result.keywords).toContain('沙拉');
      expect(result.keywords).toContain('素食');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should expand "快" to fast food keywords', () => {
      const result = fallbackParse('赶时间，要快的');

      expect(result.keywords).toContain('快餐');
      expect(result.keywords).toContain('面馆');
      expect(result.keywords).toContain('简餐');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should expand "甜" to dessert keywords', () => {
      const result = fallbackParse('想吃甜的');

      expect(result.keywords).toContain('甜品');
      expect(result.keywords).toContain('蛋糕');
      expect(result.keywords).toContain('烘焙');
      expect(result.cuisineTypes).toEqual([]);
    });
  });

  describe('major cuisine detection', () => {
    it('should detect 川菜 and set cuisineTypes', () => {
      const result = fallbackParse('我想吃川菜');

      expect(result.keywords).toContain('川菜');
      expect(result.cuisineTypes).toContain('川菜');
    });

    it('should detect 火锅 and set cuisineTypes', () => {
      const result = fallbackParse('去吃火锅');

      expect(result.keywords).toContain('火锅');
      expect(result.cuisineTypes).toContain('火锅');
    });

    it('should detect 日料 and set cuisineTypes', () => {
      const result = fallbackParse('日本料理');

      expect(result.keywords).toContain('日本料理');
      expect(result.cuisineTypes).toContain('日料');
    });

    it('should detect 烧烤 and set cuisineTypes', () => {
      const result = fallbackParse('吃烧烤');

      expect(result.keywords).toContain('烧烤');
      expect(result.cuisineTypes).toContain('烧烤');
    });

    it('should detect 西餐 and set cuisineTypes', () => {
      const result = fallbackParse('吃牛排西餐');

      expect(result.keywords).toContain('牛排');
      expect(result.cuisineTypes).toContain('西餐');
    });
  });

  describe('price range extraction', () => {
    it('should set max price for "便宜"', () => {
      const result = fallbackParse('便宜的餐厅');

      expect(result.priceRange).toEqual({ max: 50 });
    });

    it('should set max price for "实惠"', () => {
      const result = fallbackParse('实惠点的地方');

      expect(result.priceRange).toEqual({ max: 50 });
    });

    it('should set max price for "经济"', () => {
      const result = fallbackParse('经济实惠');

      expect(result.priceRange).toEqual({ max: 50 });
    });

    it('should set min price for "高档"', () => {
      const result = fallbackParse('高档餐厅');

      expect(result.priceRange).toEqual({ min: 80 });
    });

    it('should set min price for "贵"', () => {
      const result = fallbackParse('贵一点的');

      expect(result.priceRange).toEqual({ min: 80 });
    });

    it('should set min price for "奢侈"', () => {
      const result = fallbackParse('奢侈的地方');

      expect(result.priceRange).toEqual({ min: 80 });
    });

    it('should not set price range when no price keywords', () => {
      const result = fallbackParse('附近的餐厅');

      expect(result.priceRange).toBeUndefined();
    });
  });

  describe('search radius extraction', () => {
    it('should set 1000m for "附近"', () => {
      const result = fallbackParse('附近的餐厅');

      expect(result.searchRadius).toBe(1000);
    });

    it('should set 1000m for "很近"', () => {
      const result = fallbackParse('很近的地方');

      expect(result.searchRadius).toBe(1000);
    });

    it('should set 5000m for "远"', () => {
      const result = fallbackParse('远一点的');

      expect(result.searchRadius).toBe(5000);
    });

    it('should set 5000m for "远一点"', () => {
      const result = fallbackParse('远一点的餐厅');

      expect(result.searchRadius).toBe(5000);
    });

    it('should default to 2000m', () => {
      const result = fallbackParse('川菜餐厅');

      expect(result.searchRadius).toBe(2000);
    });
  });

  describe('fallback to original query', () => {
    it('should use original query when no patterns match', () => {
      const result = fallbackParse('xyz unknown restaurant');

      expect(result.keywords).toContain('xyz unknown restaurant');
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should trim whitespace in fallback', () => {
      const result = fallbackParse('   test   ');

      expect(result.keywords).toContain('test');
    });
  });

  describe('complex queries', () => {
    it('should handle multiple taste preferences', () => {
      const result = fallbackParse('清淡不油腻的');

      expect(result.keywords.length).toBeGreaterThan(0);
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should combine cuisine and price', () => {
      const result = fallbackParse('便宜的火锅');

      expect(result.keywords).toContain('火锅');
      expect(result.cuisineTypes).toContain('火锅');
      expect(result.priceRange).toEqual({ max: 50 });
    });

    it('should combine subcategory, distance and price', () => {
      const result = fallbackParse('附近便宜的咖啡店');

      expect(result.keywords).toContain('咖啡');
      expect(result.cuisineTypes).toEqual([]);
      expect(result.searchRadius).toBe(1000);
      expect(result.priceRange).toEqual({ max: 50 });
    });

    it('should handle taste preference with distance', () => {
      const result = fallbackParse('附近清淡的餐厅');

      expect(result.keywords).toContain('粤菜');
      expect(result.searchRadius).toBe(1000);
      expect(result.cuisineTypes).toEqual([]);
    });

    it('should handle empty input', () => {
      const result = fallbackParse('');

      expect(result.keywords).toContain('');
      expect(result.searchRadius).toBe(2000);
    });
  });
});
