/**
 * 高德地图 Web API 类型定义
 */

declare global {
  interface Window {
    AMap?: typeof AMap;
  }

  namespace AMap {
    // 地图类
    class Map {
      constructor(container: string | HTMLElement, opts?: MapOptions);
      add(overlays: Overlay | Overlay[]): void;
      remove(overlays: Overlay | Overlay[]): void;
      setCenter(position: [number, number] | LngLat): void;
      setZoom(zoom: number): void;
      setZoomAndCenter(zoom: number, center: [number, number] | LngLat, immediately?: boolean, duration?: number): void;
      getCenter(): LngLat;
      getZoom(): number;
      setBounds(bounds: Bounds, immediately?: boolean, padding?: number[]): void;
      destroy(): void;
      on(event: string, callback: Function): void;
      off(event: string, callback?: Function): void;
    }

    // 地图配置
    interface MapOptions {
      zoom?: number;
      center?: [number, number] | LngLat;
      mapStyle?: string;
      [key: string]: any;
    }

    // 标记
    class Marker {
      constructor(opts?: MarkerOptions);
      setPosition(position: [number, number] | LngLat): void;
      getPosition(): LngLat;
      setMap(map: Map | null): void;
      on(event: string, callback: Function): void;
      off(event: string, callback?: Function): void;
    }

    interface MarkerOptions {
      map?: Map;
      position?: [number, number] | LngLat;
      title?: string;
      icon?: string | Icon;
      offset?: Pixel;
      [key: string]: any;
    }

    // 位置坐标
    class LngLat {
      constructor(lng: number, lat: number);
      getLng(): number;
      getLat(): number;
      toString(): string;
    }

    // 像素
    class Pixel {
      constructor(x: number, y: number);
      getX(): number;
      getY(): number;
    }

    // 大小
    class Size {
      constructor(width: number, height: number);
      getWidth(): number;
      getHeight(): number;
    }

    // 图标
    class Icon {
      constructor(opts?: IconOptions);
    }

    interface IconOptions {
      size?: Size;
      imageSize?: Size;
      image?: string;
      [key: string]: any;
    }

    // 基类
    class Overlay {
      setMap(map: Map | null): void;
    }

    // POI 搜索
    class PlaceSearch {
      constructor(opts?: PlaceSearchOptions);
      search(keyword: string, callback?: (status: string, result: any) => void): void;
      searchNearBy(keyword: string, center: [number, number] | LngLat, radius?: number, callback?: (status: string, result: any) => void): void;
      searchInBounds(keyword: string, bounds: Bounds, callback?: (status: string, result: any) => void): void;
      on(event: string, callback: Function): void;
      off(event: string, callback?: Function): void;
    }

    interface PlaceSearchOptions {
      map?: Map;
      pageSize?: number;
      pageIndex?: number;
      city?: string;
      citylimit?: boolean;
      [key: string]: any;
    }

    // 地理编码
    class Geocoder {
      constructor(opts?: GeocoderOptions);
      getLocation(address: string, callback?: (status: string, result: any) => void): void;
      getAddress(lnglat: [number, number] | LngLat, callback?: (status: string, result: any) => void): void;
    }

    interface GeocoderOptions {
      city?: string;
      [key: string]: any;
    }

    // 边界
    class Bounds {
      constructor(southwest: LngLat, northeast: LngLat);
      contains(point: LngLat): boolean;
      getSouthWest(): LngLat;
      getNorthEast(): LngLat;
    }

    // 信息窗口
    class InfoWindow {
      constructor(opts?: InfoWindowOptions);
      open(map: Map, position: [number, number] | LngLat): void;
      close(): void;
      setContent(content: string | HTMLElement): void;
    }

    interface InfoWindowOptions {
      isCustom?: boolean;
      autoMove?: boolean;
      closeWhenClickMap?: boolean;
      content?: string | HTMLElement;
      offset?: Pixel;
      [key: string]: any;
    }
  }
}

export {};
