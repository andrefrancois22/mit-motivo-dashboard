import numpy as np
import os

# ==> directories
base_dir = 'files/masks'
output_path = 'files/masks_array.npy'

# os.makedirs(output_dir, exist_ok=True)
masks = {}
for file in os.listdir(base_dir):
    if file.endswith('.npy'):
        idx = int(file.split('video-color-mask-beta-')[1].split('.npy')[0])
        #print(idx)
        masks[idx] = np.load(os.path.join(base_dir, file))

masks_array = []
for idx in sorted(masks.keys()):
    masks_array.append(masks[idx])
masks_array = np.array(masks_array)

# move last dimension to first
masks_array = np.moveaxis(masks_array, 0, -1)

# scale to 0-1
masks_array = masks_array / 255.0

# convert to float32
masks_array = masks_array.astype(np.float32)

# flip the first dimension
masks_array = masks_array[::-1, :, :, :]

print(masks_array.shape)

np.save(output_path, masks_array)
print(f'Saved to {output_path}')






        
