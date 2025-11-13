import numpy as np
import cv2
from typing import Tuple, List, Dict

def get_cell_boundaries(m: int, n: int, video_shape: Tuple[int, int, int, int]) -> Dict:
    """
    Determines the boundaries/locations of cells in the grid from the video dimensions.
    Updated to support rectangular cells.
    
    Args:
        m: Number of rows in the grid
        n: Number of columns in the grid
        video_shape: Shape of the video (m*d1, n*d2, 1, k) where cells can be rectangular
    
    Returns:
        Dictionary containing cell information:
        - d_height, d_width: cell dimensions (allowing rectangular cells)
        - cell_boundaries: List of (row, col, top_y, left_x, bottom_y, right_x) for each cell
        - grid_info: Dictionary with grid dimensions and cell sizes
    """
    height, width, channels, frames = video_shape
    
    # Calculate cell dimensions (can be rectangular)
    d_height = height // m
    d_width = width // n
    
    # Generate cell boundaries
    cell_boundaries = []
    for row in range(m):
        for col in range(n):
            top_y = row * d_height
            left_x = col * d_width
            bottom_y = top_y + d_height
            right_x = left_x + d_width
            
            cell_boundaries.append({
                'row': row,
                'col': col,
                'top_y': top_y,
                'left_x': left_x,
                'bottom_y': bottom_y,
                'right_x': right_x
            })
    
    grid_info = {
        'd_height': d_height,
        'd_width': d_width,
        'cell_boundaries': cell_boundaries,
        'grid_dimensions': (m, n),
        'cell_size': (d_width, d_height),  # (width, height) for WebGL
        'video_dimensions': (height, width),
        'total_cells': m * n
    }
    
    return grid_info

def validate_inputs(video_shape: Tuple[int, int, int, int], 
                   color_grid_shape: Tuple[int, int, int, int],
                   m: int, n: int) -> bool:
    """
    Validates that the input dimensions are consistent.
    
    Args:
        video_shape: Shape of the video (m*d, n*d, 1, k)
        color_grid_shape: Shape of the color grid (m, n, 3, w)
        m: Number of rows in the grid
        n: Number of columns in the grid
    
    Returns:
        True if inputs are valid, raises ValueError otherwise
    """
    video_height, video_width, video_channels, video_frames = video_shape
    grid_rows, grid_cols, grid_channels, grid_params = color_grid_shape
    
    if video_channels != 1:
        raise ValueError(f"Video must have 1 channel (grayscale), got {video_channels}")
    
    if grid_channels != 3:
        raise ValueError(f"Color grid must have 3 channels (RGB), got {grid_channels}")
    
    if grid_rows != m or grid_cols != n:
        raise ValueError(f"Color grid dimensions ({grid_rows}, {grid_cols}) don't match specified m={m}, n={n}")
    
    if video_height % m != 0 or video_width % n != 0:
        raise ValueError(f"Video dimensions ({video_height}, {video_width}) are not divisible by grid dimensions ({m}, {n})")
    
    d_height = video_height // m
    d_width = video_width // n
    
    if d_height != d_width:
        print(f"Warning: Cells are not square (height={d_height}, width={d_width})")
    
    return True

def convert_to_transparency_video(grayscale_video: np.ndarray, 
                                output_path: str = None,
                                format: str = 'webm') -> str:
    """
    Converts grayscale video to transparency format where pixel values control alpha.
    
    Args:
        grayscale_video: Input video as numpy array (height, width, 1, frames)
        output_path: Optional output path for the video file
        format: Output format ('webm' for VP9 with alpha, 'png_sequence' for PNG sequence)
    
    Returns:
        Path to the output video file or directory
    """
    height, width, channels, frames = grayscale_video.shape
    
    if output_path is None:
        output_path = f'transparent_video.{format}'
    
    if format == 'webm':
        # Create RGBA video for WebM with alpha channel
        fourcc = cv2.VideoWriter_fourcc(*'VP90')  # VP9 codec supports alpha
        out = cv2.VideoWriter(output_path, fourcc, 30.0, (width, height), True)
        
        for frame_idx in range(frames):
            frame = grayscale_video[:, :, 0, frame_idx]
            
            # Create RGBA frame - use grayscale value as alpha
            rgba_frame = np.zeros((height, width, 4), dtype=np.uint8)
            rgba_frame[:, :, 0] = 0  # Red channel (black)
            rgba_frame[:, :, 1] = 0  # Green channel (black)
            rgba_frame[:, :, 2] = 0  # Blue channel (black)
            rgba_frame[:, :, 3] = frame  # Alpha channel (grayscale as transparency)
            
            # Convert RGBA to BGR for OpenCV (alpha will be handled by codec)
            bgr_frame = cv2.cvtColor(rgba_frame, cv2.COLOR_RGBA2BGR)
            out.write(bgr_frame)
        
        out.release()
        
    elif format == 'png_sequence':
        # Create PNG sequence with alpha channel
        import os
        os.makedirs(output_path, exist_ok=True)
        
        for frame_idx in range(frames):
            frame = grayscale_video[:, :, 0, frame_idx]
            
            # Create RGBA frame
            rgba_frame = np.zeros((height, width, 4), dtype=np.uint8)
            rgba_frame[:, :, 0] = 0  # Red channel (black)
            rgba_frame[:, :, 1] = 0  # Green channel (black)
            rgba_frame[:, :, 2] = 0  # Blue channel (black)
            rgba_frame[:, :, 3] = frame  # Alpha channel
            
            frame_path = os.path.join(output_path, f'frame_{frame_idx:04d}.png')
            cv2.imwrite(frame_path, rgba_frame)
    
    return output_path

def prepare_video_for_web(grayscale_video: np.ndarray, 
                         target_resolution: Tuple[int, int] = None) -> Dict:
    """
    Prepares video for web display with optimal resolution and format.
    
    Args:
        grayscale_video: Input video as numpy array (height, width, 1, frames)
        target_resolution: Optional target resolution (width, height). If None, uses original size.
    
    Returns:
        Dictionary with video data and metadata for web display
    """
    height, width, channels, frames = grayscale_video.shape
    
    # Determine optimal resolution
    if target_resolution is None:
        # For zooming capability, we want high resolution
        # But for performance, we might want to scale down very large videos
        max_dimension = 2048  # Good balance for web performance and zoom capability
        if max(height, width) > max_dimension:
            scale_factor = max_dimension / max(height, width)
            target_width = int(width * scale_factor)
            target_height = int(height * scale_factor)
        else:
            target_width, target_height = width, height
    else:
        target_width, target_height = target_resolution
    
    # Resize video if needed
    if target_width != width or target_height != height:
        resized_video = np.zeros((target_height, target_width, 1, frames), dtype=grayscale_video.dtype)
        for frame_idx in range(frames):
            frame = grayscale_video[:, :, 0, frame_idx]
            resized_frame = cv2.resize(frame, (target_width, target_height))
            resized_video[:, :, 0, frame_idx] = resized_frame
        processed_video = resized_video
    else:
        processed_video = grayscale_video
    
    # Convert to transparency format
    webm_path = convert_to_transparency_video(processed_video, 'transparent_video.webm', 'webm')
    
    return {
        'video_path': webm_path,
        'original_resolution': (width, height),
        'target_resolution': (target_width, target_height),
        'frames': frames,
        'scale_factor': target_width / width if width != target_width else 1.0,
        'recommended_format': 'webm'  # WebM with VP9 codec supports alpha channel
    }

def convert_video_format(video_array: np.ndarray, input_format: str = 'auto') -> np.ndarray:
    """
    Convert video array to expected format: (height, width, channels, frames)
    
    Args:
        video_array: Input video array
        input_format: 'auto', 'frames_first', 'frames_last', or 'expected'
    
    Returns:
        Video array in format (height, width, channels, frames)
    """
    original_shape = video_array.shape
    
    if input_format == 'auto':
        # Try to detect format based on shape
        if len(original_shape) == 3:
            # Assume (frames, height, width) - most common format
            input_format = 'frames_first'
        elif len(original_shape) == 4:
            # Check if last dimension looks like frames (typically smaller)
            if original_shape[-1] < original_shape[-2]:
                input_format = 'expected'  # (height, width, channels, frames)
            else:
                input_format = 'frames_last'  # (height, width, frames, channels)
        else:
            raise ValueError(f"Unsupported video array shape: {original_shape}")
    
    if input_format == 'frames_first':
        # Convert (frames, height, width) -> (height, width, 1, frames)
        video_array = np.transpose(video_array, (1, 2, 0))  # (height, width, frames)
        video_array = np.expand_dims(video_array, axis=2)   # (height, width, 1, frames)
    elif input_format == 'frames_last':
        # Convert (height, width, frames, channels) -> (height, width, channels, frames)
        video_array = np.transpose(video_array, (0, 1, 3, 2))
    elif input_format == 'expected':
        # Already in correct format
        pass
    else:
        raise ValueError(f"Unknown input format: {input_format}")
    
    print(f"Converted video shape: {original_shape} -> {video_array.shape}")
    return video_array

def convert_to_uint8(video_array: np.ndarray) -> np.ndarray:
    """
    Convert video array to uint8 format (0-255).
    
    Args:
        video_array: Input video array
    
    Returns:
        Video array as uint8
    """
    original_dtype = video_array.dtype
    min_val = np.min(video_array)
    max_val = np.max(video_array)
    
    print(f"Converting to uint8: {original_dtype} -> uint8")
    print(f"Original range: {min_val:.3f} to {max_val:.3f}")
    
    if original_dtype == np.uint8:
        # Already uint8, no conversion needed
        print("Already uint8, skipping conversion")
        return video_array
    
    # Normalize to 0-255 range
    if min_val == max_val:
        # Constant video - avoid division by zero
        normalized = np.zeros_like(video_array, dtype=np.uint8)
    else:
        normalized = ((video_array - min_val) / (max_val - min_val) * 255).astype(np.uint8)
    
    print(f"Converted range: {np.min(normalized)} to {np.max(normalized)}")
    return normalized

def prepare_video_array(video_array: np.ndarray, 
                       output_format: str = 'uint8',
                       threshold: float = None,
                       input_format: str = 'auto',
                       for_web: bool = False,
                       invert: bool = False) -> np.ndarray:
    """
    Complete pipeline to prepare video array for the visualization system.
    Latest version with vertical flip to correct upside-down display.
    
    Args:
        video_array: Input video array in any format
        output_format: 'uint8', 'binary', or 'float'
        threshold: Threshold for binary conversion (0.0 to 1.0)
        input_format: Format of input array ('auto', 'frames_first', 'frames_last', 'expected')
        for_web: If True, ensure output is uint8 for WebGL compatibility
        invert: If True, invert the grayscale values (255 - value)
    
    Returns:
        Processed video array in format (height, width, 1, frames)
    """
    print(f"Processing video array: {video_array.shape} ({video_array.dtype})")
    
    # Step 1: Convert to expected format
    video = convert_video_format(video_array, input_format)
    
    # Step 2: Convert data type/range
    if output_format == 'uint8':
        video = convert_to_uint8(video)
        if invert:
            video = 255 - video
        
        # Flip video vertically (along y-axis) to correct upside-down display
        video = np.flip(video, axis=0)
        
    elif output_format == 'float':
        # Keep as float but ensure 0-1 range
        min_val = np.min(video)
        max_val = np.max(video)
        if min_val < 0 or max_val > 1:
            video = (video - min_val) / (max_val - min_val)
            print(f"Normalized float video to [0, 1] range")
        if invert:
            video = 1.0 - video
            
        # Flip video vertically (along y-axis) to correct upside-down display
        video = np.flip(video, axis=0)
        
    else:
        raise ValueError(f"Unknown output_format: {output_format}")
    
    print(f"Final video shape: {video.shape} ({video.dtype})")
    return video 