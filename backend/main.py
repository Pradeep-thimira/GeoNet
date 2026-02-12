from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import shutil
import os
import tempfile
from pathlib import Path
from .utils import save_upload_file, extract_shapefile
from .analysis import run_network_analysis

app = FastAPI(title="GEO NET API")

# Enable CORS for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze")
async def analyze_network(
    file: UploadFile = File(...),
    analysis_type: str = Form(...),
    classification_method: str = Form("Natural Breaks (Jenks)"),
    class_count: int = Form(5),
    metric: str = Form("EUCLIDEAN"),
    radius: str = Form("n")
):
    temp_dir = tempfile.mkdtemp()
    try:
        # 1. Handle File Upload
        zip_path = os.path.join(temp_dir, file.filename)
        save_upload_file(file, Path(zip_path))
        
        # 2. Extract Shapefile
        shp_path = extract_shapefile(zip_path, temp_dir)
        
        # 3. Run Analysis
        result_geojson = run_network_analysis(
            shp_path, 
            analysis_type, 
            classification_method, 
            class_count,
            metric,
            radius
        )
        
        return result_geojson

    except Exception as e:
        print(f"Error: {e}") 
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup temp files
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

# --- SERVE FRONTEND ON RENDER ---

# Get absolute path to public directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# Mount the static directory to serve script.js, CSS, etc.
app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")

# Serve index.html on the root path
@app.get("/")
async def serve_frontend():
    index_path = os.path.join(PUBLIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "Frontend not found. Please ensure the 'public' directory exists."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)