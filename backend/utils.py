import os
import zipfile
import tempfile
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
    Extracts a zip file and returns the path to the first .shp file found.
    """
    with zipfile.ZipFile(zip_path, 'r') as zip_ref:
        zip_ref.extractall(extract_to)
    
    # Find the .shp file (ignoring __MACOSX hidden folders)
    for root, dirs, files in os.walk(extract_to):
        for file in files:
            if file.endswith(".shp") and not file.startswith("._"):
                return os.path.join(root, file)
    
    raise FileNotFoundError("No .shp file found in the uploaded zip.")