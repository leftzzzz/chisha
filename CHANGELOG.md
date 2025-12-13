# Changelog

All notable changes to the "今天吃啥" project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-12-14

### Initial Release

This is the first production release of the "今天吃啥" (What to Eat Today) application.

#### Added

**Phase 1: Project Setup** (Week 1)
- Initial Next.js 14 project setup with App Router
- TypeScript 5.6 configuration with strict mode
- Tailwind CSS 3.4 integration
- ESLint and code quality tools
- Git repository initialization
- Project documentation structure

**Phase 2: Backend API Implementation** (Week 2-3)
- `/api/understand` - Natural language understanding endpoint using OpenAI GPT-4
  - Automatic keyword extraction
  - Cuisine type detection
  - Price range parsing
  - Distance parsing
  - Fallback to simple keyword extraction
- `/api/search` - Restaurant search endpoint
  - Amap (高德地图) POI search integration
  - OpenStreetMap fallback search
  - Automatic deduplication
  - Distance-based sorting
  - Rating-based filtering
- `/api/geocode` - Address to coordinates conversion
  - Amap geocoding service
  - City-level location support
- `/api/geocode/reverse` - Coordinates to address conversion
  - Reverse geocoding support
  - Detailed address information

**Libraries and Utilities**
- `lib/llm.ts` - OpenAI API wrapper with timeout and error handling
- `lib/amap.ts` - Amap API wrapper for POI search and geocoding
- `lib/osm.ts` - OpenStreetMap Nominatim API wrapper
- `lib/distance.ts` - Haversine distance calculation
- `lib/dataTransform.ts` - Data normalization and transformation
- `lib/validation.ts` - Zod schema validation
- `lib/apiResponse.ts` - Unified API response format
- `lib/logger.ts` - Structured logging utility
- `lib/withTimeout.ts` - Timeout middleware for async operations
- `lib/monitoring.ts` - Performance monitoring utilities
- `lib/api.ts` - Frontend API client with error handling and retry
- `lib/storage.ts` - LocalStorage wrapper for history management

**Phase 3: State Management** (Week 3)
- React Context + Reducer architecture
- `AppContext` for global state management
- `AppReducer` with 9 action types:
  - SET_QUERY, SET_LOCATION, SET_PARSED_PARAMS
  - SET_RESTAURANTS, SET_SELECTED_RESTAURANT
  - SET_STEP, SET_ERROR, CLEAR_ERROR, RESET
- Custom hooks:
  - `useAppState` - Application state management
  - `useLocation` - Geolocation and geocoding
  - `useRestaurantSearch` - Restaurant search flow
  - `useTurntable` - Turntable rotation logic
  - `useMediaQuery` - Responsive breakpoint detection

**Phase 4-7: Frontend Components** (Week 4-6)
- **UI Components**:
  - Button, Input, Modal, Loading, ErrorMessage, Card, Chip
- **Input Components**:
  - SearchInput - Natural language input with auto-complete
  - LocationPicker - Auto-location and manual address input
  - InspirationChips - Quick search suggestions
  - SearchPanel - Combined search interface
- **Turntable Components**:
  - Turntable - Main turntable with smooth rotation animation
  - TurntableSegment - Individual restaurant segment
  - TurntablePointer - Animated pointer
  - TurntableControls - Start/stop controls
- **Restaurant Components**:
  - RestaurantCard - Restaurant information card
  - RestaurantList - Restaurant list view
  - ResultPanel - Selected restaurant details
- **Map Components**:
  - Map - Interactive map with restaurant markers
- **Layout Components**:
  - Header - Application header with navigation
  - MobileLayout - Mobile-optimized layout
  - DesktopLayout - Desktop multi-column layout
  - Layout - Responsive layout wrapper
- **Page Components**:
  - HomePage - Main application page
  - HistoryPage - History management page
- **Utility Components**:
  - LoadingSteps - Step-by-step loading indicator

**Features**
- Natural language understanding for search queries
- Intelligent restaurant search with multiple data sources
- Fun turntable selection mechanism
- Automatic history recording (up to 100 records)
- Responsive design (mobile, tablet, desktop)
- Dark/light mode support
- Auto-location detection
- Manual location input
- Search history with statistics
- Export/import history data
- Offline support for history

**Testing**
- Unit tests for utility functions
- Component tests with React Testing Library
- API route tests
- Mock implementations for external services
- Test coverage > 70%

**Documentation**
- Comprehensive README.md
- API documentation (docs/API.md)
- Deployment guide (docs/DEPLOYMENT.md)
- Developer guide (docs/DEVELOPER-GUIDE.md)
- User guide (docs/USER-GUIDE.md)
- FAQ (docs/FAQ.md)
- Contributing guidelines (CONTRIBUTING.md)
- Phase completion reports (PHASE2-COMPLETION.md, etc.)

**Performance**
- First contentful paint < 2s
- Lighthouse performance score ≥ 90
- LLM API timeout: 15s with fallback
- Map search timeout: 10s with fallback
- Geocoding timeout: 5s
- 60fps turntable animation
- Lazy loading for components
- Image optimization
- Code splitting

**Developer Experience**
- TypeScript strict mode throughout
- Zero `any` types
- Comprehensive JSDoc comments
- ESLint for code quality
- Prettier for code formatting
- Husky for pre-commit hooks
- Hot module replacement
- Fast refresh

#### Known Limitations

- OpenAI API required for intelligent understanding (has fallback)
- Amap API limited to China region (has global OSM fallback)
- Browser LocalStorage required for history (no server storage)
- Maximum 100 history records
- No user authentication system
- No server-side history sync
- No restaurant favorites/bookmarks
- No social sharing features

#### Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari 15+
- Edge (latest)
- Mobile Safari iOS 14+
- Chrome Mobile (Android)

#### Dependencies

**Core**
- next@^14.2.0
- react@^18.3.0
- react-dom@^18.3.0
- typescript@^5.6.0

**Utilities**
- zod@^3.23.0 - Runtime validation

**Dev Dependencies**
- @testing-library/react@^14.1.2
- @testing-library/jest-dom@^6.1.5
- jest@^29.7.0
- eslint@^8.57.0
- tailwindcss@^3.4.17

#### Security

- All API keys stored in environment variables
- No sensitive data exposed to client
- Input validation on all endpoints
- XSS protection headers
- CSRF protection
- HTTPS enforced (via Vercel)

---

## [Unreleased]

### Planned Features

- [ ] Multiple map service support (Baidu Maps, Tencent Maps)
- [ ] Restaurant favorites/bookmarks
- [ ] Social sharing
- [ ] User preferences settings
- [ ] Multi-language support (English, Chinese)
- [ ] Mobile app version (React Native)
- [ ] User accounts and cloud sync
- [ ] Advanced filters (dietary restrictions, amenities)
- [ ] Restaurant photos and reviews
- [ ] Turn-by-turn navigation
- [ ] Reservation integration
- [ ] Group decision mode
- [ ] Price comparison
- [ ] Deals and coupons

---

[1.0.0]: https://github.com/your-repo/chisha/releases/tag/v1.0.0
