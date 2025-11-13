#!/usr/bin/env python3
"""
Generate sample data for testing the motion visualization system.
Creates synthetic video data and color grids in the correct format.
"""

import numpy as np
import cv2
import os
from video_processor import get_cell_boundaries, validate_inputs, prepare_video_for_web

def generate_synthetic_video(m, n, d, frames, pattern_type='circles'):
    """
    Generate synthetic video data with animated patterns in each cell.
    
    Args:
        m: Number of rows in the grid
        n: Number of columns in the grid
        d: Size of each cell (d x d pixels)
        frames: Number of frames in the animation
        pattern_type: Type of pattern ('circles', 'waves', 'random')
    
    Returns:
        numpy array of shape (m*d, n*d, 1, frames)
    """
    height, width = m * d, n * d
    video = np.zeros((height, width, 1, frames), dtype=np.uint8)
    
    print(f"Generating {pattern_type} pattern video: {width}x{height}, {frames} frames")
    
    for frame_idx in range(frames):
        frame = np.zeros((height, width), dtype=np.uint8)
        
        # Generate pattern for each cell
        for row in range(m):
            for col in range(n):
                cell_frame = generate_cell_pattern(d, frame_idx, frames, pattern_type, row, col)
                
                # Place cell in frame
                top_y = row * d
                left_x = col * d
                frame[top_y:top_y+d, left_x:left_x+d] = cell_frame
        
        video[:, :, 0, frame_idx] = frame
    
    return video

def generate_cell_pattern(d, frame_idx, total_frames, pattern_type, row, col):
    """
    Generate animated pattern for a single cell.
    
    Args:
        d: Cell size
        frame_idx: Current frame index
        total_frames: Total number of frames
        pattern_type: Type of pattern
        row, col: Cell position in grid
    
    Returns:
        d x d numpy array representing the cell pattern
    """
    cell = np.zeros((d, d), dtype=np.uint8)
    
    # Create coordinate grids
    y, x = np.ogrid[:d, :d]
    center_y, center_x = d // 2, d // 2
    
    # Animation phase
    phase = (frame_idx / total_frames) * 2 * np.pi
    
    if pattern_type == 'circles':
        # Expanding/contracting circles
        max_radius = d // 2 - 2
        radius = max_radius * (0.5 + 0.5 * np.sin(phase + row * 0.5 + col * 0.3))
        
        # Create circle
        distance = np.sqrt((x - center_x)**2 + (y - center_y)**2)
        circle_mask = distance <= radius
        
        # Add some intensity variation (normalize to 0-1 range for alpha)
        intensity_factor = 0.5 + 0.5 * np.sin(phase * 2)  # 0-1 range
        intensity = int(intensity_factor * 255)  # Convert to 0-255 for storage
        cell[circle_mask] = intensity
        
        # Add ring pattern
        ring_mask = np.abs(distance - radius) <= 1
        cell[ring_mask] = 255
    
    elif pattern_type == 'waves':
        # Sinusoidal wave pattern
        frequency = 0.3 + 0.1 * (row + col)
        wave_phase = phase + row * 0.2 + col * 0.1
        
        # Create wave
        wave = np.sin(frequency * (x + y) + wave_phase)
        cell = ((wave + 1) * 127).astype(np.uint8)
        
        # Add moving highlight
        highlight_pos = int(d * (0.5 + 0.4 * np.sin(phase)))
        if 0 <= highlight_pos < d:
            cell[highlight_pos, :] = 255
    
    elif pattern_type == 'random':
        # Random noise with temporal coherence
        np.random.seed(frame_idx * 100 + row * 10 + col)
        noise = np.random.random((d, d))
        
        # Apply temporal smoothing
        temporal_factor = 0.5 + 0.5 * np.sin(phase)
        cell = (noise * temporal_factor * 255).astype(np.uint8)
        
        # Add some structure
        center_mask = (x - center_x)**2 + (y - center_y)**2 < (d//3)**2
        cell[center_mask] = np.minimum(cell[center_mask] + 100, 255)
    
    return cell

def generate_color_grid(m, n, parameters, color_scheme='rainbow'):
    """
    Generate color grid for parameter visualization.
    
    Args:
        m: Number of rows
        n: Number of columns
        parameters: Number of parameter values (w dimension)
        color_scheme: Color scheme ('rainbow', 'heat', 'cool', 'random')
    
    Returns:
        numpy array of shape (m, n, 3, parameters)
    """
    color_grid = np.zeros((m, n, 3, parameters), dtype=np.float32)
    
    print(f"Generating {color_scheme} color grid: {m}x{n}, {parameters} parameters")
    
    for param_idx in range(parameters):
        param_value = param_idx / (parameters - 1)  # 0 to 1
        
        for row in range(m):
            for col in range(n):
                if color_scheme == 'rainbow':
                    # HSV rainbow mapping
                    hue = (param_value + row * 0.1 + col * 0.1) % 1.0
                    saturation = 0.7 + 0.3 * np.sin(param_value * np.pi)
                    value = 0.8 + 0.2 * np.cos(param_value * 2 * np.pi)
                    
                    # Convert HSV to RGB
                    color_grid[row, col, :, param_idx] = hsv_to_rgb(hue, saturation, value)
                
                elif color_scheme == 'heat':
                    # Heat map from blue to red
                    if param_value < 0.5:
                        r = 0
                        g = param_value * 2
                        b = 1 - param_value * 2
                    else:
                        r = (param_value - 0.5) * 2
                        g = 1 - (param_value - 0.5) * 2
                        b = 0
                    
                    # Add spatial variation
                    spatial_factor = 0.8 + 0.2 * np.sin(row * 0.5 + col * 0.3)
                    color_grid[row, col, :, param_idx] = np.array([r, g, b]) * spatial_factor
                
                elif color_scheme == 'cool':
                    # Cool colors (blues and greens)
                    r = 0.2 + 0.3 * param_value
                    g = 0.5 + 0.5 * np.sin(param_value * np.pi)
                    b = 0.7 + 0.3 * np.cos(param_value * 2 * np.pi)
                    
                    color_grid[row, col, :, param_idx] = [r, g, b]
                
                elif color_scheme == 'random':
                    # Random colors with some coherence
                    np.random.seed(param_idx * 100 + row * 10 + col)
                    base_color = np.random.random(3)
                    
                    # Add parameter-based variation
                    variation = 0.3 * np.array([
                        np.sin(param_value * 2 * np.pi),
                        np.sin(param_value * 2 * np.pi + 2 * np.pi / 3),
                        np.sin(param_value * 2 * np.pi + 4 * np.pi / 3)
                    ])
                    
                    color_grid[row, col, :, param_idx] = np.clip(base_color + variation, 0, 1)
    
    return color_grid

def hsv_to_rgb(h, s, v):
    """Convert HSV color to RGB."""
    h = h * 6.0
    i = int(h)
    f = h - i
    
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    
    if i == 0:
        return np.array([v, t, p])
    elif i == 1:
        return np.array([q, v, p])
    elif i == 2:
        return np.array([p, v, t])
    elif i == 3:
        return np.array([p, q, v])
    elif i == 4:
        return np.array([t, p, v])
    else:
        return np.array([v, p, q])

def generate_color_map_for_video(video_array: np.ndarray, m: int, n: int, 
                               parameters: int = 6, color_scheme: str = 'rainbow') -> np.ndarray:
    """
    Generate a color grid that matches the given video dimensions.
    
    Args:
        video_array: Video array of shape (height, width, 1, frames)
        m: Number of rows in the grid
        n: Number of columns in the grid  
        parameters: Number of parameter variations (default: 6)
        color_scheme: Color scheme to use ('rainbow', 'heat', 'cool')
    
    Returns:
        Color grid array of shape (m, n, 3, parameters)
    """
    height, width, channels, frames = video_array.shape
    
    # Validate that video dimensions match the grid
    d_height = height // m
    d_width = width // n
    
    if height != m * d_height or width != n * d_width:
        print(f"Warning: Video dimensions ({height}x{width}) don't perfectly divide by grid ({m}x{n})")
        print(f"Cell sizes will be approximately {d_height}x{d_width}")
    
    # Generate the color grid using existing function
    color_grid = generate_color_grid(m, n, parameters, color_scheme)
    
    print(f"Generated color map: {m}x{n} grid, {parameters} parameters, {color_scheme} scheme")
    print(f"Color grid shape: {color_grid.shape}")
    print(f"Video cell dimensions: {d_height}x{d_width}")
    
    return color_grid

def save_sample_data(output_dir='sample_data'):
    """
    Generate and save sample data sets.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Configuration for different sample sets
    samples = [
        {
            'name': 'small_circles',
            'm': 2, 'n': 3, 'd': 32, 'frames': 24, 'parameters': 5,
            'video_pattern': 'circles',
            'color_scheme': 'rainbow'
        },
        {
            'name': 'medium_waves',
            'm': 3, 'n': 4, 'd': 64, 'frames': 30, 'parameters': 8,
            'video_pattern': 'waves',
            'color_scheme': 'heat'
        },
        {
            'name': 'large_random',
            'm': 4, 'n': 5, 'd': 48, 'frames': 36, 'parameters': 10,
            'video_pattern': 'random',
            'color_scheme': 'cool'
        }
    ]
    
    for sample in samples:
        print(f"\nGenerating sample: {sample['name']}")
        
        # Generate video
        video = generate_synthetic_video(
            sample['m'], sample['n'], sample['d'], 
            sample['frames'], sample['video_pattern']
        )
        
        # Generate color grid
        color_grid = generate_color_grid(
            sample['m'], sample['n'], sample['parameters'], 
            sample['color_scheme']
        )
        
        # Validate inputs
        try:
            validate_inputs(video.shape, color_grid.shape, sample['m'], sample['n'])
            print("✓ Validation passed")
        except ValueError as e:
            print(f"✗ Validation failed: {e}")
            continue
        
        # Save files
        video_path = os.path.join(output_dir, f"{sample['name']}_video.npy")
        color_path = os.path.join(output_dir, f"{sample['name']}_colors.npy")
        
        np.save(video_path, video)
        np.save(color_path, color_grid)
        
        print(f"  Video saved: {video_path} {video.shape}")
        print(f"  Colors saved: {color_path} {color_grid.shape}")
        
        # Generate web-ready video
        web_info = prepare_video_for_web(video)
        print(f"  Web video: {web_info['target_resolution']}")

def create_readme():
    """Create a README file with instructions."""
    readme_content = """# Motion Visualization System

This system visualizes animated cell grids with parameter-controlled color overlays.

## Files

- `video_processor.py`: Core Python functions for video processing
- `index.html`: Web interface for visualization
- `visualization.js`: WebGL-based rendering engine
- `generate_sample_data.py`: Sample data generator
- `requirements.txt`: Python dependencies

## Setup

1. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

2. Generate sample data:
   ```bash
   python generate_sample_data.py
   ```

3. Start a local web server:
   ```bash
   python -m http.server 8000
   ```

4. Open http://localhost:8000 in your browser

## Usage

1. Upload a video file (.npy format):
   - Shape: (m*d, n*d, 1, frames)
   - Grayscale values (0-255)
   - 0 values will become transparent

2. Upload a color grid file (.npy format):
   - Shape: (m, n, 3, parameters)
   - RGB values (0-1)
   - Each parameter slice represents a different color configuration

3. Use the parameter slider to select different color configurations

4. Use play/pause, zoom, and pan controls to explore the visualization

## Data Format

### Video Data
- Format: NumPy array (.npy)
- Shape: (height, width, channels, frames)
- Where: height = m*d, width = n*d, channels = 1, frames = k
- Values: 0-255 (uint8), where 0 = transparent

### Color Grid Data
- Format: NumPy array (.npy)
- Shape: (m, n, 3, parameters)
- Values: 0-1 (float32), RGB colors

## Features

- GPU-accelerated WebGL rendering
- Real-time parameter switching
- Zoom and pan controls
- Looping video playback
- Transparent overlay support
- Responsive design

## Browser Requirements

- Modern browser with WebGL support
- Recommended: Chrome, Firefox, Safari, Edge (latest versions)
"""
    
    with open('README.md', 'w') as f:
        f.write(readme_content)
    print("Created README.md")

if __name__ == "__main__":
    print("Motion Visualization - Sample Data Generator")
    print("=" * 50)
    
    save_sample_data()
    create_readme()
    
    print("\n" + "=" * 50)
    print("Sample data generation complete!")
    print("Next steps:")
    print("1. pip install -r requirements.txt")
    print("2. python -m http.server 8000")
    print("3. Open http://localhost:8000")
    print("4. Upload sample files from sample_data/ directory") 