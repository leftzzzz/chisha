/**
 * Zod 验证 Schemas
 * 用于 API 参数验证
 */

import { z } from 'zod';

// Location Schema
export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90).describe('纬度'),
  lng: z.number().min(-180).max(180).describe('经度'),
  address: z.union([z.string(), z.array(z.string())]).optional().transform((val) => {
    // 如果 address 是数组，取第一个元素
    if (Array.isArray(val)) {
      return val.length > 0 ? val[0] : undefined;
    }
    return val;
  }).describe('地址描述'),
});

// ParsedRequirement Schema
export const ParsedRequirementSchema = z.object({
  keywords: z.array(z.string()).min(1).describe('搜索关键词'),
  cuisineTypes: z.array(z.string()).describe('菜系类型'),
  priceRange: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
  searchRadius: z.number().min(100).max(50000).default(2000).describe('搜索半径（米）'),
  poiType: z.string().optional().describe('高德 POI 类型代码'),
});

// UnderstandRequest Schema
export const UnderstandRequestSchema = z.object({
  query: z.string().min(1).max(500).describe('用户需求描述'),
  location: LocationSchema.optional().describe('用户位置'),
});

// SearchRequest Schema
export const SearchRequestSchema = z.object({
  keywords: z.array(z.string()).min(1).describe('搜索关键词'),
  location: LocationSchema.describe('搜索中心点'),
  distance: z.number().min(100).max(50000).optional().default(2000).describe('搜索半径（米）'),
  cuisineTypes: z.array(z.string()).optional().describe('菜系过滤'),
  priceRange: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
  count: z.number().min(1).max(50).optional().default(8).describe('返回数量'),
  poiType: z.string().optional().describe('高德 POI 类型代码'),
});

// GeocodeRequest Schema
export const GeocodeRequestSchema = z.object({
  address: z.string().min(1).max(200).describe('地址'),
  city: z.string().optional().describe('城市'),
});

// ReverseGeocodeRequest Schema
export const ReverseGeocodeRequestSchema = z.object({
  location: LocationSchema.describe('地理位置'),
});
