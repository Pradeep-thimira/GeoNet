import geopandas as gpd
import momepy
import networkx as nx
import mapclassify
import json

def run_network_analysis(shp_path, analysis_type, classification_method, class_count):
    # 1. Read Shapefile
    gdf = gpd.read_file(shp_path)
    
    # Ensure it's projected (Metric) for accurate calculations. 
    # If it's WGS84 (Lat/Lon), we project to a generic UTM or Web Mercator for the math.
    original_crs = gdf.crs
    if not gdf.crs.is_projected:
        gdf = gdf.to_crs(epsg=3857)

    # 2. Graph Conversion (Primal Graph: Intersections are nodes)
    # This automatically fixes topology errors
    G = momepy.gdf_to_nx(gdf, approach='primal', length='mm_len')

    # 3. Calculate Metrics
    # Note: For large graphs, these can be computationally expensive.
    if analysis_type == 'connectivity':
        # Node Degree
        metric_values = dict(G.degree())
        column_name = 'connectivity'
        
    elif analysis_type == 'closeness':
        # Closeness Centrality (1 / average distance)
        metric_values = nx.closeness_centrality(G, distance='mm_len')
        column_name = 'closeness'
        
    elif analysis_type == 'betweenness':
        # Betweenness Centrality (Shortest path traffic)
        metric_values = nx.betweenness_centrality(G, weight='mm_len')
        column_name = 'betweenness'
    
    else:
        raise ValueError("Unknown analysis type")

    # 4. Map results back to GeoDataFrame
    # We map node values back to the edges (average of two nodes) or keep as nodes.
    # For visualization, edge-based visualization is usually preferred for roads.
    nx.set_node_attributes(G, metric_values, column_name)
    
    # Convert back to Geodataframe (Lines)
    gdf_out = momepy.nx_to_gdf(G, points=False, lines=True)
    
    # 5. Classification
    # We calculate the class ID (0 to n) for the frontend styling
    values = gdf_out[column_name]
    
    if classification_method == 'Natural Breaks (Jenks)':
        classifier = mapclassify.FisherJenks(values, k=class_count)
    elif classification_method == 'Equal Interval':
        classifier = mapclassify.EqualInterval(values, k=class_count)
    else: # Quantile
        classifier = mapclassify.Quantiles(values, k=class_count)
        
    gdf_out['class_id'] = classifier.yb # Class ID (0, 1, 2...)
    gdf_out['value'] = values           # Raw value
    
    # 6. Prepare Output
    # Reproject back to WGS84 (Lat/Lon) for Leaflet
    gdf_out = gdf_out.to_crs(epsg=4326)
    
    return json.loads(gdf_out.to_json())