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
    # Primal graph: Nodes = Intersections, Edges = Street Segments
    G = momepy.gdf_to_nx(gdf, approach='primal', length='mm_len')

    # 3. Configure Weight & Radius
    # 'mm_len' is automatically calculated by momepy during conversion
    if metric == 'EUCLIDEAN':
        weight_key = 'mm_len' 
    else:
        # For ANGULAR or HYBRID in Primal graph, we default to Topological (steps)
        # unless we convert to Dual graph. For this fix, we treat non-Euclidean as Topological.
        weight_key = None 

    # Parse Radius
    radius_val = None
    if radius and radius != 'n':
        try:
            radius_val = float(radius)
        except ValueError:
            radius_val = None

    # 4. Calculate Metrics (ON NODES)
    column_name = analysis_type

    if analysis_type == 'connectivity':
        metric_values = dict(G.degree())
        
    elif analysis_type == 'closeness':
        # Use momepy for radius support if provided, otherwise NX global
        if radius_val:
            # momepy.closeness_centrality handles radius (local centrality)
            # Note: momepy returns a Series, need to map to dict
            nodes_gdf = momepy.nx_to_gdf(G, points=True, lines=False)
            closeness = momepy.closeness_centrality(
                G, radius=radius_val, name=column_name, distance=weight_key, weight=weight_key
            )
            # Map values back to graph nodes using their coordinates or index
            # Momepy attaches values to the dataframe index which matches graph nodes
            metric_values = closeness.to_dict()
        else:
            metric_values = nx.closeness_centrality(G, distance=weight_key)
        
    elif analysis_type == 'betweenness':
        # Betweenness with radius is complex (ego graph), doing global for now
        metric_values = nx.betweenness_centrality(G, weight=weight_key)
    
    else:
        raise ValueError("Unknown analysis type")

    # Save metrics to nodes
    if isinstance(metric_values, dict):
        nx.set_node_attributes(G, metric_values, column_name)

    # 5. Map Node Attributes to Edges
    # We visualize edges, so we average the start/end node values
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
    
    # Handle case with all same values or empty
    if values.nunique() <= 1:
        gdf_out['class_id'] = 0
    else:
        try:
            if classification_method == 'Natural Breaks (Jenks)':
                classifier = mapclassify.FisherJenks(values, k=min(class_count, values.nunique()))
            elif classification_method == 'Equal Interval':
                classifier = mapclassify.EqualInterval(values, k=class_count)
            else: # Quantile
                classifier = mapclassify.Quantiles(values, k=class_count)
            gdf_out['class_id'] = classifier.yb
        except Exception:
            # Fallback if classification fails
            gdf_out['class_id'] = 0

    gdf_out['value'] = values
    
    # 8. Prepare Output
    gdf_out = gdf_out.to_crs(epsg=4326)
    
    return json.loads(gdf_out.to_json())