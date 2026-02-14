import os
import base64
import json

image_dir = "services/frontend-service/static/images"
bundle_file = "services/frontend-service/static/js/image_bundle.js"

images_data = {}

for filename in os.listdir(image_dir):
    if filename.endswith(('.png', '.svg', '.jpg', '.jpeg')):
        filepath = os.path.join(image_dir, filename)
        with open(filepath, "rb") as f:
            encoded_string = base64.b64encode(f.read()).decode('utf-8')
            
            # Determine mime type
            mime = "image/png"
            if filename.endswith(".svg"): mime = "image/svg+xml"
            elif filename.endswith((".jpg", ".jpeg")): mime = "image/jpeg"
            
            images_data[filename] = f"data:{mime};base64,{encoded_string}"

with open(bundle_file, "w") as f:
    f.write("const IMAGE_BUNDLE = ")
    f.write(json.dumps(images_data, indent=4))
    f.write(";")

print(f"Successfully bundled {len(images_data)} images into {bundle_file}")
