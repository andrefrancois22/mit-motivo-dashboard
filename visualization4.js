class MotionVisualizer {
    constructor() {
        this.canvas = document.getElementById('visualization-canvas');
        this.overlayCanvas = document.getElementById('overlay-canvas');
        this.gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
        
        if (!this.gl) {
            this.showError('WebGL not supported in this browser');
            return;
        }
        


        // Data storage
        this.videoData = null;
        this.colorGridData = null;
        this.gridInfo = null;
        this.betaValues = null;
        this.curveData = null;
        this.mdsData = null;
        this.referencePoint = null; // { x, y, label }
        
        // Curve slider state
        this.curveSliderPosition = 0; // Index along the curve
        this.isDraggingCurveSlider = false;
        
        // Animation state
        this.isPlaying = false;
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
        
        // WebGL resources
        this.shaderProgram = null;
        this.videoTexture = null;
        this.colorTexture = null;
        
        this.initializeWebGL();
        this.setupEventListeners();
        this.initializeUI();
    }

    initializeWebGL() {
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
        const vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Shader program linking failed:', this.gl.getProgramInfoLog(program));
            return null;
        }
        
        return program;
    }

    createShader(type, source) {
        const shader = this.gl.createShader(type);
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
        // File uploads (optional if inputs exist)
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
        
        // Curve slider mouse events
        this.setupCurveSliderEvents();
        
        // Parameter slider
        // const slider = document.getElementById('parameter-slider');
        // slider.addEventListener('input', (e) => {
            // this.currentParameter = parseInt(e.target.value);
            // this.updateParameterDisplay();
            // this.updateColorTexture();
            // this.updateCurveSliderFromParameter();
        // });
        
        // Control buttons
        document.getElementById('play-pause').addEventListener('click', () => {
            this.togglePlayPause();
        });
        
        document.getElementById('reset').addEventListener('click', () => {
            this.resetAnimation();
        });
        
        document.getElementById('zoom-in').addEventListener('click', () => {
            this.zoom *= 1.2;
            this.updateTransform();
        });
        
        document.getElementById('zoom-out').addEventListener('click', () => {
            this.zoom /= 1.2;
            this.updateTransform();
        });
        
        // Mouse controls for pan
        this.setupMouseControls();
        
        // Mouse hover for cell highlighting
        this.setupHoverControls();

        // DTW IB model bulk loader
        const dtwBtn = document.getElementById('load-dtw-model');
        if (dtwBtn) {
            dtwBtn.addEventListener('click', async () => {
                const statusEl = document.getElementById('dtw-model-status');
                try {
                    if (statusEl) statusEl.textContent = 'Attempting to load from IB-results/DTW-model-files...';
                    // First, try to load relative to the project (works on http/https)
                    const loaded = await this.tryLoadDtwFromRelative();
                    if (loaded) {
                        if (statusEl) statusEl.textContent = 'DTW model loaded from IB-results/DTW-model-files';
                        return;
                    }
                    if (window.showDirectoryPicker) {
                        // Fallback: prompt user; hint to Desktop to quickly reach IB-results
                        const pickerOptions = { id: 'dtw-model', startIn: 'desktop', mode: 'read' };
                        let dirHandle;
                        try {
                            dirHandle = await window.showDirectoryPicker(pickerOptions);
                        } catch (innerErr) {
                            // Retry without options if not supported
                            dirHandle = await window.showDirectoryPicker();
                        }
                        await this.loadDtwModelFromDirectory(dirHandle);
                        if (statusEl) statusEl.textContent = 'DTW model loaded from selected directory';
                    } else {
                        if (statusEl) statusEl.textContent = 'Directory picker not supported in this browser';
                    }
                } catch (e) {
                    // User cancelled the picker is not an error; just update status quietly
                    if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) {
                        if (statusEl) statusEl.textContent = 'Cancelled folder selection';
                        return;
                    }
                    console.error('DTW load error:', e);
                    if (statusEl) statusEl.textContent = 'Failed to load DTW model';
                }
            });
        }

        // DTW IB model 2 bulk loader
        const dtwBtn2 = document.getElementById('load-dtw-model-2');
        if (dtwBtn2) {
            dtwBtn2.addEventListener('click', async () => {
                const statusEl = document.getElementById('dtw-model-status-2');
                try {
                    if (statusEl) statusEl.textContent = 'Attempting to load from files-dtw-gamma-0...';
                    // First, try to load relative to the project (works on http/https)
                    const loaded = await this.tryLoadDtwFromRelative2();
                    if (loaded) {
                        if (statusEl) statusEl.textContent = 'DTW model loaded from files-dtw-gamma-0';
                        return;
                    }
                    if (window.showDirectoryPicker) {
                        // Fallback: prompt user; hint to Desktop to quickly reach IB-results
                        const pickerOptions = { id: 'dtw-model-2', startIn: 'desktop', mode: 'read' };
                        let dirHandle;
                        try {
                            dirHandle = await window.showDirectoryPicker(pickerOptions);
                        } catch (innerErr) {
                            // Retry without options if not supported
                            dirHandle = await window.showDirectoryPicker();
                        }
                        await this.loadDtwModelFromDirectory(dirHandle);
                        if (statusEl) statusEl.textContent = 'DTW model loaded from selected directory';
                    } else {
                        if (statusEl) statusEl.textContent = 'Directory picker not supported in this browser';
                    }
                } catch (e) {
                    // User cancelled the picker is not an error; just update status quietly
                    if (e && (e.name === 'AbortError' || e.message?.includes('aborted'))) {
                        if (statusEl) statusEl.textContent = 'Cancelled folder selection';
                        return;
                    }
                    console.error('DTW load error:', e);
                    if (statusEl) statusEl.textContent = 'Failed to load DTW model';
                }
            });
        }
    }

    async loadDtwModelFromDirectory(dirHandle) {
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

        await this.handleVideoUpload(videoFile);
        await this.handleColorUpload(colorFile);
        await this.handleBetaValuesUpload(betasFile);
        await this.handleCurveValuesUpload(curveFile);
        if (mdsFile) {
            await this.handleMdsUpload(mdsFile);
        }
        if (refPointData) {
            await this.handleReferencePointUpload(refPointData.file, refPointData.name);
        }
    }

    // Try to load directly from project-relative directory (works when served over http/https). Falls back silently on file://
    async tryLoadDtwFromRelative() {
        const makeFile = async (url, name) => {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to fetch ' + url);
            const blob = await resp.blob();
            return new File([blob], name, { type: 'application/octet-stream' });
        };
        try {
            const base = 'files/'; //'IB-results/DTW-model-files/';
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

    // Try to load directly from files-dtw-gamma-0 directory
    async tryLoadDtwFromRelative2() {
        const makeFile = async (url, name) => {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Failed to fetch ' + url);
            const blob = await resp.blob();
            return new File([blob], name, { type: 'application/octet-stream' });
        };
        try {
            const base = 'files-dtw-gamma-0/';
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
        
        curveCanvas.addEventListener('mousedown', (e) => {
            if (!this.curveData) return;
            
            const rect = curveCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
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
                // Check if hovering over slider circle
                const circlePos = this.getCurveSliderScreenPosition();
                if (circlePos) {
                    const distance = Math.sqrt(Math.pow(x - circlePos.x, 2) + Math.pow(y - circlePos.y, 2));
                    curveCanvas.style.cursor = distance <= 8 ? 'grab' : 'default';
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
        const { x, y } = this.curveData;
        
        // Get the current curve position
        const currentIndex = this.curveSliderPosition;
        if (currentIndex >= x.length) return null;
        
        const currentX = x[currentIndex];
        const currentY = y[currentIndex];
        
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
        
        // Update the regular parameter slider to match
        // const slider = document.getElementById('parameter-slider');
        // slider.value = this.currentParameter;
        
        // Update display and color texture
        // this.updateParameterDisplay();
        this.updateColorTexture();
        
        // Redraw the curve with the updated circle position
        this.plotCurve();
    }
    
    updateCurveSliderFromParameter() {
        if (!this.curveData) return;
        
        const { x } = this.curveData;
        const parameterRange = this.colorGridData ? this.colorGridData.shape[3] : 10;
        
        // Map parameter value to curve position
        const normalizedParameter = this.currentParameter / (parameterRange - 1);
        this.curveSliderPosition = Math.floor(normalizedParameter * (x.length - 1));
        
        // Redraw the curve with the updated circle position
        this.plotCurve();
    }

    setupMouseControls() {
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
                }
            } else {
                if (this.hoveredCell !== null) {
                    this.hoveredCell = null;
                    // Update MDS plot to remove hover marker
                    this.plotMds();
                }
            }
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            if (this.hoveredCell !== null) {
                this.hoveredCell = null;
                // Update MDS plot to remove hover marker
                this.plotMds();
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
        const maxWidth = 800;  // Maximum canvas width
        const maxHeight = 600; // Maximum canvas height
        
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
            
        } catch (error) {
            console.error('Reference point upload error:', error);
            this.showError('Error loading reference point: ' + error.message);
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
        const ctx = canvas.getContext('2d');
        const { x, y } = this.curveData;
        
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
        
        // Update legend in HTML (separate from canvas drawing)
        this.updateLegend();
    }

    updateLegend() {
        const legendSection = document.getElementById('legend-section');
        if (!legendSection) return;
        
        // Clear existing legend
        legendSection.innerHTML = '';
        
        // Add reference point legend if available
        if (this.referencePoint) {
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';
            
            const circle = document.createElement('div');
            circle.className = 'legend-circle';
            circle.style.backgroundColor = '#0000ff';
            
            const label = document.createElement('span');
            label.textContent = this.referencePoint.label || 'Reference';
            
            legendItem.appendChild(circle);
            legendItem.appendChild(label);
            legendSection.appendChild(legendItem);
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
                
                // Get RGB color for this cell at current parameter
                // Vertically flip the row index to match the color grid orientation
                const gridRow = Math.min(gridM - 1 - row, gridM - 1);
                const gridCol = Math.min(col, gridN - 1);
                
                const r = this.colorGridData.data[gridRow * (gridN * channels * parameters) + 
                                                   gridCol * (channels * parameters) + 
                                                   0 * parameters + 
                                                   currentParam];
                const g = this.colorGridData.data[gridRow * (gridN * channels * parameters) + 
                                                   gridCol * (channels * parameters) + 
                                                   1 * parameters + 
                                                   currentParam];
                const b = this.colorGridData.data[gridRow * (gridN * channels * parameters) + 
                                                   gridCol * (channels * parameters) + 
                                                   2 * parameters + 
                                                   currentParam];
                
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
        
        // Enable controls
        this.enableControls();
        
        // Initialize color texture if not already created
        if (!this.colorTexture) {
            this.createColorTexture();
        }
        
        // Start rendering
        this.startRendering();
    }

    createVideoTexture() {
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
        if (!this.videoData || !this.videoTexture) return;
        
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
        if (!this.colorGridData || !this.colorTexture) return;
        
        const [m, n, channels, parameters] = this.colorGridData.shape;
        
        // Create texture data - one pixel per cell
        const textureData = new Uint8Array(n * m * 3);
        
        // Fill texture with colors for current parameter
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
        
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.colorTexture);
        
        // Set pixel alignment to 1 to avoid padding issues with small textures
        this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D, 0, this.gl.RGB,
            n, m, 0, this.gl.RGB, this.gl.UNSIGNED_BYTE,
            textureData
        );
        
        // Update MDS plot colors when parameter changes
        this.plotMds();
    }



    startRendering() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        this.render();
    }

    render() {
        if (!this.gridInfo || !this.videoTexture || !this.colorTexture) return;
        
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
        
        // Set uniforms
        this.gl.uniform1i(this.gl.getUniformLocation(this.shaderProgram, 'u_videoTexture'), 0);
        this.gl.uniform1i(this.gl.getUniformLocation(this.shaderProgram, 'u_colorTexture'), 1);
        
        this.gl.uniform2f(this.gl.getUniformLocation(this.shaderProgram, 'u_gridSize'), 
                         this.gridInfo.n, this.gridInfo.m);
        this.gl.uniform2f(this.gl.getUniformLocation(this.shaderProgram, 'u_cellSize'), 
                         this.gridInfo.cellWidth, this.gridInfo.cellHeight);
        this.gl.uniform2f(this.gl.getUniformLocation(this.shaderProgram, 'u_videoSize'), 
                         this.gridInfo.videoWidth, this.gridInfo.videoHeight);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shaderProgram, 'u_currentFrame'), 
                         this.currentFrame);
        this.gl.uniform1f(this.gl.getUniformLocation(this.shaderProgram, 'u_totalFrames'), 
                         this.videoData.shape[3]);
        
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
        if (!this.shaderProgram) return;
        
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
        this.gl.uniformMatrix3fv(transformLocation, false, transform);
    }
    
    loadCellVideo(row, col) {
        if (!this.cellVideo) return;
        
        const videoPath = `files/videos/video-${row}-${col}.mp4`; //`IB-results/videos/video-${row}-${col}.mp4`;
        this.cellVideo.src = videoPath;
        this.cellVideo.load();
        
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
        if (!this.hoveredCell || !this.gridInfo) return;
        
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
        
        // Convert to screen coordinates
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
        document.getElementById('play-pause').textContent = this.isPlaying ? 'Pause' : 'Play';
    }

    resetAnimation() {
        this.currentFrame = 0;
        this.isPlaying = false;
        this.zoom = 1.0;
        this.pan = { x: 0, y: 0 };
        document.getElementById('play-pause').textContent = 'Play';
        this.updateTransform();
    }

    enableControls() {
        document.getElementById('play-pause').disabled = false;
        document.getElementById('reset').disabled = false;
        document.getElementById('zoom-in').disabled = false;
        document.getElementById('zoom-out').disabled = false;
    }

    initializeUI() {
        this.showLoading(false);
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
    new MotionVisualizer();
}); 