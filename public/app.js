class DepthBasedBlurProcessor {
    constructor() {
        this.currentImageFile = null;
        this.originalImageData = null;
        this.depthMapData = null;
        this.isProcessing = false;
        this.debounceTimer = null;
        
        // Canvas elements for image processing
        this.canvas = null;
        this.ctx = null;
        this.tempCanvas = null;
        this.tempCtx = null;
        
        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupDragAndDrop();
    }

    setupCanvas() {
        this.canvas = document.getElementById('processingCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Create temporary canvas for processing
        this.tempCanvas = document.createElement('canvas');
        this.tempCtx = this.tempCanvas.getContext('2d');
    }

    setupEventListeners() {
        // File input handling
        const fileInput = document.getElementById('fileInput');
        const browseBtn = document.getElementById('browseBtn');
        
        browseBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));

        // Control sliders with real-time updates
        const focusStrength = document.getElementById('focusStrength');
        const blurRadius = document.getElementById('blurRadius');
        const depthThreshold = document.getElementById('depthThreshold');
        
        focusStrength.addEventListener('input', (e) => {
            document.getElementById('focusStrengthValue').textContent = e.target.value;
            this.debouncedApplyBlur();
        });
        
        blurRadius.addEventListener('input', (e) => {
            document.getElementById('blurRadiusValue').textContent = e.target.value;
            this.debouncedApplyBlur();
        });

        depthThreshold.addEventListener('input', (e) => {
            document.getElementById('depthThresholdValue').textContent = e.target.value;
            this.debouncedApplyBlur();
        });

        // Action buttons
        document.getElementById('resetBtn').addEventListener('click', () => this.resetControls());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadResult());
        document.getElementById('retryBtn').addEventListener('click', () => this.resetApp());
    }

    setupDragAndDrop() {
        const uploadZone = document.getElementById('uploadZone');
        
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadZone.addEventListener(eventName, this.preventDefaults, false);
            document.body.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadZone.addEventListener(eventName, () => uploadZone.classList.add('drag-over'), false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadZone.addEventListener(eventName, () => uploadZone.classList.remove('drag-over'), false);
        });

        uploadZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileSelect(files[0]);
            }
        }, false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    handleFileSelect(file) {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            this.showError('Please select a valid image file (JPG, PNG, WEBP)');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.showError('File size must be less than 10MB');
            return;
        }

        this.currentImageFile = file;
        this.previewOriginalImage(file);
        this.getDepthMap();
    }

    previewOriginalImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById('originalImage');
            img.src = e.target.result;
            img.onload = () => {
                this.originalImageData = {
                    src: e.target.result,
                    width: img.naturalWidth,
                    height: img.naturalHeight
                };
            };
        };
        reader.readAsDataURL(file);
    }

    async getDepthMap() {
        if (!this.currentImageFile || this.isProcessing) return;

        this.isProcessing = true;
        this.showProcessingState();
        
        try {
            const formData = new FormData();
            formData.append('file', this.currentImageFile);
            // Use minimal blur for depth estimation only
            formData.append('focus_strength', '1.0');
            formData.append('blur_radius', '3');

            this.updateProgress(30, 'Uploading image...');

            const response = await fetch('http://localhost:8000/auto-focus', {
                method: 'POST',
                body: formData
            });

            this.updateProgress(60, 'Generating depth map...');

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }

            this.updateProgress(80, 'Processing depth information...');

            // Store depth map
            this.depthMapData = data.depth_map;
            document.getElementById('depthImage').src = this.depthMapData;
            
            this.updateProgress(90, 'Applying depth-based blur...');

            // Apply initial blur
            await this.applyDepthBasedBlur();
            
            this.updateProgress(100, 'Complete!');
            
            setTimeout(() => {
                this.showResultsState();
            }, 500);

        } catch (error) {
            console.error('Processing error:', error);
            this.showError(`Failed to process image: ${error.message}`);
        } finally {
            this.isProcessing = false;
        }
    }

    async applyDepthBasedBlur() {
        if (!this.originalImageData || !this.depthMapData) return;

        return new Promise((resolve, reject) => {
            const focusStrength = parseFloat(document.getElementById('focusStrength').value);
            const blurRadius = parseInt(document.getElementById('blurRadius').value);
            const depthThreshold = parseFloat(document.getElementById('depthThreshold').value);

            // Load original image
            const originalImg = new Image();
            originalImg.crossOrigin = 'anonymous';
            
            originalImg.onload = () => {
                // Load depth map
                const depthImg = new Image();
                depthImg.crossOrigin = 'anonymous';
                
                depthImg.onload = () => {
                    try {
                        this.processImageWithDepthMask(originalImg, depthImg, blurRadius, depthThreshold, focusStrength);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                };
                
                depthImg.onerror = () => reject(new Error('Failed to load depth map'));
                depthImg.src = this.depthMapData;
            };
            
            originalImg.onerror = () => reject(new Error('Failed to load original image'));
            originalImg.src = this.originalImageData.src;
        });
    }

    processImageWithDepthMask(originalImg, depthImg, blurRadius, depthThreshold, focusStrength) {
        const width = originalImg.width;
        const height = originalImg.height;

        // Setup canvas dimensions
        this.canvas.width = width;
        this.canvas.height = height;
        this.tempCanvas.width = width;
        this.tempCanvas.height = height;

        // Draw original image to canvas
        this.ctx.drawImage(originalImg, 0, 0, width, height);
        
        // Create blurred version using StackBlur
        const imageData = this.ctx.getImageData(0, 0, width, height);
        const blurredImageData = new ImageData(
            new Uint8ClampedArray(imageData.data), 
            width, 
            height
        );
        
        // Apply blur using StackBlur
        StackBlur.imageDataRGBA(blurredImageData, 0, 0, width, height, blurRadius);

        // Draw depth map to temp canvas to extract pixel data
        this.tempCtx.drawImage(depthImg, 0, 0, width, height);
        const depthData = this.tempCtx.getImageData(0, 0, width, height);

        // Create mask based on depth and apply selective blur
        this.applySelectiveBlur(imageData, blurredImageData, depthData, depthThreshold, focusStrength);

        // Draw final result
        this.ctx.putImageData(imageData, 0, 0);

        // Update result image
        const resultImg = document.getElementById('resultImage');
        resultImg.src = this.canvas.toDataURL('image/jpeg', 0.95);
    }

    applySelectiveBlur(originalData, blurredData, depthData, threshold, focusStrength) {
        const pixels = originalData.data;
        const blurredPixels = blurredData.data;
        const depthPixels = depthData.data;

        for (let i = 0; i < pixels.length; i += 4) {
            // Get depth value (using red channel, normalized to 0-1)
            const depthValue = depthPixels[i] / 255;
            
            // Calculate blur amount based on depth
            // Dark areas (far) get more blur, light areas (near) get less blur
            const depthFromFocus = Math.abs(depthValue - (1 - threshold));
            let blurAmount = Math.min(depthFromFocus * focusStrength, 1);
            
            // Apply threshold - areas closer than threshold get no blur
            if (depthValue > threshold) {
                blurAmount = 0;
            }

            // Blend between original and blurred pixels
            pixels[i] = Math.round(pixels[i] * (1 - blurAmount) + blurredPixels[i] * blurAmount);     // R
            pixels[i + 1] = Math.round(pixels[i + 1] * (1 - blurAmount) + blurredPixels[i + 1] * blurAmount); // G
            pixels[i + 2] = Math.round(pixels[i + 2] * (1 - blurAmount) + blurredPixels[i + 2] * blurAmount); // B
            // Alpha channel remains unchanged (pixels[i + 3])
        }
    }

    debouncedApplyBlur() {
        if (!this.originalImageData || !this.depthMapData) return;
        
        document.getElementById('processingOverlay').style.display = 'flex';
        
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        
        this.debounceTimer = setTimeout(async () => {
            try {
                await this.applyDepthBasedBlur();
            } catch (error) {
                console.error('Blur update error:', error);
                this.showError(`Failed to update blur: ${error.message}`);
            } finally {
                document.getElementById('processingOverlay').style.display = 'none';
            }
        }, 300);
    }

    resetControls() {
        document.getElementById('focusStrength').value = 1.0;
        document.getElementById('focusStrengthValue').textContent = '1.0';
        document.getElementById('blurRadius').value = 15;
        document.getElementById('blurRadiusValue').textContent = '15';
        document.getElementById('depthThreshold').value = 0.5;
        document.getElementById('depthThresholdValue').textContent = '0.5';
        
        if (this.originalImageData && this.depthMapData) {
            this.debouncedApplyBlur();
        }
    }

    downloadResult() {
        if (!this.canvas || this.canvas.width === 0) {
            this.showError('No processed image available for download');
            return;
        }

        try {
            this.canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.download = `depth-focus-${Date.now()}.jpg`;
                link.href = url;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            }, 'image/jpeg', 0.95);
        } catch (error) {
            console.error('Download error:', error);
            this.showError('Failed to download image');
        }
    }

    resetApp() {
        this.currentImageFile = null;
        this.originalImageData = null;
        this.depthMapData = null;
        
        document.getElementById('fileInput').value = '';
        this.resetControls();
        this.showUploadState();
    }

    // State management methods
    showUploadState() {
        this.hideAllSections();
        document.querySelector('.upload-section').style.display = 'block';
    }

    showProcessingState() {
        this.hideAllSections();
        document.getElementById('statusSection').style.display = 'block';
        this.updateProgress(10, 'Starting processing...');
    }

    showResultsState() {
        this.hideAllSections();
        document.getElementById('resultsSection').style.display = 'block';
    }

    showErrorState(message) {
        this.hideAllSections();
        document.getElementById('errorSection').style.display = 'block';
        document.getElementById('errorMessage').textContent = message;
    }

    hideAllSections() {
        document.getElementById('statusSection').style.display = 'none';
        document.getElementById('resultsSection').style.display = 'none';
        document.getElementById('errorSection').style.display = 'none';
    }

    updateProgress(percentage, text) {
        document.getElementById('progressFill').style.width = `${percentage}%`;
        document.getElementById('statusText').textContent = text;
    }

    showError(message) {
        console.error('App error:', message);
        this.showErrorState(message);
        this.isProcessing = false;
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new DepthBasedBlurProcessor();
});

// Optional: Service worker for offline functionality
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('SW registered'))
            .catch(error => console.log('SW registration failed'));
    });
} 