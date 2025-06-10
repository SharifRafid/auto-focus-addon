# Auto Focus Depth Analysis API

A Node.js Express API that analyzes images for depth information and returns focus regions, allowing you to manually apply focus and blur effects in your frontend application.

## Features

- 🔍 **Depth Analysis**: Uses TensorFlow.js for depth estimation
- 🎯 **Focus Region Detection**: Identifies multiple focus areas in images
- 📊 **Depth Map Visualization**: Returns visual depth maps for debugging
- 🚀 **Fast Processing**: Optimized for real-time applications
- 🔧 **Configurable**: Adjustable number of regions and processing options

## Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd auto-focus-addon
```

2. **Install dependencies**
```bash
npm install
```

3. **Start the server**
```bash
npm start
# or for development with auto-reload
npm run dev
```

The API will be available at `http://localhost:3000`

## API Endpoints

### POST `/analyze`

Analyzes an image and returns depth information with focus regions.

**Parameters:**
- `image` (file, required): Image file to analyze
- `numRegions` (number, optional): Number of focus regions to detect (1-20, default: 5)
- `includeDepthMap` (boolean, optional): Include depth map visualization (default: true)

**Example Request:**
```javascript
const formData = new FormData();
formData.append('image', imageFile);
formData.append('numRegions', '5');
formData.append('includeDepthMap', 'true');

const response = await fetch('http://localhost:3000/analyze', {
  method: 'POST',
  body: formData
});

const result = await response.json();
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "focusRegions": [
      {
        "id": 0,
        "depth": 0.75,
        "confidence": 0.35,
        "boundingBox": {
          "x": 100,
          "y": 150,
          "width": 200,
          "height": 180
        },
        "mask": [1, 0, 1, 0, ...]
      }
    ],
    "depthMap": "data:image/jpeg;base64,...",
    "imageSize": {
      "width": 1920,
      "height": 1080
    },
    "processingSize": {
      "width": 512,
      "height": 288
    }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### GET `/health`

Check API health status and model loading state.

### GET `/`

API information and documentation.

## Response Format

### Focus Regions

Each focus region contains:

- **id**: Unique identifier for the region
- **depth**: Normalized depth value (0-1, where 0 is closest)
- **confidence**: How much of the image this depth represents (0-1)
- **boundingBox**: Rectangle coordinates for the region
  - `x`, `y`: Top-left corner position
  - `width`, `height`: Dimensions
- **mask**: Binary array indicating which pixels belong to this region

### Depth Map

- Base64-encoded JPEG image showing depth visualization
- Lighter areas are closer, darker areas are farther
- Same dimensions as original image

## Frontend Integration

Here's how to use the API response in your frontend:

### Basic Usage

```javascript
async function analyzeImage(imageFile) {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('numRegions', '3');
  
  try {
    const response = await fetch('http://localhost:3000/analyze', {
      method: 'POST',
      body: formData
    });
    
    const result = await response.json();
    
    if (result.success) {
      return result.data;
    } else {
      throw new Error(result.error);
    }
  } catch (error) {
    console.error('Analysis failed:', error);
    throw error;
  }
}
```

### Applying Blur Based on Regions

```javascript
function applyFocusEffect(imageElement, focusRegions, selectedRegionId) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = imageElement.naturalWidth;
  canvas.height = imageElement.naturalHeight;
  
  // Draw original image
  ctx.drawImage(imageElement, 0, 0);
  
  // Apply blur to non-selected regions
  focusRegions.forEach(region => {
    if (region.id !== selectedRegionId) {
      // Apply blur effect to this region
      applyBlurToRegion(ctx, region);
    }
  });
  
  return canvas;
}

function applyBlurToRegion(ctx, region) {
  const { boundingBox } = region;
  
  // Extract region data
  const imageData = ctx.getImageData(
    boundingBox.x, 
    boundingBox.y, 
    boundingBox.width, 
    boundingBox.height
  );
  
  // Apply blur filter (you can use various blur algorithms)
  const blurredData = applyGaussianBlur(imageData);
  
  // Put blurred data back
  ctx.putImageData(blurredData, boundingBox.x, boundingBox.y);
}
```

### React Component Example

```jsx
import React, { useState } from 'react';

const FocusEditor = () => {
  const [image, setImage] = useState(null);
  const [focusRegions, setFocusRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [depthMap, setDepthMap] = useState(null);

  const handleImageUpload = async (file) => {
    try {
      const result = await analyzeImage(file);
      setFocusRegions(result.focusRegions);
      setDepthMap(result.depthMap);
      setImage(URL.createObjectURL(file));
    } catch (error) {
      console.error('Failed to analyze image:', error);
    }
  };

  return (
    <div>
      <input 
        type="file" 
        onChange={(e) => handleImageUpload(e.target.files[0])}
        accept="image/*"
      />
      
      {image && (
        <div style={{ display: 'flex' }}>
          <div>
            <img src={image} alt="Original" style={{ maxWidth: '400px' }} />
            <div>
              <h3>Focus Regions:</h3>
              {focusRegions.map(region => (
                <button
                  key={region.id}
                  onClick={() => setSelectedRegion(region.id)}
                  style={{
                    margin: '5px',
                    backgroundColor: selectedRegion === region.id ? '#007bff' : '#f8f9fa'
                  }}
                >
                  Region {region.id} (Depth: {region.depth.toFixed(2)})
                </button>
              ))}
            </div>
          </div>
          
          {depthMap && (
            <div>
              <h3>Depth Map:</h3>
              <img src={depthMap} alt="Depth" style={{ maxWidth: '400px' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FocusEditor;
```

## Technical Details

### Depth Estimation Algorithm

The current implementation uses a simplified depth estimation approach:

1. **Edge Detection**: Uses Sobel operators to find gradients
2. **Gradient Magnitude**: Calculates edge strength
3. **Depth Inference**: Assumes edges indicate depth changes
4. **Smoothing**: Applies pooling for smoother depth maps

### Upgrading to Advanced Models

For production use, consider upgrading to a pre-trained depth estimation model:

```javascript
// Example: Loading a pre-trained MiDaS model converted to TensorFlow.js
async function loadAdvancedModel() {
  const modelUrl = 'path/to/midas-model/model.json';
  this.model = await tf.loadLayersModel(modelUrl);
}
```

### Performance Optimization

- Images are resized to 512x512 for processing
- Results are scaled back to original dimensions
- Tensor memory is properly disposed to prevent leaks
- Use `numRegions` parameter to balance accuracy vs speed

## Error Handling

The API includes comprehensive error handling:

- **400**: Invalid input parameters
- **413**: File too large (10MB limit)
- **415**: Unsupported file type
- **500**: Processing errors

## Development

### Prerequisites

- Node.js 16+ 
- NPM or Yarn

### Environment Variables

Create a `.env` file:

```env
PORT=3000
NODE_ENV=development
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details. 