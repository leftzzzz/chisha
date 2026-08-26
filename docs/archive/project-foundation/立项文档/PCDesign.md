> 状态：历史归档。仅用于追溯，不是当前实现依据。

# PC 端 H5 页面设计规范 (Revised)

基于 Apple Human Interface Guidelines (HIG) 与 Web 现代设计趋势，我们对界面进行了深度优化。设计核心原则转变为：**沉浸感 (Immersion)**、**连贯性 (Continuity)** 与 **即时反馈 (Direct Manipulation)**。

## 设计规范概要
*   **画布尺寸**：1440px x 900px
*   **视觉风格**：macOS Sonoma (Glassmorphism, Subtle Gradients, Floating Panels).
*   **色彩体系**：
    *   主色：System Blue (`#007AFF`)
    *   强调色：Mint (`#00C7BE`) - 用于选中/推荐
    *   背景：全屏地图或高斯模糊弥散光
*   **字体**：SF Pro / -apple-system

---

### 1. 首页：灵感引导 (Immersive Input with Inspiration)
*设计改进：在输入框下方增加了“灵感胶囊 (Chips)”。解决用户“不知道写什么”的认知空白，同时作为快捷输入入口。*

```svg
<svg width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#F5F5F7"/>
      <stop offset="100%" stop-color="#E5E5EA"/>
    </linearGradient>
    <filter id="floatShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="20" stdDeviation="40" flood-color="#000" flood-opacity="0.1"/>
    </filter>
    <linearGradient id="btnGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#007AFF"/>
      <stop offset="100%" stop-color="#0051A8"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="url(#bgGradient)"/>
  
  <!-- Subtle Abstract Shapes for depth -->
  <circle cx="200" cy="800" r="300" fill="#007AFF" opacity="0.05"/>
  <circle cx="1200" cy="100" r="200" fill="#FF2D55" opacity="0.05"/>

  <!-- Center Floating Card -->
  <g transform="translate(370, 180)">
    <!-- Card Base -->
    <rect x="0" y="0" width="700" height="480" rx="32" fill="#FFFFFF" filter="url(#floatShadow)"/>
    
    <!-- Content -->
    <g transform="translate(80, 70)">
      <!-- Headline -->
      <text x="0" y="0" font-family="-apple-system, sans-serif" font-size="44" font-weight="700" fill="#1D1D1F">今天吃啥？</text>
      <text x="0" y="40" font-family="-apple-system, sans-serif" font-size="18" fill="#86868B">告诉 AI 你的口味，剩下的交给运气。</text>

      <!-- Input Field -->
      <g transform="translate(0, 80)">
        <rect x="0" y="0" width="540" height="80" rx="24" fill="#F5F5F7" stroke="#E5E5EA" stroke-width="1"/>
        <text x="24" y="48" font-family="-apple-system, sans-serif" font-size="20" fill="#8E8E93">例如：想吃清淡的素食，不要太贵...</text>
        <!-- Mic Icon Placeholder -->
        <circle cx="500" cy="40" r="15" fill="#E5E5EA"/>
        <path d="M500,32 L500,42" stroke="#8E8E93" stroke-width="2" stroke-linecap="round"/>
      </g>
      
      <!-- Inspiration Chips (New Feature) -->
      <g transform="translate(0, 180)">
         <text x="0" y="0" font-family="-apple-system" font-size="14" font-weight="600" fill="#86868B">不知道怎么说？试试这些：</text>
         
         <!-- Chip 1 -->
         <g transform="translate(0, 20)">
            <rect width="130" height="36" rx="18" fill="#E8F1FF" stroke="#007AFF" stroke-width="0.5"/>
            <text x="65" y="23" font-family="-apple-system" font-size="13" fill="#007AFF" text-anchor="middle">🔥 附近热门</text>
         </g>
         <!-- Chip 2 -->
         <g transform="translate(140, 20)">
            <rect width="130" height="36" rx="18" fill="#FFF" stroke="#D1D1D6" stroke-width="1"/>
            <text x="65" y="23" font-family="-apple-system" font-size="13" fill="#1D1D1F" text-anchor="middle">🥗 轻食主义</text>
         </g>
         <!-- Chip 3 -->
         <g transform="translate(280, 20)">
            <rect width="130" height="36" rx="18" fill="#FFF" stroke="#D1D1D6" stroke-width="1"/>
            <text x="65" y="23" font-family="-apple-system" font-size="13" fill="#1D1D1F" text-anchor="middle">💰 50元以内</text>
         </g>
         <!-- Chip 4 -->
         <g transform="translate(420, 20)">
            <rect width="110" height="36" rx="18" fill="#FFF" stroke="#D1D1D6" stroke-width="1"/>
            <text x="55" y="23" font-family="-apple-system" font-size="13" fill="#1D1D1F" text-anchor="middle">🍜 来碗面</text>
         </g>
      </g>

      <!-- Action Row -->
      <g transform="translate(0, 270)">
        <!-- Location -->
        <g>
          <path d="M10,15 L20,30 L30,15 A10,10 0 1 0 10,15" fill="none" stroke="#007AFF" stroke-width="2"/>
          <text x="35" y="25" font-family="-apple-system" font-size="16" font-weight="600" fill="#1D1D1F">北京·朝阳区</text>
        </g>
        
        <!-- Main Button -->
        <g transform="translate(340, 0)">
           <rect x="0" y="-10" width="200" height="60" rx="30" fill="url(#btnGradient)" filter="url(#floatShadow)"/>
           <text x="100" y="26" font-family="-apple-system" font-size="18" font-weight="600" fill="#FFFFFF" text-anchor="middle">开始探索 →</text>
        </g>
      </g>
    </g>
  </g>
</svg>
```

---

### 2. 智能加载：分步反馈 (Process Feedback)
*设计改进：针对 LLM 和 API 可能存在的 10-15秒 延迟，设计了分步动态反馈。避免枯燥的 Loading 圈，让用户看到 AI 正在工作的过程。*

```svg
<svg width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#F5F5F7"/>
  
  <!-- Central Status Card -->
  <g transform="translate(520, 300)">
    <!-- Animating Rings (Simulated) -->
    <circle cx="200" cy="150" r="100" stroke="#007AFF" stroke-width="1" fill="none" opacity="0.2"/>
    <circle cx="200" cy="150" r="120" stroke="#007AFF" stroke-width="1" fill="none" opacity="0.1"/>
    
    <!-- Content -->
    <text x="200" y="280" font-family="-apple-system" font-size="24" font-weight="600" fill="#1D1D1F" text-anchor="middle">正在为您的胃口定制...</text>
    
    <!-- Steps List -->
    <g transform="translate(80, 330)">
       <!-- Step 1: Done -->
       <g>
         <circle cx="10" cy="10" r="10" fill="#34C759"/>
         <path d="M6,10 L9,13 L14,7" stroke="#FFF" stroke-width="2" fill="none"/>
         <text x="30" y="15" font-family="-apple-system" font-size="16" fill="#1D1D1F" opacity="0.6">理解需求：清淡、素食</text>
       </g>
       
       <!-- Step 2: Active -->
       <g transform="translate(0, 40)">
         <circle cx="10" cy="10" r="10" fill="#007AFF"/>
         <!-- Spinner Indicator -->
         <path d="M10,4 A6,6 0 0 1 16,10" stroke="#FFF" stroke-width="2" fill="none"/> 
         <text x="30" y="15" font-family="-apple-system" font-size="16" font-weight="600" fill="#1D1D1F">搜索周边 3km 餐厅...</text>
       </g>
       
       <!-- Step 3: Pending -->
       <g transform="translate(0, 80)">
         <circle cx="10" cy="10" r="10" fill="#E5E5EA"/>
         <text x="30" y="15" font-family="-apple-system" font-size="16" fill="#8E8E93">生成幸运转盘</text>
       </g>
    </g>
  </g>
</svg>
```

---

### 3. 核心工作台：地图背景 + 悬浮控制台 (The Workspace)
*设计改进：这是最核心的交互界面。*
1.  **全屏地图**：提供位置上下文。
2.  **左侧玻璃面板**：集成“转盘”与“候选列表”。**去除了弹窗**，用户可以在这里直接点击列表项旁边的 `x` 来剔除餐厅，转盘实时更新。
3.  **转盘视觉**：双色极简风格，增加高级感。

```svg
<svg width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glassBlur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="10"/>
    </filter>
    <filter id="panelShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="20" flood-color="#000" flood-opacity="0.15"/>
    </filter>
    <!-- Premium Metal Gradient for Pointer -->
    <linearGradient id="metalPointer" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#555"/>
      <stop offset="100%" stop-color="#111"/>
    </linearGradient>
  </defs>

  <!-- 1. Layer: Map Background (Simulated) -->
  <rect width="100%" height="100%" fill="#E1E5EB"/> 
  <!-- Map Grids/Streets -->
  <g stroke="#FFF" stroke-width="3" fill="none">
    <path d="M0,200 L1440,300" />
    <path d="M0,600 L1440,550" />
    <path d="M400,0 L500,900" />
    <path d="M1000,0 L900,900" />
  </g>
  <!-- Pins on Map -->
  <circle cx="600" cy="300" r="6" fill="#8E8E93"/>
  <circle cx="1100" cy="500" r="6" fill="#8E8E93"/>
  <circle cx="950" cy="250" r="6" fill="#8E8E93"/>

  <!-- 2. Layer: Left Control Panel (Glassmorphism) -->
  <g transform="translate(60, 60)">
    <!-- Panel Background -->
    <rect x="0" y="0" width="440" height="780" rx="24" fill="#FFFFFF" fill-opacity="0.9" filter="url(#panelShadow)"/>
    
    <!-- Header -->
    <text x="40" y="60" font-family="-apple-system" font-size="28" font-weight="700" fill="#1D1D1F">今天吃啥</text>
    <text x="340" y="60" font-family="-apple-system" font-size="16" fill="#007AFF" font-weight="500">修改需求</text>

    <!-- THE WHEEL (Minimalist Bi-Color) -->
    <g transform="translate(220, 240)">
      <circle cx="0" cy="0" r="140" fill="#FFF" stroke="#E5E5EA" stroke-width="1"/>
      <!-- Segments (Simulated Alternating Colors) -->
      <path d="M0,0 L0,-140 A140,140 0 0,1 100,-100 Z" fill="#F2F2F7"/>
      <path d="M0,0 L100,100 A140,140 0 0,1 0,140 Z" fill="#F2F2F7"/>
      <path d="M0,0 L-100,100 A140,140 0 0,1 -140,0 Z" fill="#F2F2F7"/>
      <path d="M0,0 L-100,-100 A140,140 0 0,1 0,-140 Z" fill="#F2F2F7"/>
      
      <!-- Center Cap -->
      <circle cx="0" cy="0" r="15" fill="#FFF" stroke="#E5E5EA" stroke-width="2"/>
      <!-- Premium Pointer (Top Fixed) -->
      <path d="M-8,-150 L8,-150 L0,-130 Z" fill="url(#metalPointer)"/>
    </g>

    <!-- Divider -->
    <rect x="40" y="420" width="360" height="1" fill="#E5E5EA"/>

    <!-- Inline List (Inline Editing) -->
    <g transform="translate(40, 450)">
      <text x="0" y="0" font-family="-apple-system" font-size="14" font-weight="600" fill="#86868B">候选列表 (8/8)</text>
      
      <!-- List Item 1 -->
      <g transform="translate(0, 30)">
        <text x="0" y="15" font-family="-apple-system" font-size="16" fill="#1D1D1F">1. 望京小腰</text>
        <text x="280" y="15" font-family="-apple-system" font-size="14" fill="#8E8E93">烧烤</text>
        <!-- Delete Action -->
        <circle cx="340" cy="10" r="10" fill="#F2F2F7"/>
        <path d="M337,7 L343,13 M343,7 L337,13" stroke="#86868B" stroke-width="1.5"/>
      </g>
      
      <!-- List Item 2 -->
      <g transform="translate(0, 70)">
        <text x="0" y="15" font-family="-apple-system" font-size="16" fill="#1D1D1F">2. 素心斋</text>
        <text x="280" y="15" font-family="-apple-system" font-size="14" fill="#8E8E93">素食</text>
        <circle cx="340" cy="10" r="10" fill="#F2F2F7"/>
        <path d="M337,7 L343,13 M343,7 L337,13" stroke="#86868B" stroke-width="1.5"/>
      </g>
      
       <!-- List Item 3 -->
      <g transform="translate(0, 110)">
        <text x="0" y="15" font-family="-apple-system" font-size="16" fill="#1D1D1F">3. 麦当劳</text>
        <text x="280" y="15" font-family="-apple-system" font-size="14" fill="#8E8E93">快餐</text>
        <circle cx="340" cy="10" r="10" fill="#F2F2F7"/>
        <path d="M337,7 L343,13 M343,7 L337,13" stroke="#86868B" stroke-width="1.5"/>
      </g>
      
      <!-- Fade out for more items -->
      <rect x="0" y="140" width="360" height="50" fill="url(#fadeGradient)"/>
    </g>

    <!-- Big Action Button -->
    <g transform="translate(40, 680)">
       <rect x="0" y="0" width="360" height="60" rx="30" fill="#007AFF"/>
       <text x="180" y="36" font-family="-apple-system" font-size="20" font-weight="600" fill="#FFFFFF" text-anchor="middle">开始转动</text>
    </g>
  </g>
</svg>
```

---

### 4. 结果展示：地图悬浮卡片 (Result on Map)
*设计改进：当转盘停止后，视觉重心自然转移到地图上的结果。结果卡片以 Pop-over 形式悬浮在地图大头针上方，而不是硬生生的右侧分栏。*

```svg
<svg width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="cardFloat" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.2"/>
    </filter>
  </defs>

  <!-- Background Map (Blurred slightly to focus on card) -->
  <rect width="100%" height="100%" fill="#E1E5EB"/>
  
  <!-- Left Panel (Dimmed state) -->
  <g transform="translate(60, 60)" opacity="0.6">
    <rect x="0" y="0" width="440" height="780" rx="24" fill="#FFFFFF"/>
    <!-- Wheel Stopped at Top -->
    <g transform="translate(220, 240)">
       <circle cx="0" cy="0" r="140" fill="#FFF" stroke="#E5E5EA"/>
       <!-- Highlighted Segment -->
       <path d="M0,0 L-50,-130 A140,140 0 0,1 50,-130 Z" fill="#00C7BE" opacity="0.2"/>
       <text x="0" y="-100" font-family="-apple-system" font-size="16" font-weight="700" fill="#007AFF" text-anchor="middle">素心斋</text>
    </g>
  </g>

  <!-- RESULT: Floating Card on Map -->
  <g transform="translate(800, 300)">
    
    <!-- Map Pin (Pulsing) -->
    <circle cx="0" cy="240" r="80" fill="#007AFF" opacity="0.1"/>
    <circle cx="0" cy="240" r="10" fill="#007AFF" stroke="#FFF" stroke-width="3"/>
    
    <!-- Connection Line -->
    <line x1="0" y1="240" x2="0" y2="180" stroke="#007AFF" stroke-width="2" stroke-dasharray="4,4"/>

    <!-- The Detail Card -->
    <g transform="translate(-200, -50)">
      <rect x="0" y="0" width="400" height="230" rx="20" fill="#FFFFFF" filter="url(#cardFloat)"/>
      
      <!-- Top Section -->
      <g transform="translate(30, 30)">
        <rect x="0" y="0" width="50" height="20" rx="6" fill="#F2F2F7"/>
        <text x="25" y="14" font-family="-apple-system" font-size="11" fill="#8E8E93" text-anchor="middle">素食</text>
        
        <text x="0" y="50" font-family="-apple-system" font-size="28" font-weight="700" fill="#1D1D1F">素心斋·茶空间</text>
        <text x="0" y="80" font-family="-apple-system" font-size="16" fill="#86868B">⭐ 4.8 · 人均 ¥88 · 距离 1.2km</text>
        
        <text x="0" y="110" font-family="-apple-system" font-size="14" fill="#86868B">营业时间：10:00 - 22:00</text>
      </g>

      <!-- Action Buttons -->
      <g transform="translate(30, 160)">
        <!-- Navigate Button -->
        <rect x="0" y="0" width="160" height="44" rx="22" fill="#007AFF"/>
        <text x="80" y="27" font-family="-apple-system" font-size="15" font-weight="600" fill="#FFFFFF" text-anchor="middle">导航前往</text>
        
        <!-- Reject Button -->
        <rect x="180" y="0" width="130" height="44" rx="22" fill="#F2F2F7"/>
        <text x="245" y="27" font-family="-apple-system" font-size="15" font-weight="500" fill="#FF3B30" text-anchor="middle">不想去</text>
      </g>
      
      <!-- Close/Dismiss -->
      <circle cx="370" cy="30" r="12" fill="#F2F2F7"/>
      <path d="M366,26 L374,34 M374,26 L366,34" stroke="#8E8E93" stroke-width="2"/>
    </g>
  </g>
</svg>
```

### 5. 空状态 / 错误提示 (Empty / Error State)
*设计理念：当搜索无结果或 API 失败时，不应跳转到空白页，而是在当前地图背景上弹出一个轻量级的“状态提示框”。这让用户感觉“我还在这个应用里”，而不是“应用崩溃了”。*

*   **视觉**：使用磨砂玻璃质感的警告面板，悬浮在略微变暗的地图上。
*   **交互**：提供两个明确的行动点——“修改需求”（回到输入态）或“扩大范围”（保持需求但放宽条件）。

```svg
<svg width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="glassBlur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="20"/>
    </filter>
    <filter id="alertShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="15" stdDeviation="30" flood-color="#000" flood-opacity="0.2"/>
    </filter>
  </defs>

  <!-- Background: Map (Dimmed to focus attention) -->
  <rect width="100%" height="100%" fill="#E1E5EB"/>
  <g stroke="#FFF" stroke-width="3" fill="none" opacity="0.3">
    <path d="M0,200 L1440,300" />
    <path d="M0,600 L1440,550" />
    <path d="M400,0 L500,900" />
  </g>
  <!-- Dark Overlay -->
  <rect width="100%" height="100%" fill="#000" opacity="0.1"/>

  <!-- Center Alert Panel -->
  <g transform="translate(480, 260)">
    <!-- Glass Base -->
    <rect x="0" y="0" width="480" height="380" rx="32" fill="#FFFFFF" fill-opacity="0.95" filter="url(#alertShadow)"/>
    
    <!-- Illustration (Abstract Radar) -->
    <g transform="translate(240, 100)">
       <circle cx="0" cy="0" r="60" fill="#F2F2F7"/>
       <circle cx="0" cy="0" r="50" stroke="#E5E5EA" stroke-width="2" fill="none"/>
       <line x1="-10" y1="-10" x2="10" y2="10" stroke="#8E8E93" stroke-width="3" stroke-linecap="round"/>
       <line x1="10" y1="-10" x2="-10" y2="10" stroke="#8E8E93" stroke-width="3" stroke-linecap="round"/>
       <!-- Orbiting dot -->
       <circle cx="35" cy="-35" r="6" fill="#FF3B30"/>
    </g>

    <!-- Text Content -->
    <text x="240" y="200" font-family="-apple-system" font-size="24" font-weight="700" fill="#1D1D1F" text-anchor="middle">未找到符合条件的餐厅</text>
    <text x="240" y="240" font-family="-apple-system" font-size="16" fill="#86868B" text-anchor="middle">在当前 3km 范围内没有找到相关结果。</text>
    
    <!-- Action Buttons -->
    <g transform="translate(60, 290)">
      <!-- Button 1: Modify -->
      <rect x="0" y="0" width="170" height="50" rx="25" fill="#F2F2F7"/>
      <text x="85" y="31" font-family="-apple-system" font-size="16" font-weight="600" fill="#1D1D1F" text-anchor="middle">修改需求</text>
      
      <!-- Button 2: Expand Search -->
      <rect x="190" y="0" width="170" height="50" rx="25" fill="#007AFF"/>
      <text x="275" y="31" font-family="-apple-system" font-size="16" font-weight="600" fill="#FFFFFF" text-anchor="middle">扩大范围搜素</text>
    </g>
  </g>
</svg>
```

---

### 6. 历史记录页 (History Sheet)
*设计理念：历史记录不应完全覆盖当前工作台。采用 macOS 的 "Sheet"（模态浮层）概念。*

*   **视觉**：像是一个打开的 Finder 窗口，漂浮在背景之上。
*   **布局**：清晰的列表视图 (Table View)。每一行记录都包含时间、需求（Prompt）、最终结果（Winner）。
*   **操作**：鼠标悬停在某一行时，显示“复活”按钮（即：再次使用该需求生成转盘）。

```svg
<svg width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="modalShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="20" stdDeviation="50" flood-color="#000" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Background: Blurred Context -->
  <rect width="100%" height="100%" fill="#F5F5F7"/>
  <!-- Simulating the main app in background blurred -->
  <g filter="url(#glassBlur)" opacity="0.3">
     <rect x="60" y="60" width="440" height="780" rx="24" fill="#CCC"/>
     <circle cx="900" cy="400" r="100" fill="#CCC"/>
  </g>

  <!-- History Window (Finder Style) -->
  <g transform="translate(220, 100)">
    <!-- Window Frame -->
    <rect x="0" y="0" width="1000" height="700" rx="20" fill="#FFFFFF" filter="url(#modalShadow)"/>
    
    <!-- Title Bar -->
    <g transform="translate(0, 0)">
       <path d="M0,20 L0,0 L1000,0 L1000,20" fill="none"/> <!-- spacer -->
       <text x="500" y="45" font-family="-apple-system" font-size="18" font-weight="600" fill="#1D1D1F" text-anchor="middle">历史记录</text>
       
       <!-- Close Button (Mac Style) -->
       <g transform="translate(940, 25)">
         <circle cx="15" cy="15" r="15" fill="#F2F2F7"/>
         <path d="M10,10 L20,20 M20,10 L10,20" stroke="#8E8E93" stroke-width="2" stroke-linecap="round"/>
       </g>
    </g>

    <!-- Content Area -->
    <g transform="translate(40, 80)">
       <!-- Table Headers -->
       <text x="20" y="20" font-family="-apple-system" font-size="13" font-weight="600" fill="#86868B">时间</text>
       <text x="200" y="20" font-family="-apple-system" font-size="13" font-weight="600" fill="#86868B">我的需求</text>
       <text x="600" y="20" font-family="-apple-system" font-size="13" font-weight="600" fill="#86868B">最终去哪儿</text>
       <text x="850" y="20" font-family="-apple-system" font-size="13" font-weight="600" fill="#86868B">操作</text>
       
       <rect x="0" y="40" width="920" height="1" fill="#E5E5EA"/>

       <!-- Row 1: Hover State -->
       <g transform="translate(0, 50)">
         <rect x="0" y="0" width="920" height="70" rx="10" fill="#F2F2F7"/>
         
         <text x="20" y="40" font-family="-apple-system" font-size="15" fill="#1D1D1F">今天 12:30</text>
         
         <text x="200" y="30" font-family="-apple-system" font-size="16" font-weight="500" fill="#1D1D1F">“想吃点清淡的素食”</text>
         <text x="200" y="52" font-family="-apple-system" font-size="13" fill="#86868B">北京·朝阳区</text>
         
         <!-- Result Tag -->
         <g transform="translate(600, 18)">
            <rect width="140" height="34" rx="17" fill="#E8F5E9"/>
            <text x="20" y="22" font-family="-apple-system" font-size="14" font-weight="600" fill="#1B5E20">🌿 素心斋</text>
         </g>
         
         <!-- Action -->
         <rect x="850" y="18" width="50" height="34" rx="17" fill="#FFF" stroke="#E5E5EA"/>
         <path d="M868,26 L878,26 L875,23 M875,29 L878,26" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
       </g>

       <!-- Row 2 -->
       <g transform="translate(0, 130)">
         <text x="20" y="40" font-family="-apple-system" font-size="15" fill="#1D1D1F">昨天 18:15</text>
         <text x="200" y="30" font-family="-apple-system" font-size="16" font-weight="500" fill="#1D1D1F">“随便吃点快餐”</text>
         <text x="200" y="52" font-family="-apple-system" font-size="13" fill="#86868B">北京·望京</text>
         
         <g transform="translate(600, 18)">
            <rect width="140" height="34" rx="17" fill="#FFF3E0"/>
            <text x="20" y="22" font-family="-apple-system" font-size="14" font-weight="600" fill="#E65100">🍔 麦当劳</text>
         </g>
       </g>
       <rect x="0" y="210" width="920" height="1" fill="#F5F5F7"/>

       <!-- Row 3 -->
       <g transform="translate(0, 220)">
         <text x="20" y="40" font-family="-apple-system" font-size="15" fill="#1D1D1F">10月24日</text>
         <text x="200" y="30" font-family="-apple-system" font-size="16" font-weight="500" fill="#1D1D1F">“要排队的网红店”</text>
         <text x="200" y="52" font-family="-apple-system" font-size="13" fill="#86868B">上海·静安</text>
         
         <g transform="translate(600, 18)">
            <rect width="140" height="34" rx="17" fill="#FFEBEE"/>
            <text x="20" y="22" font-family="-apple-system" font-size="14" font-weight="600" fill="#C62828">🔥 哥老官</text>
         </g>
       </g>
    </g>
    
    <!-- Clear History Link -->
    <text x="500" y="650" font-family="-apple-system" font-size="14" fill="#FF3B30" text-anchor="middle" style="cursor:pointer">清空历史记录</text>
  </g>
</svg>
```