# Mobile Design Specification (H5 / Web App)

**设计语言**: iOS 18 "Intelligence" & VisionOS Glass
**视口尺寸**: 375 x 812 px (设计稿高度包含浏览器地址栏区域，实际内容自适应)
**核心理念**: 移除伪原生元素，拥抱 Web 特性；使用流动的光影传达智能感。

### 1. 首页：流体输入 (Home View)
*设计重点：H5 顶部导航适配，带有"呼吸感"的 AI 输入框，模拟 Siri 的多色流体光效。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- AI Glow Gradient -->
    <linearGradient id="aiGlow" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#007AFF" stop-opacity="0.5"/>
      <stop offset="50%" stop-color="#AF52DE" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#FF2D55" stop-opacity="0.5"/>
    </linearGradient>
    <filter id="blurGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="10"/>
    </filter>
    <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.08"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#F5F5F7"/>

  <!-- Simulated Browser Nav Space (Top) -->
  <rect x="0" y="0" width="375" height="60" fill="none"/>
  <!-- Just content padding, no fake status bar -->

  <!-- Brand / Header -->
  <text x="20" y="80" font-family="-apple-system, sans-serif" font-size="28" font-weight="800" fill="#1D1D1F">今天吃啥</text>

  <!-- History Entry (Web Link Style) -->
  <g transform="translate(315, 60)">
     <circle cx="20" cy="20" r="18" fill="#E5E5EA"/>
     <path d="M20,13 L20,20 L24,24" stroke="#007AFF" stroke-width="2" stroke-linecap="round" fill="none"/>
  </g>

  <!-- Main AI Input Area -->
  <g transform="translate(20, 140)">
    <!-- Animated Glow Background -->
    <rect x="-4" y="-4" width="343" height="208" rx="24" fill="url(#aiGlow)" filter="url(#blurGlow)" opacity="0.6"/>

    <!-- Input Card Surface -->
    <rect x="0" y="0" width="335" height="200" rx="20" fill="#FFFFFF" fill-opacity="0.95"/>

    <!-- Text -->
    <text x="20" y="45" font-family="-apple-system, sans-serif" font-size="22" font-weight="600" fill="#8E8E93">我想吃...</text>
    <text x="20" y="80" font-family="-apple-system, sans-serif" font-size="17" fill="#C7C7CC" leading="1.4">
      <tspan x="20" dy="0">例如：</tspan>
      <tspan x="20" dy="24">最近想吃点清淡的新店。</tspan>
    </text>

    <!-- Location Pill (Active State) -->
    <g transform="translate(20, 145)">
      <rect x="0" y="0" width="130" height="34" rx="17" fill="#F2F2F7"/>
      <!-- Pulse Dot -->
      <circle cx="16" cy="17" r="4" fill="#34C759">
         <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite"/>
      </circle>
      <text x="30" y="22" font-family="-apple-system, sans-serif" font-size="13" font-weight="500" fill="#1D1D1F">北京·朝阳</text>
    </g>
  </g>

  <!-- Floating Action Button (Avoid Safari Bottom Bar) -->
  <!-- Placed higher than native app to avoid browser chrome -->
  <g transform="translate(20, 680)">
    <defs>
      <linearGradient id="btnGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#007AFF"/>
        <stop offset="100%" stop-color="#5856D6"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="335" height="56" rx="28" fill="url(#btnGrad)" filter="url(#softShadow)"/>
    <text x="167.5" y="35" font-family="-apple-system, sans-serif" font-size="17" font-weight="600" fill="#FFFFFF" text-anchor="middle">获取推荐</text>
  </g>
</svg>
```

### 2. 加载中：思维光球 (Loading View)
*设计重点：VisionOS 风格的磨砂背景，中心是代表 AI 思考的动态光球，字体使用动态打字机效果。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="40%" stop-color="#007AFF" stop-opacity="0.8"/>
      <stop offset="100%" stop-color="#5856D6" stop-opacity="0"/>
    </radialGradient>
    <filter id="heavyBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="30"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#F5F5F7"/>

  <!-- AI Orb Container -->
  <g transform="translate(187.5, 380)">
    <!-- Expanding Rings -->
    <circle cx="0" cy="0" r="100" fill="#AF52DE" fill-opacity="0.3" filter="url(#heavyBlur)">
      <animate attributeName="r" values="80;120;80" dur="3s" repeatCount="indefinite"/>
    </circle>
    <circle cx="0" cy="0" r="60" fill="url(#coreGlow)">
      <animate attributeName="opacity" values="0.8;1;0.8" dur="1.5s" repeatCount="indefinite"/>
    </circle>
  </g>

  <!-- Text Info -->
  <g transform="translate(187.5, 540)">
    <text x="0" y="0" font-family="-apple-system, sans-serif" font-size="20" font-weight="600" fill="#1D1D1F" text-anchor="middle">正在分析口味...</text>
    <text x="0" y="30" font-family="-apple-system, sans-serif" font-size="15" fill="#8E8E93" text-anchor="middle">已联想关键词：清淡、日料、环境好</text>
  </g>
</svg>
```

### 3. 转盘页：物理质感 (Turntable View)
*设计重点：增加转盘的厚度感（内阴影+外环），指针拟物化（金属质感），"开始"按钮使用网格渐变，增加点击欲望。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="wheelDepth" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000" flood-opacity="0.12"/>
    </filter>
    <filter id="pointerShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.25"/>
    </filter>
    <linearGradient id="meshBtn" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FF9500"/>
      <stop offset="100%" stop-color="#FF2D55"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#FFFFFF"/>

  <!-- Top Actions -->
  <g transform="translate(20, 60)">
     <rect x="0" y="0" width="40" height="40" rx="20" fill="#F2F2F7"/>
     <path d="M15,20 L25,20 M15,15 L25,15 M15,25 L25,25" stroke="#007AFF" stroke-width="2" stroke-linecap="round"/> <!-- Edit Icon -->
  </g>
  <text x="187.5" y="85" font-family="-apple-system" font-size="17" font-weight="600" fill="#000" text-anchor="middle">8 家候选餐厅</text>

  <!-- Turntable Area -->
  <g transform="translate(187.5, 340)" filter="url(#wheelDepth)">
    <!-- Outer Ring (Glass/Metal feel) -->
    <circle cx="0" cy="0" r="158" fill="#F2F2F7" stroke="#E5E5EA" stroke-width="1"/>

    <!-- Wheel Body -->
    <circle cx="0" cy="0" r="150" fill="#FFF"/>

    <!-- Segments (Pastel colors with subtle separation) -->
    <path d="M0,0 L0,-150 A150,150 0 0,1 106,-106 Z" fill="#E3F2FD" stroke="#FFF" stroke-width="2"/>
    <text x="40" y="-100" font-family="-apple-system" font-size="11" fill="#1565C0" transform="rotate(22.5)" font-weight="600">望京小麦</text>

    <path d="M0,0 L106,-106 A150,150 0 0,1 150,0 Z" fill="#E8F5E9" stroke="#FFF" stroke-width="2"/>
    <path d="M0,0 L150,0 A150,150 0 0,1 106,106 Z" fill="#FFFDE7" stroke="#FFF" stroke-width="2"/>
    <path d="M0,0 L106,106 A150,150 0 0,1 0,150 Z" fill="#FFF3E0" stroke="#FFF" stroke-width="2"/>
    <path d="M0,0 L0,150 A150,150 0 0,1 -106,106 Z" fill="#FFEBEE" stroke="#FFF" stroke-width="2"/>
    <path d="M0,0 L-106,106 A150,150 0 0,1 -150,0 Z" fill="#F3E5F5" stroke="#FFF" stroke-width="2"/>
    <path d="M0,0 L-150,0 A150,150 0 0,1 -106,-106 Z" fill="#E8EAF6" stroke="#FFF" stroke-width="2"/>
    <path d="M0,0 L-106,-106 A150,150 0 0,1 0,-150 Z" fill="#E0F2F1" stroke="#FFF" stroke-width="2"/>

    <!-- Center Hub -->
    <circle cx="0" cy="0" r="28" fill="#FFFFFF" filter="url(#pointerShadow)"/>
    <circle cx="0" cy="0" r="12" fill="#F2F2F7"/>
  </g>

  <!-- Pointer (Metallic Teardrop) -->
  <g transform="translate(187.5, 175)" filter="url(#pointerShadow)">
    <path d="M-12,0 C-12,-10 12,-10 12,0 L0,24 Z" fill="#FF3B30"/>
    <circle cx="0" cy="0" r="4" fill="#990000"/>
  </g>

  <!-- Hint -->
  <text x="187.5" y="540" font-family="-apple-system" font-size="14" fill="#8E8E93" text-anchor="middle">点击按钮转动命运</text>

  <!-- Big Start Button -->
  <g transform="translate(47.5, 660)"> <!-- Lifted for Safe Area -->
    <rect x="0" y="0" width="280" height="64" rx="32" fill="url(#meshBtn)" filter="url(#wheelDepth)"/>
    <text x="140" y="38" font-family="-apple-system, sans-serif" font-size="22" font-weight="700" fill="#FFFFFF" text-anchor="middle" letter-spacing="1">开始</text>
  </g>
</svg>
```

### 4. 结果浮窗：H5 模态卡片 (Result View)
*设计重点：区别于原生 App 的 Bottom Sheet，这里使用浮动弹窗（Floating Modal）。增加显性的"关闭"按钮（适应 Web 用户习惯），背景高斯模糊。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="modalShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="24" flood-color="#000" flood-opacity="0.2"/>
    </filter>
  </defs>

  <!-- Backdrop (Blurred Context) -->
  <image href="data:image/svg+xml,..." width="375" height="812" /> <!-- Placeholder for turntable underneath -->
  <rect width="100%" height="100%" fill="#000" opacity="0.4"/>

  <!-- Floating Card -->
  <g transform="translate(20, 200)">
    <!-- Card Body -->
    <rect x="0" y="0" width="335" height="420" rx="24" fill="#FFFFFF" filter="url(#modalShadow)"/>

    <!-- Close Button (Top Right - Crucial for Web) -->
    <g transform="translate(295, 20)">
      <circle cx="12" cy="12" r="14" fill="#F2F2F7"/>
      <path d="M8,8 L16,16 M16,8 L8,16" stroke="#8E8E93" stroke-width="2" stroke-linecap="round"/>
    </g>

    <!-- Content -->
    <g transform="translate(24, 40)">
      <!-- Cover Image Area -->
      <rect x="0" y="0" width="287" height="140" rx="16" fill="#E5E5EA"/>
      <text x="143.5" y="75" font-family="-apple-system" font-size="14" fill="#8E8E93" text-anchor="middle">餐厅环境图</text>

      <!-- Tags -->
      <g transform="translate(0, 160)">
         <rect x="0" y="0" width="50" height="22" rx="6" fill="#E3F2FD"/>
         <text x="25" y="15" font-family="-apple-system" font-size="11" font-weight="600" fill="#007AFF" text-anchor="middle">日料</text>
      </g>

      <!-- Info -->
      <text x="0" y="210" font-family="-apple-system" font-size="26" font-weight="700" fill="#1D1D1F">江户前寿司</text>
      <text x="0" y="235" font-family="-apple-system" font-size="15" fill="#3A3A3C">★ 4.9 · ¥120/人 · 步行 500m</text>

      <!-- Divider -->
      <rect x="0" y="260" width="287" height="1" fill="#F2F2F7"/>

      <!-- Address -->
      <text x="0" y="285" font-family="-apple-system" font-size="14" fill="#8E8E93">地址：三里屯太古里北区 N4</text>
    </g>

    <!-- Action Buttons (Side by Side) -->
    <g transform="translate(24, 340)">
      <!-- Secondary: Spin Again -->
      <rect x="0" y="0" width="135" height="50" rx="14" fill="#F2F2F7"/>
      <text x="67.5" y="30" font-family="-apple-system" font-size="15" font-weight="600" fill="#007AFF" text-anchor="middle">再来一次</text>

      <!-- Primary: Go -->
      <rect x="152" y="0" width="135" height="50" rx="14" fill="#007AFF"/>
      <text x="67.5" y="30" font-family="-apple-system" font-size="15" font-weight="600" fill="#FFFFFF" text-anchor="middle">导航前往</text>
    </g>
  </g>
</svg>
```

### 5. 编辑列表：Web 友好型 (Edit List View)
*设计重点：避免与浏览器"后退"手势冲突，不使用左滑删除。采用显性的红色删除图标。顶部使用"模态导航栏"。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="100%" height="100%" fill="#F2F2F7"/>

  <!-- Modal Nav Bar (Web Style) -->
  <rect x="0" y="0" width="375" height="60" fill="#FFFFFF"/>
  <text x="187.5" y="35" font-family="-apple-system" font-size="17" font-weight="600" fill="#000" text-anchor="middle">编辑转盘</text>
  <text x="325" y="35" font-family="-apple-system" font-size="17" fill="#007AFF">完成</text>

  <!-- List Content -->
  <g transform="translate(0, 80)">

    <!-- Item 1 -->
    <rect x="0" y="0" width="375" height="60" fill="#FFFFFF"/>
    <!-- Explicit Delete Icon (No Swipe) -->
    <g transform="translate(20, 18)">
      <circle cx="12" cy="12" r="11" fill="#FF3B30"/>
      <rect x="6" y="11" width="12" height="2" fill="#FFF"/>
    </g>
    <text x="56" y="35" font-family="-apple-system" font-size="17" fill="#000">望京小麦</text>
    <rect x="56" y="59" width="319" height="1" fill="#E5E5EA"/>

    <!-- Item 2 -->
    <rect x="0" y="60" width="375" height="60" fill="#FFFFFF"/>
    <g transform="translate(20, 78)">
      <circle cx="12" cy="12" r="11" fill="#FF3B30"/>
      <rect x="6" y="11" width="12" height="2" fill="#FFF"/>
    </g>
    <text x="56" y="95" font-family="-apple-system" font-size="17" fill="#000">海底捞</text>
    <rect x="56" y="119" width="319" height="1" fill="#E5E5EA"/>

    <!-- Add New Button -->
    <rect x="0" y="140" width="375" height="50" fill="none"/>
    <g transform="translate(20, 153)">
       <circle cx="12" cy="12" r="11" fill="#34C759"/>
       <path d="M12,6 L12,18 M6,12 L18,12" stroke="#FFF" stroke-width="2"/>
    </g>
    <text x="56" y="170" font-family="-apple-system" font-size="17" fill="#000">手动添加餐厅...</text>
  </g>
</svg>
```

### 6. 历史记录：清晰层级 (History View)
*设计重点：标准的列表布局，利用分组头部（Group Header）区分时间。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="100%" height="100%" fill="#F2F2F7"/>

  <!-- Web Header -->
  <rect x="0" y="0" width="375" height="100" fill="#F2F2F7"/>
  <text x="20" y="80" font-family="-apple-system" font-size="34" font-weight="700" fill="#000">历史记录</text>

  <!-- Clear Button -->
  <rect x="300" y="60" width="60" height="30" rx="15" fill="#E5E5EA"/>
  <text x="330" y="80" font-family="-apple-system" font-size="13" font-weight="600" fill="#007AFF" text-anchor="middle">清空</text>

  <!-- List -->
  <g transform="translate(0, 120)">

    <!-- Section -->
    <text x="20" y="0" font-family="-apple-system" font-size="13" fill="#8E8E93" font-weight="600">今天</text>

    <!-- Card 1 -->
    <g transform="translate(16, 15)">
      <rect x="0" y="0" width="343" height="80" rx="12" fill="#FFFFFF"/>
      <!-- Icon/Cuisine -->
      <rect x="16" y="16" width="48" height="48" rx="8" fill="#FFF3E0"/>
      <text x="40" y="45" font-family="-apple-system" font-size="20" text-anchor="middle">🍣</text>

      <text x="76" y="32" font-family="-apple-system" font-size="17" font-weight="600" fill="#000">江户前寿司</text>
      <text x="76" y="54" font-family="-apple-system" font-size="14" fill="#8E8E93">需求：好吃的日料</text>

      <!-- Arrow -->
      <path d="M315,36 L320,40 L315,44" stroke="#C7C7CC" stroke-width="2" stroke-linecap="round" fill="none"/>
    </g>

    <!-- Card 2 -->
    <g transform="translate(16, 105)">
      <rect x="0" y="0" width="343" height="80" rx="12" fill="#FFFFFF"/>
      <rect x="16" y="16" width="48" height="48" rx="8" fill="#E3F2FD"/>
      <text x="40" y="45" font-family="-apple-system" font-size="20" text-anchor="middle">🍲</text>

      <text x="76" y="32" font-family="-apple-system" font-size="17" font-weight="600" fill="#000">张氏麻辣烫</text>
      <text x="76" y="54" font-family="-apple-system" font-size="14" fill="#8E8E93">需求：热乎的</text>

      <path d="M315,36 L320,40 L315,44" stroke="#C7C7CC" stroke-width="2" stroke-linecap="round" fill="none"/>
    </g>
  </g>
</svg>
```

### 7. 错误与空状态 (Error View)
*设计重点：使用柔和的插画（Memoji 风格或 3D 图标）减少挫败感，提供显著的重试按钮。*

```svg
<svg width="375" height="812" viewBox="0 0 375 812" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#F5F5F7"/>

  <g transform="translate(187.5, 300)">
    <!-- Placeholder Graphic (Abstract Plate) -->
    <circle cx="0" cy="0" r="60" fill="#E5E5EA"/>
    <circle cx="0" cy="0" r="40" fill="#F2F2F7"/>
    <!-- Question Mark -->
    <text x="0" y="15" font-family="-apple-system" font-size="40" fill="#C7C7CC" text-anchor="middle">?</text>

    <!-- Text -->
    <text x="0" y="100" font-family="-apple-system, sans-serif" font-size="20" font-weight="700" fill="#1D1D1F" text-anchor="middle">找不到符合的餐厅</text>
    <text x="0" y="130" font-family="-apple-system, sans-serif" font-size="15" fill="#8E8E93" text-anchor="middle">您的需求太独特了，换个条件试试？</text>
  </g>

  <!-- Retry Button -->
  <g transform="translate(87.5, 480)">
    <rect x="0" y="0" width="200" height="50" rx="25" fill="#E5E5EA"/>
    <text x="100" y="30" font-family="-apple-system, sans-serif" font-size="17" font-weight="600" fill="#007AFF" text-anchor="middle">修改需求</text>
  </g>
</svg>
```
