import React, { useEffect, useState } from 'react';

/**
 * Liquid Glass Filter 组件
 * 提供两个 SVG filter：
 * - #aiOfficeLiquidGlassShell  → 外壳玻璃，折射稍明显
 * - #aiOfficeLiquidGlassCanvas → 画布玻璃，边缘轻微折射
 */
export const LiquidGlassFilter: React.FC = () => {
  const [displacementDataUrl, setDisplacementDataUrl] = useState<string>('');

  useEffect(() => {
    // 生成位移贴图
    const url = generateDisplacementMap({
      size: 512,
      bezelRatio: 0.1,
      curveType: 'squircle',
      refractiveIndex: 1.5,
      cornerRadius: 0.05,
    });
    setDisplacementDataUrl(url);
  }, []);

  if (!displacementDataUrl) return null;

  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      {/* 外壳玻璃：折射稍明显，增强整体流体感 */}
      <filter
        id="aiOfficeLiquidGlassShell"
        x="-10%"
        y="-10%"
        width="120%"
        height="120%"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          href={displacementDataUrl}
          x="0"
          y="0"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          result="displacement_map"
        />
        <feGaussianBlur in="displacement_map" stdDeviation="1.5" result="displacement_blur" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="displacement_blur"
          scale={40}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>

      {/* 画布玻璃：只在边缘稍微折射，避免内容扭曲 */}
      <filter
        id="aiOfficeLiquidGlassCanvas"
        x="-10%"
        y="-10%"
        width="120%"
        height="120%"
        colorInterpolationFilters="sRGB"
      >
        <feImage
          href={displacementDataUrl}
          x="0"
          y="0"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          result="displacement_map"
        />
        <feGaussianBlur in="displacement_map" stdDeviation="1" result="displacement_blur" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="displacement_blur"
          scale={24}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
};

/**
 * 表面高度函数 - Squircle 曲线
 */
function surfaceHeight(x: number, type: 'circle' | 'squircle'): number {
  const clamped = Math.max(0, Math.min(1, x));
  if (type === 'circle') {
    return Math.sqrt(1 - Math.pow(1 - clamped, 2));
  } else {
    return Math.pow(1 - Math.pow(1 - clamped, 4), 0.25);
  }
}

/**
 * 计算表面法线
 */
function surfaceNormal(x: number, type: 'circle' | 'squircle'): number {
  const delta = 0.001;
  const y1 = surfaceHeight(x - delta, type);
  const y2 = surfaceHeight(x + delta, type);
  const derivative = (y2 - y1) / (2 * delta);
  return Math.atan(derivative);
}

/**
 * Snell 定律计算折射角
 */
function snellRefraction(incidentAngle: number, n1: number, n2: number): number {
  const sinTheta1 = Math.sin(incidentAngle);
  const sinTheta2 = (n1 / n2) * sinTheta1;
  if (Math.abs(sinTheta2) > 1) return incidentAngle;
  return Math.asin(sinTheta2);
}

/**
 * 计算位移量
 */
function calculateDisplacement(
  distFromEdge: number,
  bezelWidth: number,
  curveType: 'circle' | 'squircle',
  refractiveIndex: number
): number {
  if (distFromEdge >= bezelWidth) return 0;
  
  const normalizedDist = distFromEdge / bezelWidth;
  const normalAngle = surfaceNormal(normalizedDist, curveType);
  const incidentAngle = Math.abs(normalAngle);
  const refractedAngle = snellRefraction(incidentAngle, 1.0, refractiveIndex);
  const height = surfaceHeight(normalizedDist, curveType);
  const displacement = height * Math.tan(incidentAngle - refractedAngle);
  
  return displacement * Math.sign(normalAngle);
}

interface GenerateMapOptions {
  size: number;
  bezelRatio: number;
  curveType: 'circle' | 'squircle';
  refractiveIndex: number;
  cornerRadius: number;
}

/**
 * 生成位移贴图
 */
function generateDisplacementMap(options: GenerateMapOptions): string {
  const { size, bezelRatio, curveType, refractiveIndex, cornerRadius } = options;
  
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  
  const imageData = ctx.createImageData(size, size);
  const bezelPixels = size * bezelRatio;
  const cornerPixels = size * cornerRadius;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      
      const distLeft = x;
      const distRight = size - 1 - x;
      const distTop = y;
      const distBottom = size - 1 - y;
      
      let distFromEdge: number;
      let edgeAngle: number;
      
      const inCornerTL = x < cornerPixels && y < cornerPixels;
      const inCornerTR = x > size - cornerPixels && y < cornerPixels;
      const inCornerBL = x < cornerPixels && y > size - cornerPixels;
      const inCornerBR = x > size - cornerPixels && y > size - cornerPixels;
      
      if (inCornerTL) {
        const dx = cornerPixels - x;
        const dy = cornerPixels - y;
        distFromEdge = cornerPixels - Math.sqrt(dx * dx + dy * dy);
        edgeAngle = Math.atan2(dy, dx);
      } else if (inCornerTR) {
        const dx = x - (size - cornerPixels);
        const dy = cornerPixels - y;
        distFromEdge = cornerPixels - Math.sqrt(dx * dx + dy * dy);
        edgeAngle = Math.atan2(dy, -dx);
      } else if (inCornerBL) {
        const dx = cornerPixels - x;
        const dy = y - (size - cornerPixels);
        distFromEdge = cornerPixels - Math.sqrt(dx * dx + dy * dy);
        edgeAngle = Math.atan2(-dy, dx);
      } else if (inCornerBR) {
        const dx = x - (size - cornerPixels);
        const dy = y - (size - cornerPixels);
        distFromEdge = cornerPixels - Math.sqrt(dx * dx + dy * dy);
        edgeAngle = Math.atan2(-dy, -dx);
      } else {
        const minDist = Math.min(distLeft, distRight, distTop, distBottom);
        distFromEdge = minDist;
        
        if (minDist === distLeft) edgeAngle = Math.PI;
        else if (minDist === distRight) edgeAngle = 0;
        else if (minDist === distTop) edgeAngle = -Math.PI / 2;
        else edgeAngle = Math.PI / 2;
      }
      
      const displacement = calculateDisplacement(distFromEdge, bezelPixels, curveType, refractiveIndex);
      
      const dispX = displacement * Math.cos(edgeAngle);
      const dispY = displacement * Math.sin(edgeAngle);
      
      const encodeScale = 2.0;
      const r = Math.round(128 + dispX * encodeScale * 127);
      const g = Math.round(128 + dispY * encodeScale * 127);
      
      imageData.data[idx] = Math.max(0, Math.min(255, r));
      imageData.data[idx + 1] = Math.max(0, Math.min(255, g));
      imageData.data[idx + 2] = 128;
      imageData.data[idx + 3] = 255;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

export default LiquidGlassFilter;
