/**
 * 距离计算工具
 * 使用 Haversine 公式计算地球表面两点间的距离
 */

/**
 * 将角度转换为弧度
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * 使用 Haversine 公式计算两个经纬度坐标之间的距离
 * @param lat1 第一个点的纬度
 * @param lng1 第一个点的经度
 * @param lat2 第二个点的纬度
 * @param lng2 第二个点的经度
 * @returns 距离（米）
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // 地球半径（米）
  const R = 6371000;

  // 将经纬度转换为弧度
  const φ1 = toRadians(lat1);
  const φ2 = toRadians(lat2);
  const Δφ = toRadians(lat2 - lat1);
  const Δλ = toRadians(lng2 - lng1);

  // Haversine 公式
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // 距离（米）
  const distance = R * c;

  return Math.round(distance);
}

/**
 * 检查点是否在指定半径内
 */
export function isWithinRadius(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radius: number
): boolean {
  const distance = haversineDistance(lat1, lng1, lat2, lng2);
  return distance <= radius;
}
