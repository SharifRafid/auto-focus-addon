let isProcessing = false;
let currentFile = null;

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('imageInput');
  const file = fileInput.files[0];
  if (!file) return;

  currentFile = file;
  await processImage();
});

async function processImage() {
  if (!currentFile || isProcessing) return;

  // Show loading state
  const analyzeButton = document.getElementById('analyzeButton');
  const loadingIndicator = document.getElementById('loadingIndicator');
  analyzeButton.disabled = true;
  loadingIndicator.style.display = 'block';
  isProcessing = true;

  const formData = new FormData();
  formData.append('file', currentFile);
  
  // Add parameters
  const focusStrength = document.getElementById('focusStrengthSlider').value;
  const blurRadius = document.getElementById('blurRadiusSlider').value;
  formData.append('focus_strength', focusStrength);
  formData.append('blur_radius', blurRadius);

  try {
    const response = await fetch('http://localhost:8000/auto-focus', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    
    // Display results
    document.getElementById('controls').style.display = 'block';
    document.getElementById('result').style.display = 'block';
    
    // Update images
    document.getElementById('resultImage').src = data.processed_image;
    document.getElementById('depthMapImage').src = data.depth_map;
    
    // Store processing info
    window.processingInfo = data.processing_info;
    
  } catch (error) {
    console.error('Error:', error);
    alert('Failed to process image: ' + error.message);
  } finally {
    // Reset loading state
    analyzeButton.disabled = false;
    loadingIndicator.style.display = 'none';
    isProcessing = false;
  }
}

// Debounce function to limit how often a function can be called
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Update preview when controls change
document.getElementById('focusStrengthSlider').addEventListener('input', (e) => {
  e.target.nextElementSibling.textContent = e.target.value;
});

document.getElementById('blurRadiusSlider').addEventListener('input', (e) => {
  e.target.nextElementSibling.textContent = e.target.value;
});

// Debounced version of processImage for slider changes
const debouncedProcessImage = debounce(processImage, 500);

// Add change event listeners for sliders
document.getElementById('focusStrengthSlider').addEventListener('change', debouncedProcessImage);
document.getElementById('blurRadiusSlider').addEventListener('change', debouncedProcessImage);

// Download functionality
document.getElementById('downloadButton').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'auto-focus-result.png';
  link.href = document.getElementById('resultImage').src;
  link.click();
});

// Reset functionality
document.getElementById('resetButton').addEventListener('click', () => {
  document.getElementById('focusStrengthSlider').value = 1.0;
  document.getElementById('focusStrengthSlider').nextElementSibling.textContent = '1.0';
  document.getElementById('blurRadiusSlider').value = 15;
  document.getElementById('blurRadiusSlider').nextElementSibling.textContent = '15';
  if (currentFile) {
    processImage();
  }
}); 