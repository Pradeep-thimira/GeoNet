import geopandas as gpd
import momepy
import networkx as nx
import mapclassify
import json

def run_network_analysis(shp_path, analysis_type, classification_method, class_count, metric, radius):
    # 1. Read Shapefile and Explode
    gdf = gpd.read_file(shp_path)
    gdf = gdf.explode(index_parts=False).reset_index(drop=True)
    
    # Ensure it's projected (Metric)
    if not gdf.crs.is_projected:
        gdf = gdf.to_crs(epsg=3857)

    # 2. Graph Conversion
    G = momepy.gdf_to_nx(gdf, approach='primal', length='mm_len')

    # 3. Configure Weight & Radius
    # metric: EUCLIDEAN, ANGULAR, HYBRID, EUCLIDEAN_ANGULAR
    # Note: True Angular requires dual graph or complex edge weights. 
    # We map 'EUCLIDEAN' to physical length, others to Topological (steps) for this demo.
    weight_key = 'mm_len' if metric == 'EUCLIDEAN' else None 
    
    # 4. Calculate Metrics (ON NODES)
    if analysis_type == 'connectivity':
        metric_values = dict(G.degree())
        column_name = 'connectivity'
        
    elif analysis_type == 'closeness':
        # Radius logic would go here (e.g. subgraph limitation), but NX is global by default.
        metric_values = nx.closeness_centrality(G, distance=weight_key)
        column_name = 'closeness'
        
    elif analysis_type == 'betweenness':
        metric_values = nx.betweenness_centrality(G, weight=weight_key)
        column_name = 'betweenness'
    
    else:
        raise ValueError("Unknown analysis type")

    # Save metrics to nodes
    nx.set_node_attributes(G, metric_values, column_name)

    # 5. Map Node Attributes to Edges
    edge_values = {}
    for u, v, key, data in G.edges(keys=True, data=True):
        val_u = G.nodes[u].get(column_name, 0)
        val_v = G.nodes[v].get(column_name, 0)
        edge_values[(u, v, key)] = (val_u + val_v) / 2
    
    nx.set_edge_attributes(G, edge_values, column_name)

    # 6. Convert back to Geodataframe (Lines)
    gdf_out = momepy.nx_to_gdf(G, points=False, lines=True)
    
    # 7. Classification
    values = gdf_out[column_name]
    
    if classification_method == 'Natural Breaks (Jenks)':
        classifier = mapclassify.FisherJenks(values, k=class_count)
    elif classification_method == 'Equal Interval':
        classifier = mapclassify.EqualInterval(values, k=class_count)
    else: # Quantile
        classifier = mapclassify.Quantiles(values, k=class_count)
        
    gdf_out['class_id'] = classifier.yb
    gdf_out['value'] = values
    
    # 8. Prepare Output
    gdf_out = gdf_out.to_crs(epsg=4326)
    
    return json.loads(gdf_out.to_json())