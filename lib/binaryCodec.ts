/**
 * 二进制编解码器
 *
 * Protobuf 风格的紧凑二进制格式，配合 fflate 压缩实现极致压缩
 *
 * 格式设计：
 * - Varint 编码长度和小整数
 * - 坐标用 int32 存储 (× 1000000)
 * - 评分用 uint8 存储 (× 10)
 * - 距离用 uint16 存储 (米)
 */

import { deflateSync, inflateSync } from 'fflate';
import { Restaurant, CustomOption } from '@/types';

// 版本号
const BINARY_VERSION = 1;

// Source 映射
const SOURCE_TO_NUM: Record<string, number> = { 'amap': 1, 'osm': 2 };
const NUM_TO_SOURCE: Record<number, 'amap' | 'osm'> = { 1: 'amap', 2: 'osm' };

// ==================== 二进制写入工具 ====================

class BinaryWriter {
  private buffer: number[] = [];

  // 写入单字节
  writeUint8(value: number): void {
    this.buffer.push(value & 0xFF);
  }

  // 写入双字节 (小端序)
  writeUint16(value: number): void {
    this.buffer.push(value & 0xFF);
    this.buffer.push((value >> 8) & 0xFF);
  }

  // 写入四字节有符号整数 (小端序)
  writeInt32(value: number): void {
    this.buffer.push(value & 0xFF);
    this.buffer.push((value >> 8) & 0xFF);
    this.buffer.push((value >> 16) & 0xFF);
    this.buffer.push((value >> 24) & 0xFF);
  }

  // 写入 Varint (变长整数，支持 0-16383)
  writeVarint(value: number): void {
    if (value < 128) {
      this.buffer.push(value);
    } else if (value < 16384) {
      this.buffer.push((value & 0x7F) | 0x80);
      this.buffer.push((value >> 7) & 0x7F);
    } else {
      // 超大值，用 3 字节
      this.buffer.push((value & 0x7F) | 0x80);
      this.buffer.push(((value >> 7) & 0x7F) | 0x80);
      this.buffer.push((value >> 14) & 0x7F);
    }
  }

  // 写入字符串 (Varint长度 + UTF8内容)
  writeString(str: string): void {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    this.writeVarint(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      this.buffer.push(bytes[i]);
    }
  }

  // 获取结果
  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

// ==================== 二进制读取工具 ====================

class BinaryReader {
  private data: Uint8Array;
  private pos: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  // 读取单字节
  readUint8(): number {
    return this.data[this.pos++];
  }

  // 读取双字节 (小端序)
  readUint16(): number {
    const low = this.data[this.pos++];
    const high = this.data[this.pos++];
    return low | (high << 8);
  }

  // 读取四字节有符号整数 (小端序)
  readInt32(): number {
    const b0 = this.data[this.pos++];
    const b1 = this.data[this.pos++];
    const b2 = this.data[this.pos++];
    const b3 = this.data[this.pos++];
    const value = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    return value;
  }

  // 读取 Varint
  readVarint(): number {
    let value = 0;
    let shift = 0;
    while (true) {
      const byte = this.data[this.pos++];
      value |= (byte & 0x7F) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return value;
  }

  // 读取字符串
  readString(): string {
    const length = this.readVarint();
    const bytes = this.data.slice(this.pos, this.pos + length);
    this.pos += length;
    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  }

  // 是否还有数据
  hasMore(): boolean {
    return this.pos < this.data.length;
  }
}

// ==================== 序列化 ====================

export interface ShareData {
  query: string;
  restaurants: Restaurant[];
  customOptions: CustomOption[];
}

/**
 * 将分享数据序列化为二进制
 */
function serializeToBinary(data: ShareData): Uint8Array {
  const writer = new BinaryWriter();

  // 版本号
  writer.writeUint8(BINARY_VERSION);

  // Query
  writer.writeString(data.query);

  // 餐厅数量
  writer.writeVarint(data.restaurants.length);

  // 餐厅数据
  for (const r of data.restaurants) {
    writer.writeString(r.name);
    writer.writeString(r.cuisineType);
    writer.writeString(r.address);

    // 坐标 (× 1000000 转为整数)
    writer.writeInt32(Math.round(r.location.lat * 1000000));
    writer.writeInt32(Math.round(r.location.lng * 1000000));

    // 距离 (米，最大65535)
    writer.writeUint16(Math.min(r.distance ?? 0, 65535));

    // 评分 (× 10，如 4.7 存为 47)
    writer.writeUint8(Math.round((r.rating ?? 0) * 10));

    // ID
    writer.writeString(r.id);

    // Source
    writer.writeUint8(SOURCE_TO_NUM[r.source] || 1);
  }

  // 自定义选项数量
  writer.writeVarint(data.customOptions.length);

  // 自定义选项数据
  for (const c of data.customOptions) {
    writer.writeString(c.id);
    writer.writeString(c.name);
  }

  return writer.toUint8Array();
}

/**
 * 从二进制反序列化为分享数据
 */
function deserializeFromBinary(binary: Uint8Array): ShareData | null {
  try {
    const reader = new BinaryReader(binary);

    // 版本号
    const version = reader.readUint8();
    if (version !== BINARY_VERSION) {
      console.error('Unsupported binary version:', version);
      return null;
    }

    // Query
    const query = reader.readString();

    // 餐厅
    const restaurantCount = reader.readVarint();
    const restaurants: Restaurant[] = [];

    for (let i = 0; i < restaurantCount; i++) {
      const name = reader.readString();
      const cuisineType = reader.readString();
      const address = reader.readString();
      const lat = reader.readInt32() / 1000000;
      const lng = reader.readInt32() / 1000000;
      const distance = reader.readUint16();
      const rating = reader.readUint8() / 10;
      const id = reader.readString();
      const source = NUM_TO_SOURCE[reader.readUint8()] || 'amap';

      restaurants.push({
        name,
        cuisineType,
        address,
        location: { lat, lng },
        distance: distance || undefined,
        rating: rating || undefined,
        id,
        source,
      });
    }

    // 自定义选项
    const customCount = reader.readVarint();
    const customOptions: CustomOption[] = [];

    for (let i = 0; i < customCount; i++) {
      const id = reader.readString();
      const name = reader.readString();
      customOptions.push({ id, name, isCustom: true });
    }

    return { query, restaurants, customOptions };
  } catch (e) {
    console.error('Failed to deserialize binary data:', e);
    return null;
  }
}

// ==================== Base64URL 编解码 (兼容浏览器和 Node.js) ====================

const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function uint8ToBase64Url(data: Uint8Array): string {
  let result = '';
  const len = data.length;

  for (let i = 0; i < len; i += 3) {
    const b0 = data[i];
    const b1 = i + 1 < len ? data[i + 1] : 0;
    const b2 = i + 2 < len ? data[i + 2] : 0;

    // 第一个字符：b0 的高 6 位
    result += BASE64URL_CHARS[b0 >> 2];
    // 第二个字符：b0 的低 2 位 + b1 的高 4 位
    result += BASE64URL_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    // 第三个字符：b1 的低 4 位 + b2 的高 2 位（如果有 b1）
    if (i + 1 < len) {
      result += BASE64URL_CHARS[((b1 & 0x0F) << 2) | (b2 >> 6)];
    }
    // 第四个字符：b2 的低 6 位（如果有 b2）
    if (i + 2 < len) {
      result += BASE64URL_CHARS[b2 & 0x3F];
    }
  }

  return result;
}

function base64UrlToUint8(str: string): Uint8Array {
  // 创建反向查找表
  const lookup: number[] = new Array(128).fill(0);
  for (let i = 0; i < BASE64URL_CHARS.length; i++) {
    lookup[BASE64URL_CHARS.charCodeAt(i)] = i;
  }

  const len = str.length;
  // 计算输出长度：每 4 个字符产生 3 字节，但最后可能不足 4 个
  // len=2 -> 1 byte, len=3 -> 2 bytes, len=4 -> 3 bytes
  const outputLen = Math.floor(len * 3 / 4);
  const result = new Uint8Array(outputLen);

  let resultIdx = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = lookup[str.charCodeAt(i)];
    const c1 = i + 1 < len ? lookup[str.charCodeAt(i + 1)] : 0;
    const c2 = i + 2 < len ? lookup[str.charCodeAt(i + 2)] : 0;
    const c3 = i + 3 < len ? lookup[str.charCodeAt(i + 3)] : 0;

    // 第一字节：c0 全部 + c1 高 2 位
    if (resultIdx < outputLen) {
      result[resultIdx++] = (c0 << 2) | (c1 >> 4);
    }
    // 第二字节：c1 低 4 位 + c2 高 4 位
    if (resultIdx < outputLen) {
      result[resultIdx++] = ((c1 & 0x0F) << 4) | (c2 >> 2);
    }
    // 第三字节：c2 低 2 位 + c3 全部
    if (resultIdx < outputLen) {
      result[resultIdx++] = ((c2 & 0x03) << 6) | c3;
    }
  }

  return result;
}

// ==================== 公开 API ====================

/**
 * 压缩分享数据为 URL 安全字符串
 *
 * 流程: JSON → 二进制 → deflate压缩 → Base64URL
 */
export function compressShareData(data: ShareData): string {
  // 1. 序列化为二进制
  const binary = serializeToBinary(data);

  // 2. deflate 压缩 (level 9 最大压缩)
  const compressed = deflateSync(binary, { level: 9 });

  // 3. Base64URL 编码
  return uint8ToBase64Url(compressed);
}

/**
 * 解压 URL 字符串为分享数据
 *
 * 流程: Base64URL → inflate解压 → 二进制反序列化
 */
export function decompressShareData(encoded: string): ShareData | null {
  try {
    // 1. Base64URL 解码
    const compressed = base64UrlToUint8(encoded);

    // 检查数据是否为空
    if (compressed.length === 0) {
      console.error('Empty compressed data');
      return null;
    }

    // 2. inflate 解压
    let binary: Uint8Array;
    try {
      binary = inflateSync(compressed);
    } catch (inflateError) {
      // 可能是旧版 lz-string 格式，不支持
      console.error('Inflate failed (possibly old lz-string format):', inflateError);
      return null;
    }

    // 3. 反序列化
    return deserializeFromBinary(binary);
  } catch (e) {
    console.error('Failed to decompress share data:', e);
    return null;
  }
}
