from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
from PIL import Image
import io
import torch
import torch.nn.functional as F
from typing import Dict, Any, Optional
import logging
import base64

app = FastAPI(title="Auto Focus Depth Blur API", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

class AutoFocusProcessor:
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model = None
        self.transform = None
        self.models_loaded = False
        
    async def load_depth_model(self):
        """Load lightweight depth estimation model"""
        try:
            # Load MiDaS small model (faster than full MiDaS)
            self.model = torch.hub.load("intel-isl/MiDaS", "MiDaS_small")
            self.model.to(self.device)
            self.model.eval()
            
            # Load corresponding transforms
            midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")
            self.transform = midas_transforms.small_transform
            
            self.models_loaded = True
            logging.info("MiDaS small model loaded successfully")
            
        except Exception as e:
            logging.error(f"Error loading depth model: {e}")
            self.models_loaded = False
            raise e

    def _estimate_depth(self, image_np: np.ndarray) -> np.ndarray:
        """Estimate depth map using MiDaS"""
        if not self.models_loaded:
            raise ValueError("Depth model not loaded")
        
        # Prepare input
        input_tensor = self.transform(image_np).to(self.device)
        
        # Predict depth
        with torch.no_grad():
            depth_tensor = self.model(input_tensor)
            
            # Interpolate to original image size
            depth_tensor = F.interpolate(
                depth_tensor.unsqueeze(1),
                size=image_np.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        
        # Convert to numpy and normalize
        depth_map = depth_tensor.cpu().numpy()
        
        # Normalize depth values to 0-1 range
        depth_map = (depth_map - depth_map.min()) / (depth_map.max() - depth_map.min())
        
        return depth_map

    def _find_subject_focus_plane(self, depth_map: np.ndarray) -> float:
        """Determine the focus plane based on the subject (typically foreground)"""
        height, width = depth_map.shape
        
        # Calculate center region (where subject is likely to be)
        center_h_start, center_h_end = height // 4, 3 * height // 4
        center_w_start, center_w_end = width // 4, 3 * width // 4
        center_region = depth_map[center_h_start:center_h_end, center_w_start:center_w_end]
        
        # Use the most common depth in center region as focus plane
        # We'll use the median depth of the center region
        focus_depth = np.median(center_region)
        
        # Alternative: Find the most frequent depth value in center
        hist, bin_edges = np.histogram(center_region.flatten(), bins=50)
        most_common_bin = np.argmax(hist)
        focus_depth_alt = (bin_edges[most_common_bin] + bin_edges[most_common_bin + 1]) / 2
        
        # Use average of both methods for more stability
        focus_plane = (focus_depth + focus_depth_alt) / 2
        
        return float(focus_plane)

    def _create_blur_mask(self, depth_map: np.ndarray, focus_plane: float, 
                         focus_range: float = 0.1) -> np.ndarray:
        """Create blur intensity mask based on distance from focus plane"""
        
        # Calculate distance from focus plane
        distance_from_focus = np.abs(depth_map - focus_plane)
        
        # Create blur intensity map
        # Areas close to focus plane get little/no blur
        # Areas far from focus plane get more blur
        
        # Normalize distance to 0-1 range
        max_distance = np.max(distance_from_focus)
        if max_distance > 0:
            blur_intensity = distance_from_focus / max_distance
        else:
            blur_intensity = np.zeros_like(depth_map)
        
        # Apply focus range - areas within focus_range get no blur
        blur_intensity[distance_from_focus <= focus_range] = 0
        
        # Smooth the blur mask to avoid harsh transitions
        blur_mask = cv2.GaussianBlur(blur_intensity.astype(np.float32), (21, 21), 0)
        
        return blur_mask

    def _apply_depth_blur(self, image_np: np.ndarray, blur_mask: np.ndarray, 
                         max_blur_radius: int = 15) -> np.ndarray:
        """Apply variable blur based on depth mask"""
        
        result = image_np.copy().astype(np.float32)
        
        # Create multiple blur levels for smooth transition
        blur_levels = []
        for i in range(1, max_blur_radius + 1, 2):  # Odd numbers for kernel size
            blurred = cv2.GaussianBlur(image_np, (i*2+1, i*2+1), i/3)
            blur_levels.append(blurred.astype(np.float32))
        
        # Apply blur based on mask intensity
        height, width = blur_mask.shape
        
        for y in range(height):
            for x in range(width):
                blur_intensity = blur_mask[y, x]
                
                if blur_intensity > 0:
                    # Determine which blur level to use
                    blur_level_idx = min(int(blur_intensity * len(blur_levels)), len(blur_levels) - 1)
                    
                    # Blend between original and blurred
                    alpha = blur_intensity
                    result[y, x] = (1 - alpha) * image_np[y, x] + alpha * blur_levels[blur_level_idx][y, x]
        
        return result.astype(np.uint8)

    def _apply_depth_blur_optimized(self, image_np: np.ndarray, blur_mask: np.ndarray, 
                                   max_blur_radius: int = 15) -> np.ndarray:
        """Optimized depth blur using vectorized operations"""
        
        # Create heavily blurred version
        kernel_size = max_blur_radius * 2 + 1
        blurred_image = cv2.GaussianBlur(image_np, (kernel_size, kernel_size), max_blur_radius/3)
        
        # Expand blur mask to match image channels
        blur_mask_3d = np.expand_dims(blur_mask, axis=2)
        blur_mask_3d = np.repeat(blur_mask_3d, 3, axis=2)
        
        # Blend original and blurred images
        result = (1 - blur_mask_3d) * image_np + blur_mask_3d * blurred_image
        
        return result.astype(np.uint8)

    async def process_auto_focus(self, image_bytes: bytes, 
                               focus_strength: float = 1.0,
                               blur_radius: int = 15) -> Dict[str, Any]:
        """Process image with auto focus effect like Canva"""
        
        if not self.models_loaded:
            raise HTTPException(status_code=503, detail="Depth model not loaded")
        
        try:
            # Load image
            image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
            image_np = np.array(image)
            original_height, original_width = image_np.shape[:2]
            
            # Resize for processing if too large (depth estimation is expensive)
            max_size = 512
            if max(original_height, original_width) > max_size:
                scale = max_size / max(original_height, original_width)
                new_width = int(original_width * scale)
                new_height = int(original_height * scale)
                processed_image = cv2.resize(image_np, (new_width, new_height))
                scale_back = True
            else:
                processed_image = image_np.copy()
                scale_back = False
            
            # Estimate depth map
            logging.info("Estimating depth map...")
            depth_map = self._estimate_depth(processed_image)
            
            # Find focus plane (subject depth)
            focus_plane = self._find_subject_focus_plane(depth_map)
            
            # Create blur mask
            focus_range = 0.1 / focus_strength  # Adjustable focus range
            blur_mask = self._create_blur_mask(depth_map, focus_plane, focus_range)
            
            # Apply depth-based blur
            result_image = self._apply_depth_blur_optimized(
                processed_image, blur_mask, blur_radius
            )
            
            # Scale back to original size if needed
            if scale_back:
                result_image = cv2.resize(result_image, (original_width, original_height))
                depth_map = cv2.resize(depth_map, (original_width, original_height))
                blur_mask = cv2.resize(blur_mask, (original_width, original_height))
            
            # Convert result to base64 for response
            result_pil = Image.fromarray(result_image)
            result_buffer = io.BytesIO()
            result_pil.save(result_buffer, format='JPEG', quality=95)
            result_base64 = base64.b64encode(result_buffer.getvalue()).decode()
            
            # Convert depth map to base64 for visualization (optional)
            depth_vis = (depth_map * 255).astype(np.uint8)
            depth_pil = Image.fromarray(depth_vis, mode='L')
            depth_buffer = io.BytesIO()
            depth_pil.save(depth_buffer, format='JPEG')
            depth_base64 = base64.b64encode(depth_buffer.getvalue()).decode()
            
            return {
                "processed_image": f"data:image/jpeg;base64,{result_base64}",
                "depth_map": f"data:image/jpeg;base64,{depth_base64}",
                "focus_plane_depth": focus_plane,
                "image_size": {
                    "width": original_width,
                    "height": original_height
                },
                "processing_info": {
                    "focus_strength": focus_strength,
                    "blur_radius": blur_radius,
                    "scaled_for_processing": scale_back
                }
            }
            
        except Exception as e:
            logging.error(f"Error processing auto focus: {e}")
            raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

# Initialize processor
processor = AutoFocusProcessor()

@app.on_event("startup")
async def startup_event():
    """Load depth model when server starts"""
    await processor.load_depth_model()

@app.post("/auto-focus")
async def auto_focus_blur(
    file: UploadFile = File(...),
    focus_strength: float = 1.0,
    blur_radius: int = 15
):
    """Apply auto focus effect like Canva
    
    Parameters:
    - focus_strength: Controls focus range (0.5-2.0, default 1.0)
    - blur_radius: Maximum blur intensity (5-25, default 15)
    """
    
    # Validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    # Validate parameters
    if not (0.1 <= focus_strength <= 3.0):
        raise HTTPException(status_code=400, detail="focus_strength must be between 0.1 and 3.0")
    
    if not (3 <= blur_radius <= 50):
        raise HTTPException(status_code=400, detail="blur_radius must be between 3 and 50")
    
    try:
        # Read image bytes
        image_bytes = await file.read()
        
        # Process with auto focus
        result = await processor.process_auto_focus(
            image_bytes, focus_strength, blur_radius
        )
        
        return JSONResponse(content=result)
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "models_loaded": processor.models_loaded,
        "device": str(processor.device),
        "feature": "Canva-like Auto Focus"
    }

@app.get("/")
async def root():
    """API information"""
    return {
        "message": "Auto Focus Depth Blur API",
        "description": "Canva-like auto focus with depth-based background blur",
        "version": "1.0.0",
        "endpoints": {
            "/auto-focus": "Apply auto focus effect to image",
            "/health": "Check API health status"
        },
        "parameters": {
            "focus_strength": "0.1-3.0 (default: 1.0)",
            "blur_radius": "3-50 (default: 15)"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)