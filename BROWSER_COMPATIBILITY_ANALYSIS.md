# Browser Compatibility Issues - Analysis & Fix Plan

## Issues Identified

### 1. **WebGL Early Return (CRITICAL - Firefox & Non-WebGL browsers)**
**Location**: `visualization.js` line 7-10
**Problem**: If WebGL fails to initialize, the constructor returns early, preventing:
- `setupEventListeners()` from being called → buttons don't work
- `initializeUI()` from being called → UI not initialized
- All functionality breaks

**Expected**: App should work without WebGL (fallback to Canvas 2D)
**Actual**: App completely fails if WebGL unavailable

**Root Cause**: WebGL is treated as required, but the app could work with Canvas 2D fallback

---

### 2. **Canvas Sizing Mismatch (Chrome - square plots)**
**Location**: `resizeCanvasToVideoAspectRatio()` and canvas width/height attributes
**Problem**: 
- Canvas `width`/`height` attributes set directly
- CSS may scale canvas differently
- `window.innerWidth` used before page fully loaded
- Canvas display size ≠ canvas internal size → coordinates wrong

**Expected**: Canvas internal size matches CSS display size
**Actual**: Canvas may be square or wrong aspect ratio when CSS scales it

**Root Cause**: No synchronization between CSS size and canvas internal size

---

### 3. **Overlay Canvas Desynchronization (Hover box floats)**
**Location**: `drawHoverBoundingBox()` uses `overlayCanvas.width/height`
**Problem**:
- Overlay canvas size set in `resizeCanvasToVideoAspectRatio()`
- If main canvas resizes but overlay doesn't, coordinates mismatch
- Overlay uses internal size, but positioning uses CSS size

**Expected**: Overlay canvas perfectly aligned with main canvas
**Actual**: Hover box appears offset or floating above

**Root Cause**: Overlay canvas size not synchronized with main canvas display size

---

### 4. **Red Button on IB Curve Missing (Chrome)**
**Location**: `getCurveSliderScreenPosition()` uses `canvas.width/height`
**Problem**:
- Uses canvas internal width/height attributes
- If CSS scales canvas, coordinates are wrong
- Button may be drawn outside visible area

**Expected**: Red button always visible at correct position
**Actual**: Button missing or in wrong position when canvas is scaled

**Root Cause**: Using canvas internal size instead of display size for coordinates

---

### 5. **Console Opening Fixes Things (Chrome timing issue)**
**Problem**: 
- JavaScript errors may be suppressed until console opens
- Canvas sizing calculations may need a repaint to work correctly
- Timing issues with DOMContentLoaded vs actual render

**Expected**: App works immediately on page load
**Actual**: Requires console to be opened or manual refresh

**Root Cause**: Race conditions between initialization and rendering

---

### 6. **Mouse Coordinate Calculation (Hover positioning)**
**Location**: `setupHoverControls()` uses `getBoundingClientRect()`
**Problem**:
- `getBoundingClientRect()` gives CSS display size
- But calculations use canvas internal width/height
- Mismatch causes wrong cell detection

**Expected**: Mouse coordinates correctly map to cells
**Actual**: Hover detection may be off, especially when canvas is scaled

**Root Cause**: Mixing CSS coordinates with internal canvas coordinates

---

## Fix Plan (Parsimonious)

### Fix 1: Make WebGL Optional
- Don't return early if WebGL fails
- Set `this.gl = null` and continue
- Add checks before WebGL operations
- Provide Canvas 2D fallback for rendering (if needed)

### Fix 2: Synchronize Canvas Sizes
- Create `syncCanvasSize()` function that:
  - Gets actual CSS display size using `getBoundingClientRect()`
  - Sets canvas internal width/height to match
  - Updates overlay canvas to match
  - Called after resize and on window resize

### Fix 3: Use Display Size for Coordinates
- Replace all `canvas.width`/`canvas.height` with:
  - `canvas.getBoundingClientRect().width/height` for screen coordinates
  - Or store display size in variables
- Update `getCurveSliderScreenPosition()` to use display size
- Update `drawHoverBoundingBox()` to use display size

### Fix 4: Fix Initialization Timing
- Ensure all canvas elements exist before accessing them
- Use `requestAnimationFrame` for size calculations after render
- Add error boundaries around critical operations
- Log errors properly (not just console.error)

### Fix 5: Add Proper Error Handling
- Wrap WebGL operations in try-catch
- Check for null/undefined before operations
- Provide user-friendly error messages
- Don't silently fail

---

## Implementation Order

1. **Fix WebGL early return** (highest priority - breaks everything)
2. **Add canvas size synchronization** (fixes square plots and hover)
3. **Fix coordinate calculations** (fixes red button and hover box)
4. **Add error handling** (prevents silent failures)
5. **Test in Firefox and Chrome**

