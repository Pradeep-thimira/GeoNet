from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
import shutil
import os
import tempfile
import zipfile
import geopandas as gpd
from pathlib import Path
from .utils import save_upload_file, extract_shapefile
from .analysis import run_network_analysis

app = FastAPI(title="GEO NET API")

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
    radius: str = Form("n"),
):
    temp_dir = tempfile.mkdtemp()
    try:
        zip_path = os.path.join(temp_dir, file.filename)
        save_upload_file(file, Path(zip_path))

        shp_path = extract_shapefile(zip_path, temp_dir)

        result_geojson = run_network_analysis(
            shp_path,
            analysis_type,
            classification_method,
            class_count,
            metric,
            radius,
        )

        return result_geojson

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)


@app.post("/download")
async def download_shapefile(request: Request, background_tasks: BackgroundTasks):
    temp_dir = tempfile.mkdtemp()
    try:
        data = await request.json()

        gdf = gpd.GeoDataFrame.from_features(data["features"])
        if not gdf.crs:
            gdf.set_crs(epsg=4326, inplace=True)

        shp_path = os.path.join(temp_dir, "geonet_output.shp")
        gdf.to_file(shp_path, driver="ESRI Shapefile")

        zip_path = os.path.join(temp_dir, "geonet_output.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for root, _, files in os.walk(temp_dir):
                for fname in files:
                    if fname != "geonet_output.zip":
                        zipf.write(os.path.join(root, fname), arcname=fname)

        # FIX: Read the zip into memory before returning so the temp directory
        # can be cleaned up safely in the background task without a race condition
        # where FileResponse streams from a path that has already been deleted.
        with open(zip_path, "rb") as f:
            zip_bytes = f.read()

        def cleanup():
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)

        background_tasks.add_task(cleanup)

        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=geonet_output.zip"},
        )

    except Exception as e:
        print(f"Download Error: {e}")
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail="Failed to prepare shapefile for download.")


# --- Serve frontend ---
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

app.mount("/static", StaticFiles(directory=PUBLIC_DIR), name="static")


@app.get("/")
async def serve_frontend():
    index_path = os.path.join(PUBLIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"error": "Frontend not found. Please ensure the 'public' directory exists."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)