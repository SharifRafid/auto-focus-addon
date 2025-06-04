# Auto Focus Backend

A FastAPI-based backend service that provides automatic depth-based blur effects for images, similar to Canva's auto-focus feature. The service uses MiDaS for depth estimation and applies intelligent blur effects based on the depth map.

## Features

- Automatic depth estimation using MiDaS
- Smart subject detection and focus plane calculation
- Configurable blur strength and radius
- RESTful API endpoints for image processing

## Setup

1. Create a virtual environment:
```bash
python -m venv .venv
source .venv/bin/activate  # On Linux/Mac
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run the server:
```bash
uvicorn main:app --reload
```

## API Endpoints

- `POST /auto-focus`: Process an image with auto-focus effect
- `GET /health`: Health check endpoint
- `GET /`: Root endpoint

## Requirements

- Python 3.7+
- CUDA-capable GPU (recommended)
- See requirements.txt for full dependencies 