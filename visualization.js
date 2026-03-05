class MotionVisualizer {
    constructor() {
        this.canvas = document.getElementById('visualization-canvas');
        this.overlayCanvas = document.getElementById('overlay-canvas');
        
        // Check if canvas elements exist
        if (!this.canvas) {
            console.error('visualization-canvas element not found!');
        }
        if (!this.overlayCanvas) {
            console.error('overlay-canvas element not found!');
        }
        
        // Try to get WebGL context, but don't fail if unavailable
        if (this.canvas) {
            try {
                this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
                if (!this.gl) {
                    console.warn('WebGL not available, some features may be limited');
                    this.gl = null;
                }
            } catch (e) {
                console.warn('WebGL initialization failed:', e);
                this.gl = null;
            }
        } else {
            this.gl = null;
        }
        


        // Data storage
        this.videoData = null;
        this.colorGridData = null;
        this.gridInfo = null;
        this.betaValues = null;
        this.curveData = null;
        this.mdsData = null;
        this.referencePoint = null; // { x, y, label }
        this.pwmColormaps = {}; // Object mapping labels to PWM colormap data
        this.activePwmColormap = null; // Currently active PWM colormap label, or null if using parameter-based
        this.pwmData = {}; // Object mapping labels to PWM data (m, n, L)
        this.lexiconLabels = {}; // Object mapping labels to lexicon label arrays
        
        // Curve slider state
        this.curveSliderPosition = 0; // Index along the curve
        this.isDraggingCurveSlider = false;
        
        // Animation state
        this.isPlaying = true; // Play by default
        this.currentFrame = 0;
        this.frameRate = 30;
        this.lastFrameTime = 0;
        this.animationId = null;
        
        // View state
        this.zoom = 1.0;
        this.pan = { x: 0, y: 0 };
        this.currentParameter = 0;
        
        // Hover state
        this.hoveredCell = null; // { row, col } or null
        
        // Cell video element
        this.cellVideo = document.getElementById('cell-video');
        
        // Selected directory handle for accessing videos
        this.selectedDirectoryHandle = null;
        
        // Current data directory path (for loading videos)
        this.currentDataDirectory = null; // e.g., 'files-wr-36-qpwr-soft-dtw-0.0/'
        this.pmwLinesData = null; // Array of arrays containing line data for current beta
        this.pmwLinesColors = null; // Array of RGB triplets [r, g, b] for each line
        
        // WebGL resources
        this.shaderProgram = null;
        this.videoTexture = null;
        this.colorTexture = null;
        
        // Initialize WebGL only if available
        try {
            if (this.gl) {
                this.initializeWebGL();
            } else {
                console.warn('Running without WebGL - using fallback rendering');
            }
        } catch (e) {
            console.error('Error initializing WebGL:', e);
            this.gl = null;
        }
        
        // Setup event listeners - critical for button functionality
        try {
            this.setupEventListeners();
            console.log('Event listeners set up successfully');
        } catch (e) {
            console.error('Error setting up event listeners:', e);
            // Show error to user
            this.showError('Failed to initialize event listeners: ' + e.message);
        }
        
        // Initialize UI
        try {
            this.initializeUI();
        } catch (e) {
            console.error('Error initializing UI:', e);
        }
        
        // Sync canvas sizes after initialization
        try {
            this.syncCanvasSizes();
        } catch (e) {
            console.error('Error syncing canvas sizes:', e);
        }
        
        // Listen for window resize to sync canvas sizes
        try {
            window.addEventListener('resize', () => {
                this.syncCanvasSizes();
            });
        } catch (e) {
            console.error('Error setting up resize listener:', e);
        }
        
        console.log('MotionVisualizer initialization complete');
    }
    
    syncCanvasSizes() {
        // Sync main canvas size with CSS display size
        if (this.canvas) {
            const rect = this.canvas.getBoundingClientRect();
            const displayWidth = Math.floor(rect.width);
            const displayHeight = Math.floor(rect.height);
            
            // Only update if size actually changed to avoid unnecessary work
            if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
                this.canvas.width = displayWidth;
                this.canvas.height = displayHeight;
                
                // Update WebGL viewport if available
                if (this.gl) {
                    this.gl.viewport(0, 0, displayWidth, displayHeight);
                }
            }
        }
        
        // Sync overlay canvas to match main canvas
        if (this.overlayCanvas && this.canvas) {
            this.overlayCanvas.width = this.canvas.width;
            this.overlayCanvas.height = this.canvas.height;
        }
        
        // Sync PWM plot canvas width to match main canvas
        const pwmCanvas = document.getElementById('pwm-plot-canvas');
        if (pwmCanvas && this.canvas) {
            const pwmRect = pwmCanvas.getBoundingClientRect();
            const pwmDisplayWidth = Math.floor(pwmRect.width);
            if (pwmCanvas.width !== pwmDisplayWidth) {
                pwmCanvas.width = pwmDisplayWidth;
                // Redraw if data is loaded
                if (this.pwmData && Object.keys(this.pwmData).length > 0) {
                    this.plotPwm();
                }
            }
        }
        
        // Sync PMW lines plot canvas width to match main canvas
        const pmwLinesCanvas = document.getElementById('pmw-lines-plot-canvas');
        if (pmwLinesCanvas && this.canvas) {
            const pmwRect = pmwLinesCanvas.getBoundingClientRect();
            const pmwDisplayWidth = Math.floor(pmwRect.width);
            if (pmwLinesCanvas.width !== pmwDisplayWidth) {
                pmwLinesCanvas.width = pmwDisplayWidth;
                // Redraw if data is loaded
                if (this.pmwLinesData) {
                    this.plotPmwLines();
                }
            }
        }
    }

    initializeWebGL() {
        if (!this.gl) {
            console.error('Cannot initialize WebGL: context not available');
            return;
        }
        // Vertex shader for rendering quads
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            
            uniform mat3 u_transform;
            
            varying vec2 v_texCoord;
            
            void main() {
                vec3 transformed = u_transform * vec3(a_position, 1.0);
                gl_Position = vec4(transformed.xy, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment shader for combining color grid and video
        const fragmentShaderSource = `
            precision mediump float;
            
            varying vec2 v_texCoord;
            
            uniform sampler2D u_videoTexture;
            uniform sampler2D u_colorTexture;
            uniform float u_currentFrame;
            uniform float u_totalFrames;
            uniform vec2 u_gridSize; // m, n
            uniform vec2 u_cellSize; // cellWidth, cellHeight in pixels
            uniform vec2 u_videoSize; // width, height in pixels
            uniform float u_parameter;
            
            void main() {
                // Convert texture coordinates to pixel coordinates using video dimensions
                vec2 pixelCoord = v_texCoord * u_videoSize;
                
                // Determine which cell this pixel belongs to
                vec2 cellIndex = floor(pixelCoord / u_cellSize);
                
                // Clamp to grid bounds
                cellIndex = clamp(cellIndex, vec2(0.0), u_gridSize - 1.0);
                
                // Convert cell index to texture coordinates for color lookup
                // Note: gridSize is (n, m) but texture coordinates expect (x, y)
                vec2 colorTexCoord = (cellIndex + 0.5) / u_gridSize;
                
                // Sample color from the small color texture
                vec3 cellColor = texture2D(u_colorTexture, colorTexCoord).rgb;
                
                // Sample video frame using original texture coordinates
                vec4 videoPixel = texture2D(u_videoTexture, v_texCoord);
                
                // Use pixel intensity directly as alpha (0.0 = transparent, 1.0 = opaque)
                float videoAlpha = videoPixel.r;
                
                // Video appears as black with varying opacity
                vec3 videoColor = vec3(0.0); // black
                vec3 finalColor = mix(cellColor, videoColor, videoAlpha);
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;

        // Create and compile shaders
        this.shaderProgram = this.createShaderProgram(vertexShaderSource, fragmentShaderSource);
        
        // Create geometry for full-screen quad
        this.createQuadGeometry();
        
        // Set up WebGL state
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    }

    createShaderProgram(vertexSource, fragmentSource) {
        if (!this.gl) {
            console.error('Cannot create shader program: WebGL context not available');
            return null;
        }
        
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        
        if (!vertexShader || !fragmentShader) {
            console.error('Failed to create shaders');
            return null;
        }
        
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Shader program linking failed:', this.gl.getProgramInfoLog(program));
            this.gl.deleteProgram(program);
            return null;
        }
        
        return program;
    }

    createShader(type, source) {
        if (!this.gl) {
            console.error('Cannot create shader: WebGL context not available');
            return null;
        }
        
        const shader = this.gl.createShader(type);
        if (!shader) {
            console.error('Failed to create shader object');
            return null;
        }
        
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation failed:', this.gl.getShaderInfoLog(shader));
            this.gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }

    createQuadGeometry() {
        if (!this.gl) {
            console.error('Cannot create quad geometry: WebGL context not available');
            return;
        }
        
        const positions = new Float32Array([
            -1, -1,  0, 0,
             1, -1,  1, 0,
            -1,  1,  0, 1,
             1,  1,  1, 1
        ]);
        
        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');
        console.log('Document ready state:', document.readyState);
        
        // CRITICAL: Attach button listeners FIRST before any other setup that might fail
        // This ensures buttons work even if other initialization fails
        // Use a helper function to ensure proper binding and error handling
        
        const attachButtonHandler = (buttonId, handler) => {
            try {
                const btn = document.getElementById(buttonId);
                console.log(`Looking for button ${buttonId}:`, btn);
                if (!btn) {
                    console.error(`Button ${buttonId} not found in DOM!`);
                    return false;
                }
                // Ensure button is visible and clickable
                btn.style.cursor = 'pointer';
                btn.style.pointerEvents = 'auto';
                // Remove any existing listeners to avoid duplicates
                const newBtn = btn.cloneNode(true);
                btn.parentNode.replaceChild(newBtn, btn);
                // Attach listener to the new button
                newBtn.addEventListener('click', (e) => {
                    console.log(`Button ${buttonId} clicked!`, e);
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        handler.call(this, e);
                    } catch (err) {
                        console.error(`Error in button ${buttonId} handler:`, err);
                        alert(`Error: ${err.message}`);
                    }
                }, { capture: false, passive: false });
                console.log(`Successfully attached listener to ${buttonId}`);
                return true;
            } catch (err) {
                console.error(`Failed to attach listener to ${buttonId}:`, err);
                return false;
            }
        };

        // DTW IB model bulk loader - Button 1
        attachButtonHandler('load-dtw-model', async function(e) {
            console.log('load-dtw-model button clicked!');
            const statusEl = document.getElementById('dtw-model-status');
            try {
                if (statusEl) statusEl.textContent = 'Attempting to load from files-wr-36-qpwr-soft-dtw-0.0...';
                const loaded = await this.tryLoadDtwFromRelative();
                if (loaded) {
                    if (statusEl) statusEl.textContent = 'qpwr soft-dtw model loaded from files-wr-36-qpwr-soft-dtw-0.0';
                    return;
                }
                if (window.showDirectoryPicker) {
                    const pickerOptions = { id: 'dtw-model', startIn: 'desktop', mode: 'read' };
                    let dirHandle;
                    try {
                        dirHandle = await window.showDirectoryPicker(pickerOptions);
                    } catch (innerErr) {
                        dirHandle = await window.showDirectoryPicker();
                    }
                    await this.loadDtwModelFromDirectory(dirHandle);
                    if (statusEl) statusEl.textContent = 'qpwr soft-dtw model loaded from selected directory';
                } else {
                    if (statusEl) statusEl.textContent = 'Directory picker not supported in this browser';
                }
            } catch (e) {
                if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) {
                    if (statusEl) statusEl.textContent = 'Cancelled folder selection';
                    return;
                }
                console.error('DTW load error:', e);
                if (statusEl) statusEl.textContent = 'Failed to load qpwr soft-dtw model: ' + (e.message || 'Unknown error');
            }
        });

        // DTW IB model bulk loader - Button 2
        attachButtonHandler('load-dtw-model-2', async function(e) {
            console.log('load-dtw-model-2 button clicked!');
            const statusEl = document.getElementById('dtw-model-status-2');
            try {
                if (statusEl) statusEl.textContent = 'Attempting to load from files-wr-36-qpos-soft-dtw-0.0...';
                const loaded = await this.tryLoadDtwFromRelative2();
                if (loaded) {
                    if (statusEl) statusEl.textContent = 'qpos soft-dtw model loaded from files-wr-36-qpos-soft-dtw-0.0';
                    return;
                }
                if (window.showDirectoryPicker) {
                    const pickerOptions = { id: 'dtw-model-2', startIn: 'desktop', mode: 'read' };
                    let dirHandle;
                    try {
                        dirHandle = await window.showDirectoryPicker(pickerOptions);
                    } catch (innerErr) {
                        dirHandle = await window.showDirectoryPicker();
                    }
                    await this.loadDtwModelFromDirectory(dirHandle);
                    if (statusEl) statusEl.textContent = 'qpos soft-dtw model loaded from selected directory';
                } else {
                    if (statusEl) statusEl.textContent = 'Directory picker not supported in this browser';
                }
            } catch (e) {
                if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) {
                    if (statusEl) statusEl.textContent = 'Cancelled folder selection';
                    return;
                }
                console.error('DTW load error:', e);
                if (statusEl) statusEl.textContent = 'Failed to load qpos soft-dtw model: ' + (e.message || 'Unknown error');
            }
        });

        // DTW IB model bulk loader - Button 3
        attachButtonHandler('load-dtw-model-3', async function(e) {
            console.log('load-dtw-model-3 button clicked!');
            const statusEl = document.getElementById('dtw-model-status-3');
            try {
                if (statusEl) statusEl.textContent = 'Attempting to load from files-wr-36-qvel-soft-dtw-0.0...';
                const loaded = await this.tryLoadDtwFromRelative3();
                if (loaded) {
                    if (statusEl) statusEl.textContent = 'qvel soft-dtw model loaded from files-wr-36-qvel-soft-dtw-0.0';
                    return;
                }
                if (window.showDirectoryPicker) {
                    const pickerOptions = { id: 'dtw-model-3', startIn: 'desktop', mode: 'read' };
                    let dirHandle;
                    try {
                        dirHandle = await window.showDirectoryPicker(pickerOptions);
                    } catch (innerErr) {
                        dirHandle = await window.showDirectoryPicker();
                    }
                    await this.loadDtwModelFromDirectory(dirHandle);
                    if (statusEl) statusEl.textContent = 'qvel soft-dtw model loaded from selected directory';
                } else {
                    if (statusEl) statusEl.textContent = 'Directory picker not supported in this browser';
                }
            } catch (e) {
                if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) {
                    if (statusEl) statusEl.textContent = 'Cancelled folder selection';
                    return;
                }
                console.error('DTW load error:', e);
                if (statusEl) statusEl.textContent = 'Failed to load qvel soft-dtw model: ' + (e.message || 'Unknown error');
            }
        });

        // DTW IB model bulk loader - Button 4
        attachButtonHandler('load-dtw-model-4', async function(e) {
            console.log('load-dtw-model-4 button clicked!');
            const statusEl = document.getElementById('dtw-model-status-4');
            try {
                if (statusEl) statusEl.textContent = 'Attempting to load from files-wr-36-qfrc_actuator-soft-dtw-0.0...';
                const loaded = await this.tryLoadDtwFromRelative4();
                if (loaded) {
                    if (statusEl) statusEl.textContent = 'qfrc_actuator soft-dtw model loaded from files-wr-36-qfrc_actuator-soft-dtw-0.0';
                    return;
                }
                if (window.showDirectoryPicker) {
                    const pickerOptions = { id: 'dtw-model-4', startIn: 'desktop', mode: 'read' };
                    let dirHandle;
                    try {
                        dirHandle = await window.showDirectoryPicker(pickerOptions);
                    } catch (innerErr) {
                        dirHandle = await window.showDirectoryPicker();
                    }
                    await this.loadDtwModelFromDirectory(dirHandle);
                    if (statusEl) statusEl.textContent = 'qfrc_actuator soft-dtw model loaded from selected directory';
                } else {
                    if (statusEl) statusEl.textContent = 'Directory picker not supported in this browser';
                }
            } catch (e) {
                if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) {
                    if (statusEl) statusEl.textContent = 'Cancelled folder selection';
                    return;
                }
                console.error('DTW load error:', e);
                if (statusEl) statusEl.textContent = 'Failed to load qfrc_actuator soft-dtw model: ' + (e.message || 'Unknown error');
            }
        });
        
        // File uploads (optional if inputs exist) - moved after buttons
        try {
            const videoInput = document.getElementById('video-upload');
            if (videoInput) {
                videoInput.addEventListener('change', (e) => {
                    this.handleVideoUpload(e.target.files[0]);
                });
            }
            
            const colorInput = document.getElementById('color-upload');
            if (colorInput) {
                colorInput.addEventListener('change', (e) => {
                    this.handleColorUpload(e.target.files[0]);
                });
            }
            
            const betasInput = document.getElementById('beta-values-input');
            if (betasInput) {
                betasInput.addEventListener('change', (e) => {
                    this.handleBetaValuesUpload(e.target.files[0]);
                });
            }
            
            const curveInput = document.getElementById('curve-values-input');
            if (curveInput) {
                curveInput.addEventListener('change', (e) => {
                    this.handleCurveValuesUpload(e.target.files[0]);
                });
            }
        } catch (e) {
            console.error('Error setting up file input listeners:', e);
        }
        
        // Now set up other event listeners - wrapped in try-catch so failures don't block buttons
        // Curve slider mouse events
        try {
            this.setupCurveSliderEvents();
        } catch (e) {
            console.error('Error setting up curve slider events:', e);
        }
        
        // Mouse controls for pan
        try {
            this.setupMouseControls();
        } catch (e) {
            console.error('Error setting up mouse controls:', e);
        }
        
        // Mouse hover for cell highlighting
        try {
            this.setupHoverControls();
        } catch (e) {
            console.error('Error setting up hover controls:', e);
        }
    }

    async loadDtwModelFromDirectory(dirHandle) {
        // Store the directory handle for later use (e.g., loading pmw files)
        this.selectedDirectoryHandle = dirHandle;
        
        const readFile = async (name) => {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name === name) {
                    return await entry.getFile();
                }
            }
            throw new Error(`File not found: ${name}`);
        };
        
        const readFileOptional = async (name) => {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name === name) {
                    return await entry.getFile();
                }
            }
            return null;
        };
        
        const findFileByPattern = async (pattern) => {
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name.startsWith(pattern) && entry.name.endsWith('.npy')) {
                    return { file: await entry.getFile(), name: entry.name };
                }
            }
            return null;
        };

        const videoFile = await readFile('video_gray.npy_prepped_video.npy');
        const colorFile = await readFile('colormap_n_951.npy');
        const betasFile = await readFile('betas.npy');
        const curveFile = await readFile('IB_curve.npy');
        const mdsFile = await readFileOptional('dtw_mds.npy');
        const refPointData = await findFileByPattern('Ix_Iy_');
        const findPwmFileByLabel = async (label) => {
            const pattern = `colormap_pwm_${label}.npy`;
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name === pattern) {
                    return { file: await entry.getFile(), name: entry.name };
                }
            }
            return null;
        };

        await this.handleVideoUpload(videoFile);
        await this.handleColorUpload(colorFile);
        await this.handleBetaValuesUpload(betasFile);
        await this.handleCurveValuesUpload(curveFile);
        if (mdsFile) {
            await this.handleMdsUpload(mdsFile);
        }
        if (refPointData) {
            await this.handleReferencePointUpload(refPointData.file, refPointData.name);
            // Try to load corresponding PWM colormap
            const label = refPointData.name.replace('Ix_Iy_', '').replace('.npy', '');
            const pwmData = await findPwmFileByLabel(label);
            if (pwmData) {
                await this.handlePwmColormapUpload(pwmData.file, pwmData.name);
            }
            // Try to load PWM data and lexicon labels
            const findPwmDataFile = async (label) => {
                const pattern = `pwm_${label}.npy`;
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file' && entry.name === pattern) {
                        return { file: await entry.getFile(), name: entry.name };
                    }
                }
                return null;
            };
            const findLexiconFile = async (label) => {
                const pattern = `lexicon_labels_${label}.pkl`;
                for await (const entry of dirHandle.values()) {
                    if (entry.kind === 'file' && entry.name === pattern) {
                        return { file: await entry.getFile(), name: entry.name };
                    }
                }
                return null;
            };
            const pwmDataFile = await findPwmDataFile(label);
            const lexiconFile = await findLexiconFile(label);
            if (pwmDataFile) {
                await this.handlePwmDataUpload(pwmDataFile.file, pwmDataFile.name);
            }
            if (lexiconFile) {
                await this.handleLexiconLabelsUpload(lexiconFile.file, lexiconFile.name);
            }
        }
    }

    // Get the base path for GitHub Pages (e.g., '/repo-name/' or '/')
    getBasePath() {
        // For local file:// protocol, return an empty string so paths remain relative
        if (window.location.protocol === 'file:') {
            return '';
        }
        let pathname = window.location.pathname;
        // Remove filename if present (e.g., 'index.html')
        if (pathname.includes('/') && !pathname.endsWith('/')) {
            // Extract directory path (everything up to and including the last '/')
            pathname = pathname.substring(0, pathname.lastIndexOf('/') + 1);
        }
        // For root path (just '/'), return '/' (not '//')
        if (pathname === '/') {
            return '/';
        }
        // Ensure it ends with a slash (handles other cases)
        if (!pathname.endsWith('/')) {
            pathname += '/';
        }
        return pathname;
    }

    // Try to load directly from project-relative directory (works when served over http/https). Falls back silently on file://
    async tryLoadDtwFromRelative() {
        const basePath = this.getBasePath();
        const makeFile = async (url, name) => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) {
                    // Log but don't throw for 404s - this is expected if files don't exist
                    console.warn(`File not found (${resp.status}): ${url}`);
                    throw new Error('Failed to fetch ' + url + ' (status: ' + resp.status + ')');
                }
                const blob = await resp.blob();
                return new File([blob], name, { type: 'application/octet-stream' });
            } catch (e) {
                // Re-throw with more context
                console.warn(`Error loading file ${url}:`, e.message);
                throw e;
            }
        };
        try {
            const base = basePath + 'files-wr-36-qpwr-soft-dtw-0.0/';
            this.currentDataDirectory = 'files-wr-36-qpwr-soft-dtw-0.0/'; // Store relative path for video loading
            const videoFile = await makeFile(base + 'video_gray.npy_prepped_video.npy', 'video_gray.npy_prepped_video.npy');
            const colorFile = await makeFile(base + 'colormap_n_951.npy', 'colormap_n_951.npy');
            const betasFile = await makeFile(base + 'betas.npy', 'betas.npy');
            const curveFile = await makeFile(base + 'IB_curve.npy', 'IB_curve.npy');
            const mdsFile = await makeFile(base + 'dtw_mds.npy', 'dtw_mds.npy');

            await this.handleVideoUpload(videoFile);
            await this.handleColorUpload(colorFile);
            await this.handleBetaValuesUpload(betasFile);
            await this.handleCurveValuesUpload(curveFile);
            // Load MDS data if available (optional)
            try {
                await this.handleMdsUpload(mdsFile);
            } catch (e) {
                console.log('MDS file not available, skipping...');
            }
            // Try to load reference point file (optional)
            const refPointPatterns = ['Ix_Iy_English-Psynet.npy'];
            for (const pattern of refPointPatterns) {
                try {
                    const refFile = await makeFile(base + pattern, pattern);
                    await this.handleReferencePointUpload(refFile, pattern);
                    const label = pattern.replace('Ix_Iy_', '').replace('.npy', '');
                    // Try to load corresponding PWM colormap
                    const pwmPattern = `colormap_pwm_${label}.npy`;
                    try {
                        const pwmFile = await makeFile(base + pwmPattern, pwmPattern);
                        await this.handlePwmColormapUpload(pwmFile, pwmPattern);
                    } catch (e) {
                        // PWM colormap not found, skip
                    }
                    // Try to load PWM data and lexicon labels
                    try {
                        const pwmDataFile = await makeFile(base + `pwm_${label}.npy`, `pwm_${label}.npy`);
                        await this.handlePwmDataUpload(pwmDataFile, `pwm_${label}.npy`);
                    } catch (e) {
                        // PWM data not found, skip
                    }
                    try {
                        const lexiconFile = await makeFile(base + `lexicon_labels_${label}.pkl`, `lexicon_labels_${label}.pkl`);
                        await this.handleLexiconLabelsUpload(lexiconFile, `lexicon_labels_${label}.pkl`);
                    } catch (e) {
                        // Lexicon labels not found, skip
                    }
                    break;
                } catch (e) {
                    // Continue or skip if not found
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // Try to load directly from files-wr-36-qpos-soft-dtw-0.0 directory
    async tryLoadDtwFromRelative2() {
        const basePath = this.getBasePath();
        const makeFile = async (url, name) => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) {
                    // Log but don't throw for 404s - this is expected if files don't exist
                    console.warn(`File not found (${resp.status}): ${url}`);
                    throw new Error('Failed to fetch ' + url + ' (status: ' + resp.status + ')');
                }
                const blob = await resp.blob();
                return new File([blob], name, { type: 'application/octet-stream' });
            } catch (e) {
                // Re-throw with more context
                console.warn(`Error loading file ${url}:`, e.message);
                throw e;
            }
        };
        try {
            const base = basePath + 'files-wr-36-qpos-soft-dtw-0.0/';
            this.currentDataDirectory = 'files-wr-36-qpos-soft-dtw-0.0/'; // Store relative path for video loading
            const videoFile = await makeFile(base + 'video_gray.npy_prepped_video.npy', 'video_gray.npy_prepped_video.npy');
            const colorFile = await makeFile(base + 'colormap_n_951.npy', 'colormap_n_951.npy');
            const betasFile = await makeFile(base + 'betas.npy', 'betas.npy');
            const curveFile = await makeFile(base + 'IB_curve.npy', 'IB_curve.npy');
            const mdsFile = await makeFile(base + 'dtw_mds.npy', 'dtw_mds.npy');

            await this.handleVideoUpload(videoFile);
            await this.handleColorUpload(colorFile);
            await this.handleBetaValuesUpload(betasFile);
            await this.handleCurveValuesUpload(curveFile);
            // Load MDS data if available (optional)
            try {
                await this.handleMdsUpload(mdsFile);
            } catch (e) {
                console.log('MDS file not available, skipping...');
            }
            // Try to load reference point file (optional)
            const refPointPatterns = ['Ix_Iy_English-Psynet.npy'];
            for (const pattern of refPointPatterns) {
                try {
                    const refFile = await makeFile(base + pattern, pattern);
                    await this.handleReferencePointUpload(refFile, pattern);
                    const label = pattern.replace('Ix_Iy_', '').replace('.npy', '');
                    // Try to load corresponding PWM colormap
                    const pwmPattern = `colormap_pwm_${label}.npy`;
                    try {
                        const pwmFile = await makeFile(base + pwmPattern, pwmPattern);
                        await this.handlePwmColormapUpload(pwmFile, pwmPattern);
                    } catch (e) {
                        // PWM colormap not found, skip
                    }
                    // Try to load PWM data and lexicon labels
                    try {
                        const pwmDataFile = await makeFile(base + `pwm_${label}.npy`, `pwm_${label}.npy`);
                        await this.handlePwmDataUpload(pwmDataFile, `pwm_${label}.npy`);
                    } catch (e) {
                        // PWM data not found, skip
                    }
                    try {
                        const lexiconFile = await makeFile(base + `lexicon_labels_${label}.pkl`, `lexicon_labels_${label}.pkl`);
                        await this.handleLexiconLabelsUpload(lexiconFile, `lexicon_labels_${label}.pkl`);
                    } catch (e) {
                        // Lexicon labels not found, skip
                    }
                    break;
                } catch (e) {
                    // Continue or skip if not found
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // Try to load directly from files-wr-36-qvel-soft-dtw-0.0 directory
    async tryLoadDtwFromRelative3() {
        const basePath = this.getBasePath();
        const makeFile = async (url, name) => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) {
                    // Log but don't throw for 404s - this is expected if files don't exist
                    console.warn(`File not found (${resp.status}): ${url}`);
                    throw new Error('Failed to fetch ' + url + ' (status: ' + resp.status + ')');
                }
                const blob = await resp.blob();
                return new File([blob], name, { type: 'application/octet-stream' });
            } catch (e) {
                // Re-throw with more context
                console.warn(`Error loading file ${url}:`, e.message);
                throw e;
            }
        };
        try {
            const base = basePath + 'files-wr-36-qvel-soft-dtw-0.0/';
            this.currentDataDirectory = 'files-wr-36-qvel-soft-dtw-0.0/'; // Store relative path for video loading
            const videoFile = await makeFile(base + 'video_gray.npy_prepped_video.npy', 'video_gray.npy_prepped_video.npy');
            const colorFile = await makeFile(base + 'colormap_n_951.npy', 'colormap_n_951.npy');
            const betasFile = await makeFile(base + 'betas.npy', 'betas.npy');
            const curveFile = await makeFile(base + 'IB_curve.npy', 'IB_curve.npy');
            const mdsFile = await makeFile(base + 'dtw_mds.npy', 'dtw_mds.npy');

            await this.handleVideoUpload(videoFile);
            await this.handleColorUpload(colorFile);
            await this.handleBetaValuesUpload(betasFile);
            await this.handleCurveValuesUpload(curveFile);
            // Load MDS data if available (optional)
            try {
                await this.handleMdsUpload(mdsFile);
            } catch (e) {
                console.log('MDS file not available, skipping...');
            }
            // Try to load reference point file (optional)
            const refPointPatterns = ['Ix_Iy_English-Psynet.npy'];
            for (const pattern of refPointPatterns) {
                try {
                    const refFile = await makeFile(base + pattern, pattern);
                    await this.handleReferencePointUpload(refFile, pattern);
                    const label = pattern.replace('Ix_Iy_', '').replace('.npy', '');
                    // Try to load corresponding PWM colormap
                    const pwmPattern = `colormap_pwm_${label}.npy`;
                    try {
                        const pwmFile = await makeFile(base + pwmPattern, pwmPattern);
                        await this.handlePwmColormapUpload(pwmFile, pwmPattern);
                    } catch (e) {
                        // PWM colormap not found, skip
                    }
                    // Try to load PWM data and lexicon labels
                    try {
                        const pwmDataFile = await makeFile(base + `pwm_${label}.npy`, `pwm_${label}.npy`);
                        await this.handlePwmDataUpload(pwmDataFile, `pwm_${label}.npy`);
                    } catch (e) {
                        // PWM data not found, skip
                    }
                    try {
                        const lexiconFile = await makeFile(base + `lexicon_labels_${label}.pkl`, `lexicon_labels_${label}.pkl`);
                        await this.handleLexiconLabelsUpload(lexiconFile, `lexicon_labels_${label}.pkl`);
                    } catch (e) {
                        // Lexicon labels not found, skip
                    }
                    break;
                } catch (e) {
                    // Continue or skip if not found
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }

    // Try to load directly from files-wr-36-qfrc_actuator-soft-dtw-0.0 directory
    async tryLoadDtwFromRelative4() {
        const basePath = this.getBasePath();
        const makeFile = async (url, name) => {
            try {
                const resp = await fetch(url);
                if (!resp.ok) {
                    // Log but don't throw for 404s - this is expected if files don't exist
                    console.warn(`File not found (${resp.status}): ${url}`);
                    throw new Error('Failed to fetch ' + url + ' (status: ' + resp.status + ')');
                }
                const blob = await resp.blob();
                return new File([blob], name, { type: 'application/octet-stream' });
            } catch (e) {
                // Re-throw with more context
                console.warn(`Error loading file ${url}:`, e.message);
                throw e;
            }
        };
        try {
            const base = basePath + 'files-wr-36-qfrc_actuator-soft-dtw-0.0/';
            this.currentDataDirectory = 'files-wr-36-qfrc_actuator-soft-dtw-0.0/'; // Store relative path for video loading
            const videoFile = await makeFile(base + 'video_gray.npy_prepped_video.npy', 'video_gray.npy_prepped_video.npy');
            const colorFile = await makeFile(base + 'colormap_n_951.npy', 'colormap_n_951.npy');
            const betasFile = await makeFile(base + 'betas.npy', 'betas.npy');
            const curveFile = await makeFile(base + 'IB_curve.npy', 'IB_curve.npy');
            const mdsFile = await makeFile(base + 'dtw_mds.npy', 'dtw_mds.npy');

            await this.handleVideoUpload(videoFile);
            await this.handleColorUpload(colorFile);
            await this.handleBetaValuesUpload(betasFile);
            await this.handleCurveValuesUpload(curveFile);
            // Load MDS data if available (optional)
            try {
                await this.handleMdsUpload(mdsFile);
            } catch (e) {
                console.log('MDS file not available, skipping...');
            }
            // Try to load reference point file (optional)
            const refPointPatterns = ['Ix_Iy_English-Psynet.npy'];
            for (const pattern of refPointPatterns) {
                try {
                    const refFile = await makeFile(base + pattern, pattern);
                    await this.handleReferencePointUpload(refFile, pattern);
                    const label = pattern.replace('Ix_Iy_', '').replace('.npy', '');
                    // Try to load corresponding PWM colormap
                    const pwmPattern = `colormap_pwm_${label}.npy`;
                    try {
                        const pwmFile = await makeFile(base + pwmPattern, pwmPattern);
                        await this.handlePwmColormapUpload(pwmFile, pwmPattern);
                    } catch (e) {
                        // PWM colormap not found, skip
                    }
                    // Try to load PWM data and lexicon labels
                    try {
                        const pwmDataFile = await makeFile(base + `pwm_${label}.npy`, `pwm_${label}.npy`);
                        await this.handlePwmDataUpload(pwmDataFile, `pwm_${label}.npy`);
                    } catch (e) {
                        // PWM data not found, skip
                    }
                    try {
                        const lexiconFile = await makeFile(base + `lexicon_labels_${label}.pkl`, `lexicon_labels_${label}.pkl`);
                        await this.handleLexiconLabelsUpload(lexiconFile, `lexicon_labels_${label}.pkl`);
                    } catch (e) {
                        // Lexicon labels not found, skip
                    }
                    break;
                } catch (e) {
                    // Continue or skip if not found
                }
            }
            return true;
        } catch (e) {
            return false;
        }
    }
    
    setupCurveSliderEvents() {
        const curveCanvas = document.getElementById('curve-canvas');
        if (!curveCanvas) {
            console.warn('curve-canvas not found, skipping curve slider events');
            return;
        }
        
        curveCanvas.addEventListener('mousedown', (e) => {
            if (!this.curveData) return;
            
            const rect = curveCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            // Check if click is on the reference point
            const refPointPos = this.getReferencePointScreenPosition();
            if (refPointPos) {
                const distance = Math.sqrt(Math.pow(x - refPointPos.x, 2) + Math.pow(y - refPointPos.y, 2));
                if (distance <= 8) { // 8px radius for click detection
                    this.togglePwmColormap();
                    e.preventDefault();
                    return;
                }
            }
            
            // Check if click is near the slider circle
            const circlePos = this.getCurveSliderScreenPosition();
            if (circlePos) {
                const distance = Math.sqrt(Math.pow(x - circlePos.x, 2) + Math.pow(y - circlePos.y, 2));
                if (distance <= 8) { // 8px radius for click detection
                    this.isDraggingCurveSlider = true;
                    curveCanvas.style.cursor = 'grabbing';
                    e.preventDefault();
                }
            }
        });
        
        curveCanvas.addEventListener('mousemove', (e) => {
            if (!this.curveData) return;
            
            const rect = curveCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            if (this.isDraggingCurveSlider) {
                this.updateCurveSliderFromMouse(x, y);
                e.preventDefault();
            } else {
                // Check if hovering over reference point
                const refPointPos = this.getReferencePointScreenPosition();
                if (refPointPos) {
                    const distance = Math.sqrt(Math.pow(x - refPointPos.x, 2) + Math.pow(y - refPointPos.y, 2));
                    if (distance <= 8) {
                        curveCanvas.style.cursor = 'pointer';
                        return;
                    }
                }
                
                // Check if hovering over slider circle
                const circlePos = this.getCurveSliderScreenPosition();
                if (circlePos) {
                    const distance = Math.sqrt(Math.pow(x - circlePos.x, 2) + Math.pow(y - circlePos.y, 2));
                    curveCanvas.style.cursor = distance <= 8 ? 'grab' : 'default';
                } else {
                    curveCanvas.style.cursor = 'default';
                }
            }
        });
        
        curveCanvas.addEventListener('mouseup', () => {
            this.isDraggingCurveSlider = false;
            curveCanvas.style.cursor = 'default';
        });
        
        curveCanvas.addEventListener('mouseleave', () => {
            this.isDraggingCurveSlider = false;
            curveCanvas.style.cursor = 'default';
        });
    }
    
    getCurveSliderScreenPosition() {
        if (!this.curveData) return null;
        
        const canvas = document.getElementById('curve-canvas');
        if (!canvas) return null;
        
        const { x, y } = this.curveData;
        
        // Get the current curve position
        const currentIndex = this.curveSliderPosition;
        if (currentIndex >= x.length || currentIndex < 0) return null;
        
        const currentX = x[currentIndex];
        const currentY = y[currentIndex];
        
        // Use actual display size, not internal canvas size
        const rect = canvas.getBoundingClientRect();
        const displayWidth = rect.width;
        const displayHeight = rect.height;
        
        // Calculate the same scaling as in plotCurve
        const xMin = Math.min(...x);
        const xMax = Math.max(...x);
        const yMin = Math.min(...y);
        const yMax = Math.max(...y);
        
        const margin = 40;
        const plotWidth = displayWidth - 2 * margin;
        const plotHeight = displayHeight - 2 * margin;
        
        const scaleX = (val) => margin + ((val - xMin) / (xMax - xMin)) * plotWidth;
        const scaleY = (val) => displayHeight - margin - ((val - yMin) / (yMax - yMin)) * plotHeight;
        
        return {
            x: scaleX(currentX),
            y: scaleY(currentY)
        };
    }
    
    updateCurveSliderFromMouse(mouseX, mouseY) {
        if (!this.curveData) return;
        
        const { x, y } = this.curveData;
        
        // Find the closest point on the curve to the mouse position
        let closestIndex = 0;
        let closestDistance = Infinity;
        
        const canvas = document.getElementById('curve-canvas');
        const xMin = Math.min(...x);
        const xMax = Math.max(...x);
        const yMin = Math.min(...y);
        const yMax = Math.max(...y);
        
        const margin = 40;
        const plotWidth = canvas.width - 2 * margin;
        const plotHeight = canvas.height - 2 * margin;
        
        const scaleX = (val) => margin + ((val - xMin) / (xMax - xMin)) * plotWidth;
        const scaleY = (val) => canvas.height - margin - ((val - yMin) / (yMax - yMin)) * plotHeight;
        
        for (let i = 0; i < x.length; i++) {
            const screenX = scaleX(x[i]);
            const screenY = scaleY(y[i]);
            const distance = Math.sqrt(Math.pow(mouseX - screenX, 2) + Math.pow(mouseY - screenY, 2));
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }
        
        this.curveSliderPosition = closestIndex;
        
        // Update the parameter to match the curve position
        // Map curve position to parameter range
        const parameterRange = this.colorGridData ? this.colorGridData.shape[3] : 10;
        const mappedParameter = Math.floor((closestIndex / (x.length - 1)) * (parameterRange - 1));
        
        this.currentParameter = Math.max(0, Math.min(parameterRange - 1, mappedParameter));
        
        // Update display and color texture
        this.updateColorTexture();
        this.updateLegend();
        
        // Load and update pmw lines data for new beta index
        this.loadPmwLinesData(this.currentParameter);
        
        // Redraw the curve with the updated circle position
        this.plotCurve();
        this.plotPwm(); // Also update PWM plot
    }
    
    updateCurveSliderFromParameter() {
        if (!this.curveData) return;
        
        const { x } = this.curveData;
        const parameterRange = this.colorGridData ? this.colorGridData.shape[3] : 10;
        
        // Map parameter value to curve position
        const normalizedParameter = this.currentParameter / (parameterRange - 1);
        this.curveSliderPosition = Math.floor(normalizedParameter * (x.length - 1));
        
        // Load and update pmw lines data for new beta index
        this.loadPmwLinesData(this.currentParameter);
        
        // Redraw the curve with the updated circle position
        this.plotCurve();
    }
    
    getReferencePointScreenPosition() {
        if (!this.referencePoint || !this.curveData) return null;
        
        const canvas = document.getElementById('curve-canvas');
        const { x, y } = this.curveData;
        
        // Calculate the same scaling as in plotCurve
        const xMin = Math.min(...x);
        const xMax = Math.max(...x);
        const yMin = Math.min(...y);
        const yMax = Math.max(...y);
        
        const margin = 40;
        const plotWidth = canvas.width - 2 * margin;
        const plotHeight = canvas.height - 2 * margin;
        
        const scaleX = (val) => margin + ((val - xMin) / (xMax - xMin)) * plotWidth;
        const scaleY = (val) => canvas.height - margin - ((val - yMin) / (yMax - yMin)) * plotHeight;
        
        return {
            x: scaleX(this.referencePoint.x),
            y: scaleY(this.referencePoint.y)
        };
    }
    
    togglePwmColormap() {
        if (!this.referencePoint || !this.pwmColormaps[this.referencePoint.label]) {
            return;
        }
        
        // Toggle: if currently using this PWM colormap, switch back to parameter-based
        if (this.activePwmColormap === this.referencePoint.label) {
            this.activePwmColormap = null;
        } else {
            this.activePwmColormap = this.referencePoint.label;
        }
        
        console.log('PWM colormap toggled:', this.activePwmColormap);
        
        // Update color textures and plots
        this.updateColorTexture();
        this.plotMds();
        // Redraw curve to update marker visibility
        this.plotCurve();
    }

    setupMouseControls() {
        if (!this.canvas) {
            console.warn('Main canvas not found, skipping mouse controls');
            return;
        }
        let isDragging = false;
        let lastMousePos = { x: 0, y: 0 };
        
        this.canvas.addEventListener('mousedown', (e) => {
            isDragging = true;
            lastMousePos = { x: e.clientX, y: e.clientY };
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - lastMousePos.x;
            const deltaY = e.clientY - lastMousePos.y;
            
            this.pan.x += deltaX / (this.canvas.width / 2) / this.zoom;
            this.pan.y -= deltaY / (this.canvas.height / 2) / this.zoom;
            
            lastMousePos = { x: e.clientX, y: e.clientY };
            this.updateTransform();
        });
        
        this.canvas.addEventListener('mouseup', () => {
            isDragging = false;
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoom *= zoomFactor;
            this.updateTransform();
        });
    }
    
    setupHoverControls() {
        if (!this.canvas) {
            console.warn('Main canvas not found, skipping hover controls');
            return;
        }
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.gridInfo) return;
            
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Convert mouse coordinates to normalized device coordinates (-1 to 1)
            const ndcX = (mouseX / this.canvas.width) * 2 - 1;
            const ndcY = -((mouseY / this.canvas.height) * 2 - 1);
            
            // Apply inverse transformation to get world coordinates
            const worldX = (ndcX - this.pan.x) / this.zoom;
            const worldY = (ndcY - this.pan.y) / this.zoom;
            
            // Convert world coordinates to cell coordinates
            // Note: world coordinates are in -1 to 1 range, so we need to map to grid
            const cellCol = Math.floor((worldX + 1) * this.gridInfo.n / 2);
            const cellRow = Math.floor((1 - worldY) * this.gridInfo.m / 2);
            
            // Check if mouse is within grid bounds
            if (cellCol >= 0 && cellCol < this.gridInfo.n && 
                cellRow >= 0 && cellRow < this.gridInfo.m) {
                const newHoveredCell = { row: cellRow, col: cellCol };
                if (!this.hoveredCell || this.hoveredCell.row !== newHoveredCell.row || this.hoveredCell.col !== newHoveredCell.col) {
                    this.hoveredCell = newHoveredCell;
                    this.loadCellVideo(cellRow, cellCol);
                    // Update MDS plot to show hover marker
                    this.plotMds();
                    // Update PWM plot
                    this.plotPwm();
                }
            } else {
                if (this.hoveredCell !== null) {
                    this.hoveredCell = null;
                    // Update MDS plot to remove hover marker
                    this.plotMds();
                    // Clear PWM plot
                    this.plotPwm();
                }
            }
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            if (this.hoveredCell !== null) {
                this.hoveredCell = null;
                // Update MDS plot to remove hover marker
                this.plotMds();
                // Clear PWM plot
                this.plotPwm();
            }
        });
    }

    async handleVideoUpload(file) {
        if (!file) return;
        
        this.showLoading(true);
        
        try {
            const buffer = await file.arrayBuffer();
            this.videoData = await this.parseNumpyArray(buffer);
            
            // Validate video data shape
            if (this.videoData.shape.length !== 4) {
                throw new Error('Video data must be 4D (height, width, channels, frames)');
            }
            
            const [height, width, channels, frames] = this.videoData.shape;
            
            if (channels !== 1) {
                throw new Error('Video must be grayscale (1 channel)');
            }
            
            // Resize canvas to match video aspect ratio
            this.resizeCanvasToVideoAspectRatio(width, height);
            
            this.updateVideoStatus(`${width}x${height}, ${frames} frames`);
            // this.updateInfo('frame-count', frames);
            
            // Create video texture
            this.createVideoTexture();
            
            // Try to determine grid info if we have both video and color data
            if (this.colorGridData) {
                this.calculateGridInfo();
            }
            
        } catch (error) {
            this.showError('Error loading video: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }
    
    resizeCanvasToVideoAspectRatio(videoWidth, videoHeight) {
        // Calculate max width to use more of the available space (accounting for sidebar ~170px)
        const availableWidth = window.innerWidth - 170; // Sidebar width + padding
        const maxWidth = Math.floor(availableWidth * 0.78); // Increased to use more space for video/line plots
        const maxHeight = 1200; // Increased to allow larger canvas
        
        // Calculate aspect ratio
        const aspectRatio = videoWidth / videoHeight;
        
        let newWidth, newHeight;
        
        if (aspectRatio > maxWidth / maxHeight) {
            // Video is wider than max aspect ratio - use full width
            newWidth = maxWidth;
            newHeight = maxWidth / aspectRatio;
        } else {
            // Video is taller than max aspect ratio - use full height
            newHeight = maxHeight;
            newWidth = maxHeight * aspectRatio;
        }
        
        // Resize the main canvas
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        
        // Resize the overlay canvas to match
        if (this.overlayCanvas) {
            this.overlayCanvas.width = newWidth;
            this.overlayCanvas.height = newHeight;
        }
        
        // Resize the PWM plot canvas to match the width
        const pwmCanvas = document.getElementById('pwm-plot-canvas');
        if (pwmCanvas) {
            pwmCanvas.width = newWidth;
            // Redraw the PWM plot to update axes
            this.plotPwm();
        }
        
        // Resize the PMW lines plot canvas to match the width
        const pmwLinesCanvas = document.getElementById('pmw-lines-plot-canvas');
        if (pmwLinesCanvas) {
            pmwLinesCanvas.width = newWidth;
            // Redraw the PMW lines plot to update axes
            this.plotPmwLines();
        }
        
        // Update WebGL viewport to match new canvas size
        if (this.gl) {
            this.gl.viewport(0, 0, newWidth, newHeight);
        }
        
        // Force a re-render to update the display
        if (this.gridInfo) {
            this.startRendering();
        }
        
        console.log(`Canvas resized to ${newWidth}x${newHeight} to match video aspect ratio ${videoWidth}x${videoHeight}`);
    }

    async handleColorUpload(file) {
        if (!file) return;
        
        this.showLoading(true);
        
        try {
            const buffer = await file.arrayBuffer();
            this.colorGridData = await this.parseNumpyArray(buffer);
            
            // Validate color grid shape
            if (this.colorGridData.shape.length !== 4) {
                throw new Error('Color grid must be 4D (m, n, channels, parameters)');
            }
            
            const [m, n, channels, parameters] = this.colorGridData.shape;
            
            if (channels !== 3) {
                throw new Error('Color grid must be RGB (3 channels)');
            }
            
            this.updateColorStatus(`${m}x${n} grid, ${parameters} parameters`);
            // this.updateInfo('param-count', parameters);
            
            // Initialize to the largest parameter index if not already set
            if (parameters > 0 && (this.currentParameter === 0 || this.currentParameter >= parameters)) {
                this.currentParameter = parameters - 1;
                console.log('Initialized to largest parameter index from color grid:', this.currentParameter);
                
                // Update color texture
                this.updateColorTexture();
                // Load pmw lines if beta values are available
                if (this.betaValues && this.betaValues.length > 0) {
                    this.loadPmwLinesData(this.currentParameter);
                }
                // Sync curve slider position with current parameter
                if (this.curveData) {
                    this.updateCurveSliderFromParameter();
                }
            }
            
            // Update parameter slider
            // const slider = document.getElementById('parameter-slider');
            // slider.max = parameters - 1;
            // slider.disabled = false;
            
            // Create color texture
            this.createColorTexture();
            
            // Try to determine grid info if we have both video and color data
            if (this.videoData) {
                this.calculateGridInfo();
            }
            
        } catch (error) {
            this.showError('Error loading color grid: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async handleBetaValuesUpload(file) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('Beta file upload started:', file.name, file.size, 'bytes');
        
        try {
            const buffer = await file.arrayBuffer();
            console.log('Buffer loaded, size:', buffer.byteLength);
            
            const betaData = await this.parseNumpyArray(buffer);
            console.log('Parsed numpy array:', betaData.shape, betaData.dtype);
            
            // Validate beta values shape - should be 1D array
            if (betaData.shape.length !== 1) {
                throw new Error(`Beta values must be a 1D array, got ${betaData.shape.length}D with shape [${betaData.shape.join(', ')}]`);
            }
            
            // Convert to regular JavaScript array for easier access
            this.betaValues = Array.from(betaData.data);
            console.log('Beta values loaded:', this.betaValues.length, 'values');
            console.log('First few values:', this.betaValues.slice(0, 5));
            
            // Initialize to the largest parameter index (based on color grid data if available, otherwise beta values)
            if (this.colorGridData && this.colorGridData.shape.length === 4) {
                const [m, n, channels, parameters] = this.colorGridData.shape;
                if (parameters > 0) {
                    this.currentParameter = parameters - 1;
                    console.log('Initialized to largest parameter index from color grid:', this.currentParameter);
                }
            } else if (this.betaValues.length > 0) {
                this.currentParameter = this.betaValues.length - 1;
                console.log('Initialized to largest beta value at index:', this.currentParameter);
            }
            
            // Update color texture and load pmw lines if data is already loaded
            if (this.colorGridData) {
                this.updateColorTexture();
            }
            // loadPmwLinesData will handle checking if data is available
            this.loadPmwLinesData(this.currentParameter);
            // Sync curve slider position with current parameter (this also calls plotCurve)
            if (this.curveData) {
                this.updateCurveSliderFromParameter();
            }
            
            this.updateBetaStatus(`${this.betaValues.length} beta values loaded`);
            
            // Update parameter display if we have a current parameter
            // this.updateParameterDisplay();
            
        } catch (error) {
            console.error('Beta upload error:', error);
            this.showError('Error loading beta values: ' + error.message);
            this.updateBetaStatus('Failed to load beta values');
        } finally {
            this.showLoading(false);
        }
    }

    // updateParameterDisplay() {
    //     const displayValue = this.betaValues && this.betaValues.length > this.currentParameter
    //         ? this.betaValues[this.currentParameter].toFixed(4)
    //         : this.currentParameter;
        
        // document.getElementById('parameter-value').textContent = displayValue;
    // }

    updateBetaStatus(status) {
        const statusElement = document.getElementById('beta-status');
        if (statusElement) {
            statusElement.textContent = status;
            if (status.includes('Failed') || status.includes('Error')) {
                statusElement.style.color = '#f44336';
            } else if (status.includes('loaded')) {
                statusElement.style.color = '#4caf50';
            } else {
                statusElement.style.color = '#bbb';
            }
        } else {
            console.error('Beta status element not found');
        }
    }

    async handleCurveValuesUpload(file) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('Curve file upload started:', file.name, file.size, 'bytes');
        
        try {
            const buffer = await file.arrayBuffer();
            console.log('Buffer loaded, size:', buffer.byteLength);
            
            const curveData = await this.parseNumpyArray(buffer);
            console.log('Parsed numpy array:', curveData.shape, curveData.dtype);
            
            // Validate curve data shape - should be 2D array with 2 rows
            if (curveData.shape.length !== 2 || curveData.shape[0] !== 2) {
                throw new Error(`Curve values must be a 2D array with 2 rows (x and y), got shape [${curveData.shape.join(', ')}]`);
            }
            
            // Extract x and y values
            const numPoints = curveData.shape[1];
            const xValues = Array.from(curveData.data.slice(0, numPoints));
            const yValues = Array.from(curveData.data.slice(numPoints, numPoints * 2));
            
            this.curveData = { x: xValues, y: yValues };
            console.log('Curve data loaded:', numPoints, 'points');
            console.log('X range:', Math.min(...xValues), 'to', Math.max(...xValues));
            console.log('Y range:', Math.min(...yValues), 'to', Math.max(...yValues));
            
            this.updateCurveStatus(`${numPoints} data points loaded`);
            this.plotCurve();
            this.updateCurveSliderFromParameter();
            
        } catch (error) {
            console.error('Curve upload error:', error);
            this.showError('Error loading curve values: ' + error.message);
            this.updateCurveStatus('Failed to load curve values');
        } finally {
            this.showLoading(false);
        }
    }

    async handleReferencePointUpload(file, filename) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('Reference point file upload started:', file.name);
        
        try {
            const buffer = await file.arrayBuffer();
            const refData = await this.parseNumpyArray(buffer);
            console.log('Parsed reference point array:', refData.shape, refData.dtype);
            
            // Validate reference point data - should be 1D array with 2 values
            if (refData.shape.length !== 1 || refData.shape[0] !== 2) {
                throw new Error(`Reference point must be a 1D array with 2 values, got shape [${refData.shape.join(', ')}]`);
            }
            
            // Extract coordinates
            const x = refData.data[0];
            const y = refData.data[1];
            
            // Extract label from filename (everything after 'Ix_Iy_')
            const label = filename.replace('Ix_Iy_', '').replace('.npy', '');
            
            this.referencePoint = { x, y, label };
            console.log('Reference point loaded:', this.referencePoint);
            
            // Update legend and redraw curve to show the new point
            this.updateLegend();
            this.plotCurve();
            
            // Try to load corresponding PWM colormap if available
            const pwmFilename = `colormap_pwm_${label}.npy`;
            // PWM colormap will be loaded separately when loading model files
            
        } catch (error) {
            console.error('Reference point upload error:', error);
            this.showError('Error loading reference point: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async handlePwmColormapUpload(file, filename) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('PWM colormap file upload started:', file.name);
        
        try {
            const buffer = await file.arrayBuffer();
            const pwmData = await this.parseNumpyArray(buffer);
            console.log('Parsed PWM colormap array:', pwmData.shape, pwmData.dtype);
            
            // Validate PWM colormap shape - should be 3D array (m, n, 3)
            if (pwmData.shape.length !== 3 || pwmData.shape[2] !== 3) {
                throw new Error(`PWM colormap must be a 3D array with shape (m, n, 3), got shape [${pwmData.shape.join(', ')}]`);
            }
            
            // Extract label from filename (everything after 'colormap_pwm_')
            const label = filename.replace('colormap_pwm_', '').replace('.npy', '');
            
            // Store the PWM colormap with the label
            this.pwmColormaps[label] = {
                data: pwmData.data,
                shape: pwmData.shape,
                dtype: pwmData.dtype
            };
            
            console.log('PWM colormap loaded for label:', label);
            
        } catch (error) {
            console.error('PWM colormap upload error:', error);
            this.showError('Error loading PWM colormap: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async handlePwmDataUpload(file, filename) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('PWM data file upload started:', file.name);
        
        try {
            const buffer = await file.arrayBuffer();
            const pwmData = await this.parseNumpyArray(buffer);
            console.log('Parsed PWM data array:', pwmData.shape, pwmData.dtype);
            
            // Validate PWM data shape - should be 3D array (m, n, L)
            if (pwmData.shape.length !== 3) {
                throw new Error(`PWM data must be a 3D array with shape (m, n, L), got shape [${pwmData.shape.join(', ')}]`);
            }
            
            // Extract label from filename (everything after 'pwm_')
            const label = filename.replace('pwm_', '').replace('.npy', '');
            
            // Store the PWM data with the label
            this.pwmData[label] = {
                data: pwmData.data,
                shape: pwmData.shape,
                dtype: pwmData.dtype
            };
            
            console.log('PWM data loaded for label:', label);
            
        } catch (error) {
            console.error('PWM data upload error:', error);
            this.showError('Error loading PWM data: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    async handleLexiconLabelsUpload(file, filename) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('Lexicon labels file upload started:', file.name);
        
        try {
            const buffer = await file.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            
            // Extract label from filename
            const label = filename.replace('lexicon_labels_', '').replace('.pkl', '');
            
            // Parse pickle file - try multiple approaches
            const labels = [];
            
            // Approach 1: Try to decode as UTF-8 and extract quoted strings
            const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            const stringMatches = text.match(/'([^']+)'/g) || text.match(/"([^"]+)"/g);
            if (stringMatches && stringMatches.length > 0) {
                stringMatches.forEach(match => {
                    const str = match.slice(1, -1);
                    if (str.length > 0 && str.length < 200 && !str.includes('\x00')) {
                        labels.push(str);
                    }
                });
            }
            
            // Approach 2: Look for readable strings in the binary data
            if (labels.length === 0) {
                let currentString = '';
                for (let i = 0; i < bytes.length; i++) {
                    const byte = bytes[i];
                    // Printable ASCII range or common UTF-8 start bytes
                    if ((byte >= 0x20 && byte < 0x7F) || (byte >= 0xC0 && byte < 0xF0)) {
                        currentString += String.fromCharCode(byte);
                    } else {
                        if (currentString.length > 2 && currentString.length < 200) {
                            // Check if it looks like a word (contains letters)
                            if (/[a-zA-Z]/.test(currentString)) {
                                labels.push(currentString);
                            }
                        }
                        currentString = '';
                    }
                }
                // Add last string if exists
                if (currentString.length > 2 && currentString.length < 200 && /[a-zA-Z]/.test(currentString)) {
                    labels.push(currentString);
                }
            }
            
            // Remove duplicates and filter
            const uniqueLabels = [...new Set(labels)].filter(l => l.length > 0 && l.length < 200);
            
            if (uniqueLabels.length > 0) {
                this.lexiconLabels[label] = uniqueLabels;
                console.log('Lexicon labels loaded:', uniqueLabels.length, 'labels for', label);
            } else {
                console.warn('Could not parse pickle file, labels may be empty');
                this.lexiconLabels[label] = [];
            }
            
        } catch (error) {
            console.error('Lexicon labels upload error:', error);
            this.showError('Error loading lexicon labels: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    updateCurveStatus(status) {
        const statusElement = document.getElementById('curve-status');
        if (statusElement) {
            statusElement.textContent = status;
            if (status.includes('Failed') || status.includes('Error')) {
                statusElement.style.color = '#f44336';
            } else if (status.includes('loaded')) {
                statusElement.style.color = '#4caf50';
            } else {
                statusElement.style.color = '#bbb';
            }
        }
        
        const graphInfo = document.getElementById('graph-info');
        if (graphInfo) {
            if (status.includes('loaded')) {
                const xRange = `X: ${Math.min(...this.curveData.x).toFixed(2)} to ${Math.max(...this.curveData.x).toFixed(2)}`;
                const yRange = `Y: ${Math.min(...this.curveData.y).toFixed(2)} to ${Math.max(...this.curveData.y).toFixed(2)}`;
                graphInfo.textContent = `${status} | ${xRange} | ${yRange}`;
            } else {
                graphInfo.textContent = status;
            }
        }
    }

    plotCurve() {
        if (!this.curveData) return;
        
        const canvas = document.getElementById('curve-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const { x, y } = this.curveData;
        
        // Use actual display size, not internal canvas size
        const rect = canvas.getBoundingClientRect();
        const displayWidth = Math.floor(rect.width);
        const displayHeight = Math.floor(rect.height);
        
        // Sync canvas internal size to display size
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
        }
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Calculate ranges and scales
        const xMin = Math.min(...x);
        const xMax = Math.max(...x);
        const yMin = Math.min(...y);
        const yMax = Math.max(...y);
        
        const margin = 40;
        const plotWidth = canvas.width - 2 * margin;
        const plotHeight = canvas.height - 2 * margin;
        
        // Scale functions
        const scaleX = (val) => margin + ((val - xMin) / (xMax - xMin)) * plotWidth;
        const scaleY = (val) => canvas.height - margin - ((val - yMin) / (yMax - yMin)) * plotHeight;
        
        // Draw axes
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // X axis
        ctx.moveTo(margin, canvas.height - margin);
        ctx.lineTo(canvas.width - margin, canvas.height - margin);
        // Y axis
        ctx.moveTo(margin, margin);
        ctx.lineTo(margin, canvas.height - margin);
        ctx.stroke();
        
        // Draw filled area above the curve with diagonal hatching
        // First, fill with light gray background
        ctx.fillStyle = '#f0f0f0'; // Light gray background
        ctx.beginPath();
        // Start at first point on curve
        ctx.moveTo(scaleX(x[0]), scaleY(y[0]));
        // Draw along the curve
        for (let i = 1; i < x.length; i++) {
            ctx.lineTo(scaleX(x[i]), scaleY(y[i]));
        }
        // Go up to top of plot area
        ctx.lineTo(scaleX(x[x.length - 1]), margin);
        // Go across the top
        ctx.lineTo(scaleX(x[0]), margin);
        // Close the path
        ctx.closePath();
        ctx.fill();
        
        // Create diagonal hatching pattern
        ctx.strokeStyle = '#999999'; // Darker gray for hatching (more distinguishable)
        ctx.lineWidth = 0.5;
        const hatchingSpacing = 4; // Spacing between diagonal lines
        
        // Create a clipping region for the area above the curve
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(scaleX(x[0]), scaleY(y[0]));
        for (let i = 1; i < x.length; i++) {
            ctx.lineTo(scaleX(x[i]), scaleY(y[i]));
        }
        ctx.lineTo(scaleX(x[x.length - 1]), margin);
        ctx.lineTo(scaleX(x[0]), margin);
        ctx.closePath();
        ctx.clip();
        
        // Draw diagonal lines at 45 degrees across the entire plot area
        // The clipping will automatically handle the boundaries
        const plotTop = margin;
        const plotBottom = canvas.height - margin;
        const plotLeft = margin;
        const plotRight = canvas.width - margin;
        const plotWidth2 = plotRight - plotLeft;
        const plotHeight2 = plotBottom - plotTop;
        
        // Draw lines from top-left to bottom-right (reversed orientation: '\')
        // Calculate how many lines we need to cover the area
        const diagonalDistance = plotWidth2 + plotHeight2;
        const numLines = Math.ceil(diagonalDistance / hatchingSpacing);
        
        for (let i = -numLines; i <= numLines; i++) {
            const offset = i * hatchingSpacing;
            ctx.beginPath();
            
            // For a 45-degree line going from top-left to bottom-right:
            // Line equation: y = plotTop + (x - plotLeft) + offset
            // Or simplified: y = plotTop - plotLeft + x + offset
            
            // Find intersection points with plot boundaries
            // Left edge: x = plotLeft
            const yAtLeft = plotTop + offset;
            // Right edge: x = plotRight  
            const yAtRight = plotTop - plotLeft + plotRight + offset;
            // Top edge: y = plotTop
            const xAtTop = plotLeft - offset;
            // Bottom edge: y = plotBottom
            const xAtBottom = plotLeft + (plotBottom - plotTop) - offset;
            
            // Determine valid start and end points
            let startX = null, startY = null, endX = null, endY = null;
            
            // Check which edges the line intersects
            if (yAtLeft >= plotTop && yAtLeft <= plotBottom) {
                startX = plotLeft;
                startY = yAtLeft;
            } else if (xAtTop >= plotLeft && xAtTop <= plotRight) {
                startX = xAtTop;
                startY = plotTop;
            }
            
            if (yAtRight >= plotTop && yAtRight <= plotBottom) {
                endX = plotRight;
                endY = yAtRight;
            } else if (xAtBottom >= plotLeft && xAtBottom <= plotRight) {
                endX = xAtBottom;
                endY = plotBottom;
            }
            
            // Draw the line if we have valid endpoints
            if (startX !== null && endX !== null) {
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                ctx.stroke();
            }
        }
        
        ctx.restore(); // Restore clipping
        
        // Draw curve
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(scaleX(x[0]), scaleY(y[0]));
        for (let i = 1; i < x.length; i++) {
            ctx.lineTo(scaleX(x[i]), scaleY(y[i]));
        }
        ctx.stroke();
        
        // Draw axis labels
        ctx.fillStyle = '#333';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        
        // X-axis label
        ctx.fillText('Complexity I(M;W)', canvas.width / 2, canvas.height - 5);
        
        // Y-axis label
        ctx.save();
        ctx.translate(15, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Accuracy I(W;U)', 0, 0);
        ctx.restore();
        
        // Draw the red circle slider
        const circlePos = this.getCurveSliderScreenPosition();
        if (circlePos) {
            ctx.fillStyle = '#ff4444';
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(circlePos.x, circlePos.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
        }
        
        // Draw reference point if available
        if (this.referencePoint) {
            const refX = scaleX(this.referencePoint.x);
            const refY = scaleY(this.referencePoint.y);
            
            // Check if point is within plot bounds
            if (refX >= margin && refX <= canvas.width - margin && 
                refY >= margin && refY <= canvas.height - margin) {
                
                // Check if this reference point is currently active (clicked)
                const isActive = this.activePwmColormap === this.referencePoint.label;
                
                // Draw marker around point if active (clicked)
                if (isActive) {
                    ctx.strokeStyle = '#0000ff'; // Blue border matching the point color
                    ctx.fillStyle = 'transparent';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(refX, refY, 10, 0, 2 * Math.PI); // Larger circle for marker
                    ctx.stroke();
                }
                
                // Draw point
                ctx.fillStyle = '#0000ff'; // Blue color for reference point
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(refX, refY, 5, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            }
        }
        
        // Draw legend in bottom right of the plot
        this.drawLegendOnCanvas(ctx, canvas, margin);
        
        // Clear HTML legend section (legend is now on canvas)
        this.updateLegend();
    }
    
    drawLegendOnCanvas(ctx, canvas, margin) {
        // Defensive checks
        if (!ctx || !canvas || margin === undefined) {
            console.warn('drawLegendOnCanvas: Missing required parameters');
            return;
        }
        
        const legendPadding = 10;
        const legendItemHeight = 16;
        const legendItemSpacing = 3;
        const legendSymbolSize = 12;
        const legendFontSize = 11;
        
        // Calculate legend items
        const legendItems = [];
        
        // Add hatched area legend (unachievable region)
        if (this.curveData) {
            legendItems.push({
                type: 'hatched',
                label: 'Unachievable region'
            });
        }
        
        // Add reference point legend if available
        if (this.referencePoint) {
            legendItems.push({
                type: 'circle',
                color: '#0000ff',
                label: this.referencePoint.label || 'Reference'
            });
        }
        
        // Add beta value legend for red dot on curve
        if (this.betaValues && this.betaValues.length > this.currentParameter) {
            const betaValue = this.betaValues[this.currentParameter].toFixed(4);
            legendItems.push({
                type: 'circle',
                color: '#ff4444',
                label: `encoder q(w|m) for β = ${betaValue}`
            });
        }
        
        if (legendItems.length === 0) return;
        
        try {
            // Calculate legend dimensions
            ctx.font = `${legendFontSize}px Arial`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            
            let maxTextWidth = 0;
            legendItems.forEach(item => {
                const textWidth = ctx.measureText(item.label).width;
                if (textWidth > maxTextWidth) maxTextWidth = textWidth;
            });
            
            const legendWidth = legendSymbolSize + 8 + maxTextWidth + legendPadding * 2;
            const legendHeight = legendItems.length * legendItemHeight + (legendItems.length - 1) * legendItemSpacing + legendPadding * 2;
            
            // Position in bottom right
            const legendX = canvas.width - margin - legendWidth;
            const legendY = canvas.height - margin - legendHeight;
            
            // Ensure legend fits within canvas bounds
            if (legendX < 0 || legendY < 0) {
                console.warn('Legend would be outside canvas bounds, adjusting position');
                return;
            }
            
            // Draw background with slight transparency
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.fillRect(legendX, legendY, legendWidth, legendHeight);
            
            // Draw legend items
            let currentY = legendY + legendPadding;
            
            legendItems.forEach(item => {
            const symbolX = legendX + legendPadding;
            const symbolY = currentY + legendItemHeight / 2;
            const textX = symbolX + legendSymbolSize + 8;
            const textY = symbolY;
            
            if (item.type === 'hatched') {
                // Draw hatched pattern with clipping to prevent bleeding
                ctx.save();
                
                // Set clipping region to the square
                const squareX = symbolX;
                const squareY = symbolY - legendSymbolSize / 2;
                const squareSize = legendSymbolSize;
                ctx.beginPath();
                ctx.rect(squareX, squareY, squareSize, squareSize);
                ctx.clip();
                
                // Draw background
                ctx.fillStyle = '#f0f0f0';
                ctx.fillRect(squareX, squareY, squareSize, squareSize);
                
                // Draw hatching lines (clipped to square)
                ctx.strokeStyle = '#999999';
                ctx.lineWidth = 0.5;
                for (let i = -squareSize; i < squareSize * 2; i += 2) {
                    ctx.beginPath();
                    ctx.moveTo(squareX + i, squareY + squareSize);
                    ctx.lineTo(squareX + i + squareSize, squareY);
                    ctx.stroke();
                }
                
                ctx.restore();
                
                // Draw border around the square
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.strokeRect(symbolX, symbolY - legendSymbolSize / 2, legendSymbolSize, legendSymbolSize);
            } else if (item.type === 'circle') {
                // Draw circle
                ctx.fillStyle = item.color;
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(symbolX + legendSymbolSize / 2, symbolY, legendSymbolSize / 2 - 1, 0, 2 * Math.PI);
                ctx.fill();
                ctx.stroke();
            }
            
            // Draw text
            ctx.fillStyle = '#333';
            ctx.fillText(item.label, textX, textY);
            
            currentY += legendItemHeight + legendItemSpacing;
            });
        } catch (error) {
            console.error('Error drawing legend on canvas:', error);
        }
    }

    updateLegend() {
        // Legend is now drawn directly on the IB plot canvas
        // Hide and clear the HTML legend section
        const legendSection = document.getElementById('legend-section');
        if (legendSection) {
            legendSection.innerHTML = '';
            legendSection.style.display = 'none';
        }
    }

    async handleMdsUpload(file) {
        if (!file) return;
        
        this.showLoading(true);
        console.log('MDS file upload started:', file.name, file.size, 'bytes');
        
        try {
            const buffer = await file.arrayBuffer();
            console.log('Buffer loaded, size:', buffer.byteLength);
            
            const mdsData = await this.parseNumpyArray(buffer);
            console.log('Parsed numpy array:', mdsData.shape, mdsData.dtype);
            
            // Validate MDS data shape - should be 3D array (m, n, 2)
            if (mdsData.shape.length !== 3 || mdsData.shape[2] !== 2) {
                throw new Error(`MDS data must be a 3D array with shape (m, n, 2), got shape [${mdsData.shape.join(', ')}]`);
            }
            
            // Store the MDS data
            const [m, n, coords] = mdsData.shape;
            this.mdsData = {
                m: m,
                n: n,
                coords: mdsData.data, // Full flattened array
                shape: mdsData.shape
            };
            
            console.log('MDS data loaded:', m, 'x', n, 'grid');
            
            // Plot the MDS coordinates
            this.plotMds();
            
        } catch (error) {
            console.error('MDS upload error:', error);
            this.showError('Error loading MDS data: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    plotMds() {
        if (!this.mdsData || !this.colorGridData) return;
        
        const canvas = document.getElementById('mds-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const { m, n, coords } = this.mdsData;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Extract x and y coordinates from the flattened array
        // Data is stored as (m, n, 2) - row major order
        // For each (row, col), coordinates are at indices: (row * n + col) * 2 and (row * n + col) * 2 + 1
        const xCoords = [];
        const yCoords = [];
        
        for (let row = 0; row < m; row++) {
            for (let col = 0; col < n; col++) {
                const idx = (row * n + col) * 2;
                xCoords.push(coords[idx]);
                yCoords.push(coords[idx + 1]);
            }
        }
        
        // Calculate ranges for scaling
        const xMin = Math.min(...xCoords);
        const xMax = Math.max(...xCoords);
        const yMin = Math.min(...yCoords);
        const yMax = Math.max(...yCoords);
        
        const margin = 40;
        const plotWidth = canvas.width - 2 * margin;
        const plotHeight = canvas.height - 2 * margin;
        
        // Scale functions
        const scaleX = (val) => margin + ((val - xMin) / (xMax - xMin || 1)) * plotWidth;
        const scaleY = (val) => canvas.height - margin - ((val - yMin) / (yMax - yMin || 1)) * plotHeight;
        
        // Draw axes
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // X axis
        ctx.moveTo(margin, canvas.height - margin);
        ctx.lineTo(canvas.width - margin, canvas.height - margin);
        // Y axis
        ctx.moveTo(margin, margin);
        ctx.lineTo(margin, canvas.height - margin);
        ctx.stroke();
        
        // Draw axis labels
        ctx.fillStyle = '#333';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        
        // X-axis label
        ctx.fillText('MDS Dimension 1', canvas.width / 2, canvas.height - 5);
        
        // Y-axis label
        ctx.save();
        ctx.translate(15, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('MDS Dimension 2', 0, 0);
        ctx.restore();
        
        // Get color grid dimensions
        const [gridM, gridN, channels, parameters] = this.colorGridData.shape;
        const currentParam = this.currentParameter;
        
        // Plot each point with color from color grid
        for (let row = 0; row < m; row++) {
            for (let col = 0; col < n; col++) {
                const pointIndex = row * n + col;
                const x = xCoords[pointIndex];
                const y = yCoords[pointIndex];
                
                // Skip if coordinates are invalid (NaN or undefined)
                if (isNaN(x) || isNaN(y) || x === undefined || y === undefined) continue;
                
                // Get RGB color - use PWM colormap if active, otherwise use parameter-based
                let r, g, b;
                
                if (this.activePwmColormap && this.pwmColormaps[this.activePwmColormap]) {
                    const pwmColormap = this.pwmColormaps[this.activePwmColormap];
                    const [pwmM, pwmN, pwmChannels] = pwmColormap.shape;
                    const gridRow = Math.min(gridM - 1 - row, pwmM - 1);
                    const gridCol = Math.min(col, pwmN - 1);
                    
                    // PWM colormap shape: (m, n, 3)
                    const idx = gridRow * (pwmN * pwmChannels) + gridCol * pwmChannels;
                    r = pwmColormap.data[idx + 0];
                    g = pwmColormap.data[idx + 1];
                    b = pwmColormap.data[idx + 2];
                } else {
                    // Use parameter-based colors from colorGridData
                    const gridRow = Math.min(gridM - 1 - row, gridM - 1);
                    const gridCol = Math.min(col, gridN - 1);
                    
                    r = this.colorGridData.data[gridRow * (gridN * channels * parameters) + 
                                                 gridCol * (channels * parameters) + 
                                                 0 * parameters + 
                                                 currentParam];
                    g = this.colorGridData.data[gridRow * (gridN * channels * parameters) + 
                                                 gridCol * (channels * parameters) + 
                                                 1 * parameters + 
                                                 currentParam];
                    b = this.colorGridData.data[gridRow * (gridN * channels * parameters) + 
                                                 gridCol * (channels * parameters) + 
                                                 2 * parameters + 
                                                 currentParam];
                }
                
                // Convert to 0-255 range and draw point
                const r255 = Math.floor(Math.max(0, Math.min(1, r)) * 255);
                const g255 = Math.floor(Math.max(0, Math.min(1, g)) * 255);
                const b255 = Math.floor(Math.max(0, Math.min(1, b)) * 255);
                
                ctx.fillStyle = `rgb(${r255}, ${g255}, ${b255})`;
                ctx.beginPath();
                ctx.arc(scaleX(x), scaleY(y), 3, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
        
        // Draw red circle marker on hovered cell if applicable
        if (this.hoveredCell) {
            const { row, col } = this.hoveredCell;
            // Make sure the hovered cell is within the MDS data bounds
            if (row >= 0 && row < m && col >= 0 && col < n) {
                const pointIndex = row * n + col;
                const x = xCoords[pointIndex];
                const y = yCoords[pointIndex];
                
                // Skip if coordinates are invalid
                if (!isNaN(x) && !isNaN(y) && x !== undefined && y !== undefined) {
                    // Draw a red circle marker with transparent center on the point
                    ctx.strokeStyle = '#ff0000';
                    ctx.fillStyle = 'transparent';
                    ctx.lineWidth = 3;
                    ctx.beginPath();
                    ctx.arc(scaleX(x), scaleY(y), 6, 0, 2 * Math.PI); // radius 6, centered on point
                    ctx.stroke();
                }
            }
        }
    }

    plotPwm() {
        const canvas = document.getElementById('pwm-plot-canvas');
        if (!canvas) return;
        
        // Match the width of the visualization canvas
        const vizCanvas = document.getElementById('visualization-canvas');
        if (vizCanvas && canvas.width !== vizCanvas.width) {
            canvas.width = vizCanvas.width;
        }
        
        const ctx = canvas.getContext('2d');
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Plot dimensions
        const margin = { top: 20, right: 20, bottom: 80, left: 40 };
        const plotWidth = canvas.width - margin.left - margin.right;
        const plotHeight = canvas.height - margin.top - margin.bottom;
        
        // Always draw axes and axis labels (even when no cell is hovered)
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // X axis
        ctx.moveTo(margin.left, canvas.height - margin.bottom);
        ctx.lineTo(canvas.width - margin.right, canvas.height - margin.bottom);
        // Y axis
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, canvas.height - margin.bottom);
        ctx.stroke();
        
        // Draw axis labels (always visible)
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('lexicon', canvas.width / 2, canvas.height - 10);
        
        ctx.save();
        ctx.translate(15, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('p(w|m)', 0, 0);
        ctx.restore();
        
        // Try to find PWM data for any loaded label (for now, use first available)
        // This is needed to draw the x-axis ticks and labels even without hover
        const labels = Object.keys(this.pwmData);
        let lexiconLabels = null;
        let numTicks = 0;
        
        if (labels.length > 0) {
            const label = labels[0]; // Use first available label
            const pwmData = this.pwmData[label];
            lexiconLabels = this.lexiconLabels[label];
            
            if (pwmData && lexiconLabels) {
                const [m, n, L] = pwmData.shape;
                numTicks = L;
            }
        }
        
        // Always draw x-axis ticks and labels (if we have lexicon data)
        if (numTicks > 0 && lexiconLabels) {
            // Draw x-axis ticks
            for (let i = 0; i < numTicks; i++) {
                const x = margin.left + (i / (numTicks - 1 || 1)) * plotWidth;
                ctx.beginPath();
                ctx.moveTo(x, canvas.height - margin.bottom);
                ctx.lineTo(x, canvas.height - margin.bottom + 5);
                ctx.stroke();
            }
            
            // Draw x-axis labels (vertically oriented)
            ctx.fillStyle = '#000'; // Darker color for better visibility
            ctx.font = '12px Arial'; // Increased from 8px for better visibility
            ctx.textAlign = 'right'; // Align to right so the last letter is at a fixed position
            ctx.textBaseline = 'alphabetic';
            
            // Fixed distance from tick mark to the last letter of each label
            const labelDistance = 8; // Reduced by 80% from 40
            
            for (let i = 0; i < lexiconLabels.length && i < numTicks; i++) {
                const tickX = margin.left + (i / (numTicks - 1 || 1)) * plotWidth;
                
                ctx.save();
                // Translate to the tick position, then move down by labelDistance
                ctx.translate(tickX, canvas.height - margin.bottom + labelDistance);
                ctx.rotate(-Math.PI / 2);
                // With textAlign: 'right', the right edge (last letter) will be at (0, 0)
                // After rotation, this means the last letter is at labelDistance from the tick
                ctx.fillText(lexiconLabels[i], 0, 0);
                ctx.restore();
            }
        }
        
        // Only draw data line if we have a hovered cell and PWM data
        if (!this.hoveredCell) return;
        
        if (labels.length === 0) return;
        
        const label = labels[0]; // Use first available label
        const pwmData = this.pwmData[label];
        
        if (!pwmData || !lexiconLabels) return;
        
        const { row, col } = this.hoveredCell;
        const [m, n, L] = pwmData.shape;
        
        // Check bounds
        if (row < 0 || row >= m || col < 0 || col >= n) return;
        
        // Extract values for this cell: (row, col, :)
        // NumPy array indexing: row * (n * L) + col * L + l
        const values = [];
        for (let l = 0; l < L; l++) {
            const idx = row * (n * L) + col * L + l;
            values.push(pwmData.data[idx]);
        }
        
        // Calculate ranges
        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal || 1;
        
        // Draw line plot with markers
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        
        for (let i = 0; i < values.length; i++) {
            const x = margin.left + (i / (values.length - 1 || 1)) * plotWidth;
            const y = canvas.height - margin.bottom - ((values[i] - minVal) / range) * plotHeight;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // Draw point markers
        ctx.fillStyle = '#000000';
        for (let i = 0; i < values.length; i++) {
            const x = margin.left + (i / (values.length - 1 || 1)) * plotWidth;
            const y = canvas.height - margin.bottom - ((values[i] - minVal) / range) * plotHeight;
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // Find and display top 3 words with their probabilities
        const wordProbs = [];
        for (let i = 0; i < values.length && i < lexiconLabels.length; i++) {
            wordProbs.push({
                word: lexiconLabels[i],
                prob: values[i],
                index: i
            });
        }
        
        // Sort by probability (descending) and take top 3
        wordProbs.sort((a, b) => b.prob - a.prob);
        const top3 = wordProbs.slice(0, 3);
        
        // Display top 3 words with probabilities
        ctx.fillStyle = '#333';
        ctx.font = '14px Arial';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        // Position in the left area of the plot, next to the y-axis
        const textX = margin.left + 5; // Just to the right of the y-axis
        const textY = margin.top + 5;
        const lineHeight = 18;
        
        // Calculate max text width for background rectangle
        let maxWidth = ctx.measureText('Top 3 words:').width;
        top3.forEach((item) => {
            const probText = item.prob.toFixed(4);
            const text = `${item.word}: ${probText}`;
            const width = ctx.measureText(text).width;
            if (width > maxWidth) maxWidth = width;
        });
        
        // Draw a semi-transparent background for better readability
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(textX - 3, textY - 2, maxWidth + 20, (top3.length + 1) * lineHeight + 4);
        
        ctx.fillStyle = '#333';
        ctx.fillText('Top 3 words:', textX, textY);
        top3.forEach((item, idx) => {
            const yPos = textY + (idx + 1) * lineHeight;
            const probText = item.prob.toFixed(4);
            ctx.fillText(`${idx + 1}. ${item.word}: ${probText}`, textX, yPos);
        });
    }

    async parseNumpyArray(buffer) {
        // Simple numpy array parser for .npy files
        const dataView = new DataView(buffer);
        
        // Check magic number
        const magic = new Uint8Array(buffer, 0, 6);
        const magicString = String.fromCharCode(...magic);
        
        if (magicString !== '\x93NUMPY') {
            throw new Error('Not a valid numpy file');
        }
        
        // Read header
        const headerLen = dataView.getUint16(8, true);
        const headerBytes = new Uint8Array(buffer, 10, headerLen);
        const header = String.fromCharCode(...headerBytes);
        
        // Parse header to get shape and dtype
        const shapeMatch = header.match(/'shape':\s*\(([^)]+)\)/);
        const dtypeMatch = header.match(/'descr':\s*'([^']+)'/);
        
        if (!shapeMatch || !dtypeMatch) {
            throw new Error('Unable to parse numpy header');
        }
        
        const shape = shapeMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0).map(s => parseInt(s));
        const dtype = dtypeMatch[1];
        
        // Read data
        const dataOffset = 10 + headerLen;
        let data;
        
        if (dtype.includes('f4')) {
            data = new Float32Array(buffer, dataOffset);
        } else if (dtype.includes('f8')) {
            data = new Float64Array(buffer, dataOffset);
        } else if (dtype.includes('u1')) {
            data = new Uint8Array(buffer, dataOffset);
        } else {
            throw new Error('Unsupported data type: ' + dtype);
        }
        
        return { data, shape, dtype };
    }

    async parseNumpyArrayWithPickle(buffer) {
        // Parse numpy array that may contain pickled Python objects (like lists of arrays)
        const dataView = new DataView(buffer);
        
        // Check magic number
        const magic = new Uint8Array(buffer, 0, 6);
        const magicString = String.fromCharCode(...magic);
        
        if (magicString !== '\x93NUMPY') {
            throw new Error('Not a valid numpy file');
        }
        
        // Read header
        const headerLen = dataView.getUint16(8, true);
        const headerBytes = new Uint8Array(buffer, 10, headerLen);
        const header = String.fromCharCode(...headerBytes);
        
        // Check if it contains pickle data
        const hasPickle = header.includes("'allow_pickle': True") || header.includes("'allow_pickle':True");
        const shapeMatch = header.match(/'shape':\s*\(([^)]+)\)/);
        const dtypeMatch = header.match(/'descr':\s*'([^']+)'/);
        
        if (!shapeMatch || !dtypeMatch) {
            throw new Error('Unable to parse numpy header');
        }
        
        const shape = shapeMatch[1].split(',').map(s => s.trim()).filter(s => s.length > 0).map(s => parseInt(s));
        const dtype = dtypeMatch[1];
        
        // Read data
        const dataOffset = 10 + headerLen;
        
        // If it's object dtype with pickle, we need to parse the pickle data
        if (hasPickle || dtype.includes('O') || dtype.includes('object')) {
            // For now, return the raw buffer and let the caller handle it
            // We'll need to parse the pickle format manually
            const dataBytes = new Uint8Array(buffer, dataOffset);
            return { data: dataBytes, shape, dtype, isPickle: true, buffer: buffer, dataOffset: dataOffset };
        } else {
            // Regular array parsing
            let data;
            if (dtype.includes('f4')) {
                data = new Float32Array(buffer, dataOffset);
            } else if (dtype.includes('f8')) {
                data = new Float64Array(buffer, dataOffset);
            } else if (dtype.includes('u1')) {
                data = new Uint8Array(buffer, dataOffset);
            } else {
                throw new Error('Unsupported data type: ' + dtype);
            }
            return { data, shape, dtype, isPickle: false };
        }
    }

    async loadPmwLinesData(betaIndex) {
        if (!this.currentDataDirectory) {
            console.log('No data directory set, cannot load pmw lines data');
            this.pmwLinesData = null;
            this.plotPmwLines();
            return;
        }

        try {
            const filename = `pmw_beta_${betaIndex}_lines.npy`;
            
            let file = null;
            
            // Try to load using directory handle first (works with file:// protocol)
            if (this.selectedDirectoryHandle) {
                try {
                    // Navigate to the pmw_data subdirectory
                    const pmwDataDir = await this.selectedDirectoryHandle.getDirectoryHandle('pmw_data');
                    file = await pmwDataDir.getFileHandle(filename).then(h => h.getFile());
                    console.log('Loaded pmw lines data using directory handle');
                } catch (e) {
                    console.log('Could not load from directory handle, trying fetch:', e.message);
                    // Fall through to fetch method
                }
            }
            
            // If directory handle method didn't work, try fetch (works with HTTP/HTTPS)
            if (!file) {
                // Check if we're on file:// protocol - fetch won't work
                if (window.location.protocol === 'file:') {
                    // On file://, we can't use fetch, so we can't load the file
                    // This is expected - the user needs to either use a web server or select a directory
                    throw new Error('Cannot load files via fetch on file:// protocol. Please serve the files over HTTP/HTTPS or use directory selection.');
                }
                
                // Ensure proper path construction - remove trailing slash from currentDataDirectory if present
                const baseDir = this.currentDataDirectory.endsWith('/') 
                    ? this.currentDataDirectory.slice(0, -1) 
                    : this.currentDataDirectory;
                const basePath = this.getBasePath();
                const filepath = basePath + `${baseDir}/pmw_data/${filename}`;
                
                console.log('Loading pmw lines data from:', filepath);
                
                try {
                    const response = await fetch(filepath);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch ${filepath}: ${response.status} ${response.statusText}`);
                    }
                    const blob = await response.blob();
                    file = new File([blob], filename, { type: 'application/octet-stream' });
                } catch (fetchError) {
                    // If fetch fails, it might be a CORS issue or file not found
                    throw new Error(`Failed to load pmw lines data: ${fetchError.message}. Make sure you're serving the files over HTTP/HTTPS, not opening the HTML file directly.`);
                }
            }
            const buffer = await file.arrayBuffer();
            
            // Try to parse as numpy array with pickle support
            const parsed = await this.parseNumpyArrayWithPickle(buffer);
            
            if (parsed.isPickle) {
                // Parse pickle format - this is a simplified parser for lists of numpy arrays
                // The pickle format stores Python objects, and a list of arrays will be stored
                // as a sequence of array data structures
                console.log('Parsing pickle format for pmw lines data');
                
                // For now, try to extract arrays from the pickle data
                // This is a simplified approach - full pickle parsing is complex
                const arrays = await this.parsePickledArrays(parsed.buffer, parsed.dataOffset);
                this.pmwLinesData = arrays;
                console.log(`Loaded ${arrays.length} arrays from pmw lines data`);
            } else {
                // Regular array - convert to list of arrays based on shape
                console.log('Parsing regular numpy array format');
                const arrays = this.convertArrayToLineArrays(parsed.data, parsed.shape);
                this.pmwLinesData = arrays;
                console.log(`Converted to ${arrays.length} line arrays`);
            }
            
            // Now load the corresponding RGB colors
            await this.loadPmwLinesColors(betaIndex);
            
            // Plot the data
            this.plotPmwLines();
            
        } catch (error) {
            // Check if it's a "file not found" error - this is expected if the file doesn't exist
            const isNotFound = error.message.includes('Failed to fetch') || 
                              error.message.includes('404') ||
                              error.message.includes('not found') ||
                              error.message.includes('File not found');
            
            if (isNotFound) {
                // File doesn't exist - this is okay, just log at debug level
                console.log(`pmw lines data file not found for beta ${betaIndex} (this is okay if the file doesn't exist)`);
            } else {
                // Other error - log as warning
                console.warn('Error loading pmw lines data for beta index', betaIndex, ':', error.message);
                console.warn('File path attempted:', `${this.currentDataDirectory}pmw_data/pmw_beta_${betaIndex}_lines.npy`);
            }
            this.pmwLinesData = null;
            this.pmwLinesColors = null;
            this.plotPmwLines(); // Still plot (empty) to clear previous data
        }
    }

    async loadPmwLinesColors(betaIndex) {
        if (!this.currentDataDirectory) {
            this.pmwLinesColors = null;
            return;
        }

        try {
            const filename = `pmw_beta_${betaIndex}_rgb.npy`;
            
            let file = null;
            
            // Try to load using directory handle first (works with file:// protocol)
            if (this.selectedDirectoryHandle) {
                try {
                    // Navigate to the pmw_rgbs subdirectory
                    const pmwRgbsDir = await this.selectedDirectoryHandle.getDirectoryHandle('pmw_rgbs');
                    file = await pmwRgbsDir.getFileHandle(filename).then(h => h.getFile());
                    console.log('Loaded pmw RGB colors using directory handle');
                } catch (e) {
                    console.log('Could not load RGB colors from directory handle, trying fetch:', e.message);
                    // Fall through to fetch method
                }
            }
            
            // If directory handle method didn't work, try fetch (works with HTTP/HTTPS)
            if (!file) {
                // Check if we're on file:// protocol - fetch won't work
                if (window.location.protocol === 'file:') {
                    // On file://, we can't use fetch, so we can't load the file
                    this.pmwLinesColors = null;
                    return;
                }
                
                // Ensure proper path construction - remove trailing slash from currentDataDirectory if present
                const baseDir = this.currentDataDirectory.endsWith('/') 
                    ? this.currentDataDirectory.slice(0, -1) 
                    : this.currentDataDirectory;
                const basePath = this.getBasePath();
                const filepath = basePath + `${baseDir}/pmw_rgbs/${filename}`;
                
                console.log('Loading pmw RGB colors from:', filepath);
                
                try {
                    const response = await fetch(filepath);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch ${filepath}: ${response.status} ${response.statusText}`);
                    }
                    const blob = await response.blob();
                    file = new File([blob], filename, { type: 'application/octet-stream' });
                } catch (fetchError) {
                    // If fetch fails, RGB file might not exist - that's okay
                    console.log('RGB colors file not found, using default colors');
                    this.pmwLinesColors = null;
                    return;
                }
            }
            
            const buffer = await file.arrayBuffer();
            const parsed = await this.parseNumpyArray(buffer);
            
            // Parse RGB array - should be shape (num_lines, 3) or (3, num_lines)
            let rgbColors = [];
            
            if (parsed.shape.length === 2) {
                if (parsed.shape[1] === 3) {
                    // Format: (num_lines, 3) - each row is an RGB triplet
                    const numLines = parsed.shape[0];
                    const dataArray = Array.from(parsed.data);
                    
                    for (let i = 0; i < numLines; i++) {
                        const r = dataArray[i * 3];
                        const g = dataArray[i * 3 + 1];
                        const b = dataArray[i * 3 + 2];
                        
                        // Check if values are in 0-1 range and multiply by 255 if needed
                        const rVal = r <= 1.0 ? Math.round(r * 255) : Math.round(r);
                        const gVal = g <= 1.0 ? Math.round(g * 255) : Math.round(g);
                        const bVal = b <= 1.0 ? Math.round(b * 255) : Math.round(b);
                        
                        rgbColors.push([rVal, gVal, bVal]);
                    }
                } else if (parsed.shape[0] === 3) {
                    // Format: (3, num_lines) - RGB as separate rows
                    const numLines = parsed.shape[1];
                    const dataArray = Array.from(parsed.data);
                    
                    for (let i = 0; i < numLines; i++) {
                        const r = dataArray[i];
                        const g = dataArray[i + numLines];
                        const b = dataArray[i + numLines * 2];
                        
                        // Check if values are in 0-1 range and multiply by 255 if needed
                        const rVal = r <= 1.0 ? Math.round(r * 255) : Math.round(r);
                        const gVal = g <= 1.0 ? Math.round(g * 255) : Math.round(g);
                        const bVal = b <= 1.0 ? Math.round(b * 255) : Math.round(b);
                        
                        rgbColors.push([rVal, gVal, bVal]);
                    }
                } else {
                    console.warn('Unexpected RGB array shape:', parsed.shape);
                    this.pmwLinesColors = null;
                    return;
                }
            } else {
                console.warn('Unexpected RGB array dimensions:', parsed.shape);
                this.pmwLinesColors = null;
                return;
            }
            
            this.pmwLinesColors = rgbColors;
            console.log(`Loaded ${rgbColors.length} RGB color triplets`);
            
        } catch (error) {
            console.log('Error loading pmw RGB colors:', error.message);
            this.pmwLinesColors = null;
        }
    }

    async parsePickledArrays(buffer, dataOffset) {
        // Simplified pickle parser for lists of numpy arrays
        // This is a basic implementation - may need refinement based on actual data format
        const arrays = [];
        const bytes = new Uint8Array(buffer, dataOffset);
        
        // Look for numpy array markers in the pickle data
        // Pickle format uses specific opcodes, but we'll look for numpy array signatures
        let i = 0;
        while (i < bytes.length - 10) {
            // Look for numpy magic number '\x93NUMPY'
            if (bytes[i] === 0x93 && bytes[i+1] === 0x4E && bytes[i+2] === 0x55 && 
                bytes[i+3] === 0x4D && bytes[i+4] === 0x50 && bytes[i+5] === 0x59) {
                try {
                    // Found a numpy array, try to parse it
                    const arrayBuffer = buffer.slice(dataOffset + i);
                    const parsed = await this.parseNumpyArray(arrayBuffer);
                    const values = Array.from(parsed.data);
                    arrays.push(values);
                    // Skip past this array (approximate)
                    const headerLen = new DataView(buffer, dataOffset + i + 8).getUint16(0, true);
                    const arraySize = parsed.data.length * (parsed.dtype.includes('f8') ? 8 : 4);
                    i += 10 + headerLen + arraySize;
                } catch (e) {
                    i++;
                }
            } else {
                i++;
            }
        }
        
        // If we didn't find arrays using the above method, try a different approach
        // The pickle format might store the arrays differently
        if (arrays.length === 0) {
            console.warn('Could not parse pickle format, trying alternative method');
            // Try to find arrays by looking for repeated patterns or structure
            // For now, return empty - may need to implement full pickle parser
        }
        
        return arrays;
    }

    convertArrayToLineArrays(data, shape) {
        // Convert a numpy array to a list of line arrays
        // If shape is (num_lines, num_points), return array of arrays
        const arrays = [];
        
        if (shape.length === 1) {
            // Single array - return as single line
            arrays.push(Array.from(data));
        } else if (shape.length === 2) {
            // 2D array - each row is a line
            const [numLines, numPoints] = shape;
            for (let i = 0; i < numLines; i++) {
                const lineData = [];
                for (let j = 0; j < numPoints; j++) {
                    lineData.push(data[i * numPoints + j]);
                }
                arrays.push(lineData);
            }
        } else {
            console.warn('Unexpected shape for pmw lines data:', shape);
        }
        
        return arrays;
    }

    plotPmwLines() {
        const canvas = document.getElementById('pmw-lines-plot-canvas');
        if (!canvas) {
            console.log('pmw-lines-plot-canvas not found');
            return;
        }

        // Match width with pwm plot canvas
        const pwmCanvas = document.getElementById('pwm-plot-canvas');
        if (pwmCanvas && canvas.width !== pwmCanvas.width) {
            canvas.width = pwmCanvas.width;
        }

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const margin = { top: 20, right: 20, bottom: 60, left: 40 }; // Increased bottom margin to prevent label clipping
        const plotWidth = canvas.width - margin.left - margin.right;
        const plotHeight = canvas.height - margin.top - margin.bottom;

        // Draw axes
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(margin.left, canvas.height - margin.bottom);
        ctx.lineTo(canvas.width - margin.right, canvas.height - margin.bottom);
        ctx.moveTo(margin.left, margin.top);
        ctx.lineTo(margin.left, canvas.height - margin.bottom);
        ctx.stroke();

        // Draw axis labels
        ctx.fillStyle = '#333';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Video File', canvas.width / 2, canvas.height - 10);
        ctx.save();
        ctx.translate(15, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('p(m|w) fixed IB categories', 0, 0);
        ctx.restore();

        if (!this.pmwLinesData || this.pmwLinesData.length === 0) {
            // No data - just show axes
            return;
        }

        // Find global min/max across all lines for scaling
        let globalMin = Infinity;
        let globalMax = -Infinity;
        for (const line of this.pmwLinesData) {
            if (line && line.length > 0) {
                const lineMin = Math.min(...line);
                const lineMax = Math.max(...line);
                globalMin = Math.min(globalMin, lineMin);
                globalMax = Math.max(globalMax, lineMax);
            }
        }

        if (globalMin === Infinity || globalMax === -Infinity) {
            return; // No valid data
        }

        // Get grid dimensions to generate video file names
        let m = 0, n = 0;
        if (this.colorGridData) {
            [m, n] = this.colorGridData.shape;
        } else if (this.gridInfo) {
            m = this.gridInfo.grid_dimensions[0];
            n = this.gridInfo.grid_dimensions[1];
        }
        
        // Generate video file names for x-axis labels (without 'video' prefix and .mp4 extension)
        const videoFileNames = [];
        if (m > 0 && n > 0) {
            for (let row = 0; row < m; row++) {
                for (let col = 0; col < n; col++) {
                    videoFileNames.push(`${row}-${col}`);
                }
            }
        }

        const valueRange = globalMax - globalMin || 1;
        const scaleX = (idx, length) => margin.left + (idx / (length - 1 || 1)) * plotWidth;
        const scaleY = (val) => canvas.height - margin.bottom - ((val - globalMin) / valueRange) * plotHeight;
        
        // Draw x-axis tick labels with video file names
        if (this.pmwLinesData && this.pmwLinesData.length > 0) {
            const firstLine = this.pmwLinesData[0];
            const numPoints = firstLine ? firstLine.length : 0;
            
            if (numPoints > 0 && videoFileNames.length === numPoints) {
                // Draw tick marks and labels
                ctx.strokeStyle = '#666';
                ctx.lineWidth = 1;
                ctx.fillStyle = '#333';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                
                // Determine how many ticks to show (avoid overcrowding)
                const maxTicks = Math.min(20, numPoints); // Show at most 20 ticks
                const tickStep = Math.max(1, Math.floor(numPoints / maxTicks));
                
                // Start from index 0 to include the origin
                for (let i = 0; i < numPoints; i += tickStep) {
                    const x = scaleX(i, numPoints);
                    
                    // Draw tick mark
                    ctx.beginPath();
                    ctx.moveTo(x, canvas.height - margin.bottom);
                    ctx.lineTo(x, canvas.height - margin.bottom + 5);
                    ctx.stroke();
                    
                    // Draw label vertically
                    const label = videoFileNames[i];
                    if (label) {
                        ctx.save();
                        ctx.translate(x, canvas.height - margin.bottom + 25);
                        ctx.rotate(-Math.PI / 2); // 90 degrees (vertical)
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(label, 0, 0);
                        ctx.restore();
                    }
                }
                
                // Always show the last label if it's not already included
                if (numPoints > 1 && (numPoints - 1) % tickStep !== 0) {
                    const lastIdx = numPoints - 1;
                    const x = scaleX(lastIdx, numPoints);
                    
                    // Draw tick mark
                    ctx.beginPath();
                    ctx.moveTo(x, canvas.height - margin.bottom);
                    ctx.lineTo(x, canvas.height - margin.bottom + 5);
                    ctx.stroke();
                    
                    // Draw label vertically
                    const label = videoFileNames[lastIdx];
                    if (label) {
                        ctx.save();
                        ctx.translate(x, canvas.height - margin.bottom + 25);
                        ctx.rotate(-Math.PI / 2); // 90 degrees (vertical)
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText(label, 0, 0);
                        ctx.restore();
                    }
                }
            }
        }

        // Draw each line with colors from RGB data or default colors
        const defaultColors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'];
        
        for (let lineIdx = 0; lineIdx < this.pmwLinesData.length; lineIdx++) {
            const line = this.pmwLinesData[lineIdx];
            if (!line || line.length === 0) continue;

            // Use RGB colors if available, otherwise use default colors
            let color;
            if (this.pmwLinesColors && this.pmwLinesColors.length > lineIdx) {
                const [r, g, b] = this.pmwLinesColors[lineIdx];
                color = `rgb(${r}, ${g}, ${b})`;
            } else {
                color = defaultColors[lineIdx % defaultColors.length];
            }
            
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();

            for (let i = 0; i < line.length; i++) {
                const x = scaleX(i, line.length);
                const y = scaleY(line[i]);
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        }
    }

    calculateGridInfo() {
        if (!this.videoData || !this.colorGridData) return;
        
        const [videoHeight, videoWidth] = this.videoData.shape;
        const [m, n] = this.colorGridData.shape;
        
        if (videoHeight % m !== 0 || videoWidth % n !== 0) {
            this.showError('Video dimensions not divisible by grid dimensions');
            return;
        }
        
        const cellWidth = videoWidth / n;
        const cellHeight = videoHeight / m;
        
        this.gridInfo = {
            m, n,
            cellWidth, cellHeight,
            videoWidth, videoHeight
        };
        
        // this.updateInfo('grid-size', `${m}x${n}`);
        // this.updateInfo('cell-size', `${cellWidth}x${cellHeight}`);
        
        // Initialize color texture if not already created
        if (!this.colorTexture) {
            this.createColorTexture();
        }
        
        // Start rendering
        this.startRendering();
    }

    createVideoTexture() {
        if (!this.gl) {
            console.warn('Cannot create video texture: WebGL not available');
            return;
        }
        if (!this.videoData) return;
        
        const [height, width, channels, frames] = this.videoData.shape;
        
        this.videoTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.videoTexture);
        
        // Set texture parameters
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        
        // Upload first frame
        this.updateVideoFrame(0);
    }

    updateVideoFrame(frameIndex) {
        if (!this.gl || !this.videoData || !this.videoTexture) return;
        
        const [height, width, channels, frames] = this.videoData.shape;
        
        // Extract frame data - numpy array is stored as (height, width, channels, frames)
        const frameSize = width * height;
        const frameData = new Uint8Array(frameSize);
        
        // Numpy array indexing: [y, x, channel, frame]
        // Index = y * (width * channels * frames) + x * (channels * frames) + channel * frames + frame
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIndex = y * (width * channels * frames) + 
                               x * (channels * frames) + 
                               0 * frames + 
                               frameIndex;
                const dstIndex = y * width + x;
                
                frameData[dstIndex] = this.videoData.data[srcIndex] || 0;
            }
        }
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.videoTexture);
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D, 0, this.gl.LUMINANCE,
            width, height, 0, this.gl.LUMINANCE, this.gl.UNSIGNED_BYTE,
            frameData
        );
    }

    createColorTexture() {
        if (!this.gl) {
            console.warn('Cannot create color texture: WebGL not available');
            return;
        }
        if (!this.colorGridData) return;
        
        const [m, n, channels, parameters] = this.colorGridData.shape;
        
        this.colorTexture = this.gl.createTexture();
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        
        // Set texture parameters - no interpolation for exact cell colors
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        
        // Upload first parameter slice
        this.updateColorTexture();
    }

    updateColorTexture() {
        if (!this.gl || !this.colorGridData || !this.colorTexture) return;
        
        const [m, n, channels, parameters] = this.colorGridData.shape;
        
        // Create texture data - one pixel per cell
        const textureData = new Uint8Array(n * m * 3);
        
        // Check if PWM colormap is active
        if (this.activePwmColormap && this.pwmColormaps[this.activePwmColormap]) {
            const pwmColormap = this.pwmColormaps[this.activePwmColormap];
            const [pwmM, pwmN, pwmChannels] = pwmColormap.shape;
            
            // Use PWM colormap instead of parameter-based colors
            for (let row = 0; row < Math.min(m, pwmM); row++) {
                for (let col = 0; col < Math.min(n, pwmN); col++) {
                    // PWM colormap shape: (m, n, 3)
                    // Access: row * (n * 3) + col * 3 + channel
                    const idx = row * (pwmN * pwmChannels) + col * pwmChannels;
                    const r = pwmColormap.data[idx + 0];
                    const g = pwmColormap.data[idx + 1];
                    const b = pwmColormap.data[idx + 2];
                    
                    // Texture coordinates: x=col, y=row
                    const textureIndex = (row * n + col) * 3;
                    textureData[textureIndex + 0] = Math.floor(Math.max(0, Math.min(1, r)) * 255);
                    textureData[textureIndex + 1] = Math.floor(Math.max(0, Math.min(1, g)) * 255);
                    textureData[textureIndex + 2] = Math.floor(Math.max(0, Math.min(1, b)) * 255);
                }
            }
        } else {
            // Use parameter-based colors from colorGridData
            for (let row = 0; row < m; row++) {
                for (let col = 0; col < n; col++) {
                    const r = this.colorGridData.data[row * (n * channels * parameters) + col * (channels * parameters) + 0 * parameters + this.currentParameter];
                    const g = this.colorGridData.data[row * (n * channels * parameters) + col * (channels * parameters) + 1 * parameters + this.currentParameter];
                    const b = this.colorGridData.data[row * (n * channels * parameters) + col * (channels * parameters) + 2 * parameters + this.currentParameter];
                    
                    // Texture coordinates: x=col, y=row
                    const textureIndex = (row * n + col) * 3;
                    textureData[textureIndex + 0] = Math.floor(Math.max(0, Math.min(1, r)) * 255);
                    textureData[textureIndex + 1] = Math.floor(Math.max(0, Math.min(1, g)) * 255);
                    textureData[textureIndex + 2] = Math.floor(Math.max(0, Math.min(1, b)) * 255);
                }
            }
        }
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        
        // Set pixel alignment to 1 to avoid padding issues with small textures
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D, 0, this.gl.RGB,
            n, m, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE,
            textureData
        );
        
        // Update MDS plot colors and legend when parameter changes
        this.plotMds();
        this.updateLegend();
    }



    startRendering() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        this.render();
    }

    render() {
        if (!this.gridInfo || !this.videoTexture || !this.colorTexture) return;
        
        // Check if WebGL is available
        if (!this.gl || !this.shaderProgram) {
            console.warn('Cannot render: WebGL not available');
            return;
        }
        
        // Update frame if playing
        if (this.isPlaying) {
            const now = performance.now();
            if (now - this.lastFrameTime >= 1000 / this.frameRate) {
                this.currentFrame = (this.currentFrame + 1) % this.videoData.shape[3];
                this.updateVideoFrame(this.currentFrame);
                this.lastFrameTime = now;
            }
        }
        
        // Clear canvas
        this.gl.clearColor(0, 0, 0, 1);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
        // Use shader program
        this.gl.useProgram(this.shaderProgram);
        
        // Set up geometry
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        
        const positionLocation = this.gl.getAttribLocation(this.shaderProgram, 'a_position');
        const texCoordLocation = this.gl.getAttribLocation(this.shaderProgram, 'a_texCoord');
        
        this.gl.enableVertexAttribArray(positionLocation);
        this.gl.enableVertexAttribArray(texCoordLocation);
        
        this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 16, 0);
        this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 16, 8);
        
        // Set uniforms (cache locations and check for null to avoid Firefox warnings)
        const videoTextureLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_videoTexture');
        const colorTextureLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_colorTexture');
        const gridSizeLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_gridSize');
        const cellSizeLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_cellSize');
        const videoSizeLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_videoSize');
        const currentFrameLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_currentFrame');
        const totalFramesLoc = this.gl.getUniformLocation(this.shaderProgram, 'u_totalFrames');
        
        if (videoTextureLoc !== null) this.gl.uniform1i(videoTextureLoc, 0);
        if (colorTextureLoc !== null) this.gl.uniform1i(colorTextureLoc, 1);
        if (gridSizeLoc !== null) this.gl.uniform2f(gridSizeLoc, this.gridInfo.n, this.gridInfo.m);
        if (cellSizeLoc !== null) this.gl.uniform2f(cellSizeLoc, this.gridInfo.cellWidth, this.gridInfo.cellHeight);
        if (videoSizeLoc !== null) this.gl.uniform2f(videoSizeLoc, this.gridInfo.videoWidth, this.gridInfo.videoHeight);
        if (currentFrameLoc !== null) this.gl.uniform1f(currentFrameLoc, this.currentFrame);
        if (totalFramesLoc !== null) this.gl.uniform1f(totalFramesLoc, this.videoData.shape[3]);
        
        // Set transformation matrix
        this.updateTransform();
        
        // Bind textures
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.videoTexture);
        
        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        
        // Draw
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
        
        // Draw hover bounding box if needed
        this.drawHoverBoundingBox();
        
        // Clear overlay if no hover
        if (!this.hoveredCell) {
            const ctx = this.overlayCanvas.getContext('2d');
            ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }
        
        // Continue animation
        this.animationId = requestAnimationFrame(() => this.render());
    }

    updateTransform() {
        if (!this.gl || !this.shaderProgram) return;
        
        // Ensure the program is active before setting uniforms
        // (Firefox requires this to be explicit)
        this.gl.useProgram(this.shaderProgram);
        
        // Create transformation matrix
        const scaleX = this.zoom;
        const scaleY = this.zoom;
        const translateX = this.pan.x;
        const translateY = this.pan.y;
        
        const transform = [
            scaleX, 0, 0,
            0, scaleY, 0,
            translateX, translateY, 1
        ];
        
        const transformLocation = this.gl.getUniformLocation(this.shaderProgram, 'u_transform');
        if (transformLocation !== null) {
            this.gl.uniformMatrix3fv(transformLocation, false, transform);
        }
    }
    
    loadCellVideo(row, col) {
        if (!this.cellVideo) return;
        
        // Use the current data directory if available, otherwise fall back to 'files/'
        const baseDir = this.currentDataDirectory || 'files/';
        const basePath = this.getBasePath();
        
        // Ensure baseDir ends with a slash for proper path construction
        const normalizedBaseDir = baseDir.endsWith('/') ? baseDir : baseDir + '/';
        const videoPath = basePath + `${normalizedBaseDir}videos/video-${row}-${col}.mp4`;
        
        console.log('Loading video from:', videoPath);
        this.cellVideo.src = videoPath;
        this.cellVideo.load();
        
        // Add error handling for video loading
        this.cellVideo.addEventListener('error', (e) => {
            console.error('Error loading video:', videoPath, e);
            console.error('Video error details:', this.cellVideo.error);
        });
        
        // Set up event listener to adjust dimensions once video metadata is loaded
        this.cellVideo.addEventListener('loadedmetadata', () => {
            const aspectRatio = this.cellVideo.videoWidth / this.cellVideo.videoHeight;
            const baseWidth = 125; // Reduced by half from original 400
            const baseHeight = 94; // Reduced by half from original 300
            
            // Calculate new dimensions maintaining aspect ratio
            let newWidth, newHeight;
            if (aspectRatio > baseWidth / baseHeight) {
                // Video is wider than base aspect ratio
                newWidth = baseWidth;
                newHeight = baseWidth / aspectRatio;
            } else {
                // Video is taller than base aspect ratio
                newHeight = baseHeight; // baseHeight;
                newWidth = baseWidth; // baseHeight * aspectRatio;
            }
            
            this.cellVideo.style.width = newWidth + 'px';
            this.cellVideo.style.height = newHeight + 'px';
        });
        
        this.cellVideo.play().catch(e => {
            console.log('Video autoplay failed:', e);
        });
    }
    
    drawHoverBoundingBox() {
        if (!this.hoveredCell || !this.gridInfo || !this.overlayCanvas || !this.canvas) return;
        
        // Ensure overlay canvas size matches main canvas
        const mainRect = this.canvas.getBoundingClientRect();
        const overlayRect = this.overlayCanvas.getBoundingClientRect();
        
        // Sync overlay canvas size to main canvas
        if (this.overlayCanvas.width !== this.canvas.width || 
            this.overlayCanvas.height !== this.canvas.height) {
            this.overlayCanvas.width = this.canvas.width;
            this.overlayCanvas.height = this.canvas.height;
        }
        
        // Use the overlay canvas for 2D drawing
        const ctx = this.overlayCanvas.getContext('2d');
        
        // Clear the overlay canvas
        ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        
        // Calculate cell boundaries in normalized coordinates
        const cellWidth = 2.0 / this.gridInfo.n;  // -1 to 1 range
        const cellHeight = 2.0 / this.gridInfo.m;
        
        const left = -1 + this.hoveredCell.col * cellWidth;
        const right = left + cellWidth;
        const top = 1 - this.hoveredCell.row * cellHeight;
        const bottom = top - cellHeight;
        
        // Apply current transformation
        const scaleX = this.zoom;
        const scaleY = this.zoom;
        const translateX = this.pan.x;
        const translateY = this.pan.y;
        
        // Transform corners
        const corners = [
            [left, top], [right, top],
            [right, bottom], [left, bottom]
        ].map(([x, y]) => [
            (x + translateX) * scaleX,
            (y + translateY) * scaleY
        ]);
        
        // Convert to screen coordinates using actual canvas size
        const screenCorners = corners.map(([x, y]) => [
            (x + 1) * this.overlayCanvas.width / 2,
            (1 - y) * this.overlayCanvas.height / 2
        ]);
        
        // Draw red wireframe box
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        
        ctx.beginPath();
        ctx.moveTo(screenCorners[0][0], screenCorners[0][1]);
        ctx.lineTo(screenCorners[1][0], screenCorners[1][1]);
        ctx.lineTo(screenCorners[2][0], screenCorners[2][1]);
        ctx.lineTo(screenCorners[3][0], screenCorners[3][1]);
        ctx.closePath();
        ctx.stroke();
    }

    togglePlayPause() {
        this.isPlaying = !this.isPlaying;
    }

    resetAnimation() {
        this.currentFrame = 0;
        this.isPlaying = true; // Keep playing after reset
        this.zoom = 1.0;
        this.pan = { x: 0, y: 0 };
        this.updateTransform();
    }

    initializeUI() {
        this.showLoading(false);
        // Hide the HTML legend section - legend is now drawn on canvas
        const legendSection = document.getElementById('legend-section');
        if (legendSection) {
            legendSection.style.display = 'none';
            legendSection.innerHTML = '';
        }
        // this.updateInfo('grid-size', '-');
        // this.updateInfo('cell-size', '-');
        // this.updateInfo('frame-count', '-');
        // this.updateInfo('param-count', '-');
        // this.updateInfo('fps-display', '30');
        // this.updateParameterDisplay();
    }

    // updateInfo(elementId, value) {
    //     document.getElementById(elementId).textContent = value;
    // }

    updateVideoStatus(status) {
        const el = document.getElementById('video-status');
        if (el) {
            el.textContent = status;
        }
    }

    updateColorStatus(status) {
        const el = document.getElementById('color-status');
        if (el) {
            el.textContent = status;
        }
    }

    showLoading(show) {
        document.getElementById('loading').classList.toggle('show', show);
    }

    showError(message) {
        const errorElement = document.getElementById('error-message');
        errorElement.textContent = message;
        errorElement.classList.add('show');
        setTimeout(() => errorElement.classList.remove('show'), 5000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded fired, initializing MotionVisualizer...');
    try {
        window.visualizer = new MotionVisualizer();
        console.log('MotionVisualizer instance created:', window.visualizer);
    } catch (e) {
        console.error('Failed to create MotionVisualizer:', e);
        console.error('Error stack:', e.stack);
        // Show error to user
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position: fixed; top: 10px; left: 10px; background: red; color: white; padding: 20px; z-index: 10000;';
        errorDiv.textContent = 'Failed to initialize dashboard: ' + e.message;
        document.body.appendChild(errorDiv);
    }
}); 