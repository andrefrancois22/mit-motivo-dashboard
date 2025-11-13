import numpy as np
from video_processor import prepare_video_array
from generate_sample_data import generate_color_map_for_video

# Load your file (corrected filename)
video_path = 'files/video_gray-2.npy'

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Convert video to numpy arrays')
    parser.add_argument('--video-path', type=str, required=True, help='Path to the video file')
    parser.add_argument('--m', type=int, required=True, help='Number of rows in the grid')
    parser.add_argument('--n', type=int, required=True, help='Number of columns in the grid')
    parser.add_argument('--num-parameters', type=int, required=True, help='Number of parameter variations')
    parser.add_argument('--output-dir', type=str, required=True, help='Path to the output file')
    # parser.add_argument('--color_scheme', type=str, required=True, help='Color scheme for the color grid')

    args = parser.parse_args()

    print('Loading your video file...')
    video_data = np.load(args.video_path)
    print(f'Loaded: {video_data.shape}, {video_data.dtype}')

    # Convert to expected format: (height, width, 1, frames)
    print('\\nConverting to app format...')
    video_processed = prepare_video_array(
        video_data, 
        output_format='uint8',  # Keep as uint8 since it already is
        input_format='frames_first',  # Your format is (42, height, width)
        for_web=True,
        invert=True
    )

    # # Generate a matching color grid
    # # You'll need to choose m and n based on how you want to divide your video
    # m, n = args.m, args.n  # Example: 6x8 grid - adjust these numbers as needed
    # print(f'\\nGenerating color grid for {m}x{n} grid...')
    # colors = generate_color_map_for_video(
    #     video_processed, 
    #     m=m, 
    #     n=n, 
    #     parameters=args.num_parameters,  # Number of parameter variations
    #     color_scheme='random'  # or 'rainbow', 'cool'
    # )

    # Save the files
    import os
    os.makedirs(args.output_dir, exist_ok=True)
    video_name = os.path.basename(args.video_path)
    video_output = os.path.join(args.output_dir, f'video_gr_prepped_video.npy')
    # colors_output = os.path.join(args.output_dir, f'{video_name}_sample_colormap_n_{args.num_parameters}.npy')

    np.save(video_output, video_processed)
    # np.save(colors_output, colors)

    print(f'\\n=== Files Created ===')
    print(f'{video_output}: {video_processed.shape} ({video_processed.dtype})')
    # print(f'{colors_output}: {colors.shape} ({colors.dtype})')
    print(f'\\nReady to upload to the web app!')