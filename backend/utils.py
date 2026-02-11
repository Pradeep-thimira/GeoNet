import os
import zipfile
import shutil
from pathlib import Path

def save_upload_file(upload_file, destination: Path):
    try:
        with destination.open("wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)
    finally:
        upload_file.file.close()

def extract_shapefile(zip_path: str, extract_to: str) -> str:
    """
    Extracts a zip file and returns the path to the first valid .shp file found.
    Checks for required sidecar files (.shx, .dbf).
    """
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)
    
    # Find the .shp file (ignoring __MACOSX hidden folders)
    for root, dirs, files in os.walk(extract_to):
        for file in files:
            if file.endswith(".shp") and not file.startswith("._"):
                shp_path = os.path.join(root, file)
                base_path = os.path.splitext(shp_path)[0]
                
                # Check for required sidecar files
                if os.path.exists(base_path + ".shx") and os.path.exists(base_path + ".dbf"):
                    return shp_path
    
    raise FileNotFoundError("No valid .shp file (with .shx and .dbf) found in the uploaded zip.")